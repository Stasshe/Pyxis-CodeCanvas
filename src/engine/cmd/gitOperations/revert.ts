import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { syncManager } from '@/engine/core/syncManager';

/**
 * [NEW ARCHITECTURE] Git revert操作を管理するクラス
 * - onFileOperationコールバックを削除
 * - revert後にsyncManager.syncFromFSToIndexedDB()で逆同期
 */
export class GitRevertOperations {
  private fs: FS;
  private dir: string;
  private projectId: string;
  private projectName: string;

  constructor(fs: FS, dir: string, projectId: string, projectName: string) {
    this.fs = fs;
    this.dir = dir;
    this.projectId = projectId;
    this.projectName = projectName;
  }

  // [NEW ARCHITECTURE] git revert - コミットを取り消し + 逆同期
  async revert(commitHash: string): Promise<string> {
    try {
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // コミットハッシュの正規化（短縮形も対応）
      let fullCommitHash: string;
      try {
        const expandedOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commitHash });
        fullCommitHash = expandedOid;
      } catch {
        throw new Error(`bad revision '${commitHash}'`);
      }

      // 対象コミットの情報を取得
      const commitToRevert = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: fullCommitHash,
      });

      // 親コミットが存在するかチェック
      if (commitToRevert.commit.parent.length === 0) {
        throw new Error(`cannot revert initial commit ${commitHash.slice(0, 7)}`);
      }

      // マージコミットの場合はエラー
      if (commitToRevert.commit.parent.length > 1) {
        throw new Error(`commit ${commitHash.slice(0, 7)} is a merge commit`);
      }

      const parentHash = commitToRevert.commit.parent[0];

      console.log('[NEW ARCHITECTURE] Reverting commit:', commitHash.slice(0, 7));

      // 親コミットの状態を取得
      const parentCommit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: parentHash });

      // 現在のワーキングディレクトリの状態をチェック
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const hasChanges = status.some(row => {
        const [, headStatus, workdirStatus, stageStatus] = row;
        return headStatus !== workdirStatus || headStatus !== stageStatus;
      });

      if (hasChanges) {
        throw new Error(
          'error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.'
        );
      }

      // 親コミットのツリーを現在のワーキングディレクトリに適用
      // isomorphic-gitにはrevertコマンドがないため、手動で実装

      // 対象コミットで変更されたファイルを特定して、親コミットの状態に戻す
      const currentTree = await git.readTree({
        fs: this.fs,
        dir: this.dir,
        oid: commitToRevert.commit.tree,
      });
      const parentTree = await git.readTree({
        fs: this.fs,
        dir: this.dir,
        oid: parentCommit.commit.tree,
      });

      // ファイルの差分を収集
      const changedFiles = new Map<string, { parentOid?: string; currentOid?: string }>();

      const collectTreeFiles = async (tree: any, basePath = ''): Promise<Map<string, string>> => {
        const files = new Map<string, string>();
        for (const entry of tree.tree) {
          const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path;
          if (entry.type === 'blob') {
            files.set(fullPath, entry.oid);
          } else if (entry.type === 'tree') {
            try {
              const subTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: entry.oid });
              const subFiles = await collectTreeFiles(subTree, fullPath);
              for (const [path, oid] of subFiles) {
                files.set(path, oid);
              }
            } catch (error) {
              console.warn(`Failed to read subtree ${fullPath}:`, error);
            }
          }
        }
        return files;
      };

      const parentFiles = await collectTreeFiles(parentTree);
      const currentFiles = await collectTreeFiles(currentTree);

      // 変更されたファイルを特定
      for (const [path, oid] of currentFiles) {
        const parentOid = parentFiles.get(path);
        if (!parentOid || parentOid !== oid) {
          changedFiles.set(path, { parentOid, currentOid: oid });
        }
      }

      // 削除されたファイルを特定
      for (const [path, oid] of parentFiles) {
        if (!currentFiles.has(path)) {
          changedFiles.set(path, { parentOid: oid, currentOid: undefined });
        }
      }

      console.log('[NEW ARCHITECTURE] Revert: Files to change:', changedFiles.size);

      // 変更を適用
      for (const [filePath, { parentOid }] of changedFiles) {
        const fullPath = `${this.dir}/${filePath}`;

        if (parentOid) {
          // ファイルを親コミットの状態に戻す
          try {
            const { blob } = await git.readBlob({
              fs: this.fs,
              dir: this.dir,
              oid: parentOid,
            });
            await this.fs.promises.writeFile(fullPath, blob);
            await git.add({ fs: this.fs, dir: this.dir, filepath: filePath });
          } catch (error) {
            console.error(`Failed to restore file ${filePath}:`, error);
          }
        } else {
          // ファイルを削除
          try {
            await this.fs.promises.unlink(fullPath);
            await git.remove({ fs: this.fs, dir: this.dir, filepath: filePath });
          } catch (error) {
            console.error(`Failed to remove file ${filePath}:`, error);
          }
        }
      }

      // リバートコミットを作成
      const shortHash = commitHash.slice(0, 7);
      const revertMessage = `Revert "${commitToRevert.commit.message.split('\n')[0]}"\n\nThis reverts commit ${fullCommitHash}.`;

      const commitOid = await git.commit({
        fs: this.fs,
        dir: this.dir,
        message: revertMessage,
        author: {
          name: 'Pyxis User',
          email: 'user@pyxis.local',
        },
      });

      console.log('[NEW ARCHITECTURE] Revert commit created:', commitOid.slice(0, 7));

      // [NEW ARCHITECTURE] GitFileSystem → IndexedDBへ逆同期
      console.log('[NEW ARCHITECTURE] Starting reverse sync: GitFileSystem → IndexedDB');
      await syncManager.syncFromFSToIndexedDB(this.projectId, this.projectName);
      console.log('[NEW ARCHITECTURE] Reverse sync completed');

      return `[${commitOid.slice(0, 7)}] ${revertMessage.split('\n')[0]}\n${changedFiles.size} files changed\n\n[NEW ARCHITECTURE] Changes synced to IndexedDB`;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('bad revision')) {
        throw new Error(errorMessage);
      } else if (errorMessage.includes('cannot revert initial commit')) {
        throw new Error(`error: ${errorMessage}`);
      } else if (errorMessage.includes('is a merge commit')) {
        throw new Error(`error: ${errorMessage}`);
      } else if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      } else if (errorMessage.includes('your local changes would be overwritten')) {
        throw new Error(errorMessage);
      }

      throw new Error(`git revert failed: ${errorMessage}`);
    }
  }
}
