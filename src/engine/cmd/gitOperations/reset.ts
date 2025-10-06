import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { syncManager } from '@/engine/core/syncManager';

/**
 * [NEW ARCHITECTURE] Git reset操作を管理するクラス
 * - reset --hard後にsyncManager.syncFromFSToIndexedDB()で逆同期
 */
export class GitResetOperations {
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

  // [NEW ARCHITECTURE] git reset - ファイルをアンステージング、またはハードリセット + 逆同期
  async reset(
    options: { filepath?: string; hard?: boolean; commit?: string } = {}
  ): Promise<string> {
    try {
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const { filepath, hard, commit } = options;

      if (filepath) {
        // 特定のファイルをアンステージング
        console.log('[NEW ARCHITECTURE] Reset: Unstaging file:', filepath);
        await git.resetIndex({
          fs: this.fs,
          dir: this.dir,
          filepath,
        });
        return `Unstaged changes after reset:\nM\t${filepath}`;
      }

      if (hard) {
        // ハードリセット: ワーキングディレクトリとインデックスを指定コミットの状態に戻す
        const targetRef = commit || 'HEAD';

        console.log('[NEW ARCHITECTURE] Reset: Hard reset to', targetRef);

        // ターゲットコミットのOIDを取得（短縮形コミットIDも対応）
        let targetOid: string;
        try {
          // まず expandOid で短縮形コミットIDを解決を試行
          try {
            targetOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: targetRef });
          } catch {
            // expandOid が失敗した場合は resolveRef でブランチ/タグとして解決
            targetOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: targetRef });
          }
        } catch {
          throw new Error(
            `fatal: ambiguous argument '${targetRef}': unknown revision or path not in the working tree.`
          );
        }

        // 現在のブランチを取得してHEADを更新
        let currentBranch: string;
        try {
          currentBranch =
            (await git.currentBranch({
              fs: this.fs,
              dir: this.dir,
              fullname: true,
            })) || 'HEAD';
        } catch {
          currentBranch = 'HEAD';
        }

        // ブランチが取得できた場合はブランチのHEADを更新、そうでなければHEADを直接更新
        await git.writeRef({
          fs: this.fs,
          dir: this.dir,
          ref: currentBranch,
          value: targetOid,
          force: true,
        });

        // ワーキングディレクトリをターゲットコミットの状態に復元
        const targetCommit = await git.readCommit({
          fs: this.fs,
          dir: this.dir,
          oid: targetOid,
        });

        const targetTree = await git.readTree({
          fs: this.fs,
          dir: this.dir,
          oid: targetCommit.commit.tree,
        });

        // 現在のファイルをすべて削除（.gitディレクトリ以外）
        const deleteAllFiles = async (dirPath: string): Promise<void> => {
          try {
            const entries = await this.fs.promises.readdir(dirPath);
            for (const entry of entries) {
              if (entry === '.git') continue;
              const fullPath = `${dirPath}/${entry}`;
              try {
                const stats = await this.fs.promises.stat(fullPath);
                if (stats.type === 'dir') {
                  await deleteAllFiles(fullPath);
                  await this.fs.promises.rmdir(fullPath);
                } else {
                  await this.fs.promises.unlink(fullPath);
                }
              } catch (error) {
                console.warn(`Failed to delete ${fullPath}:`, error);
              }
            }
          } catch (error) {
            console.warn(`Failed to read directory ${dirPath}:`, error);
          }
        };

        await deleteAllFiles(this.dir);

        // git.checkoutを使用してターゲットコミットの状態を復元
        // これによりディレクトリ構造も自動的に作成される
        console.log('[NEW ARCHITECTURE] Reset: Checking out target commit');

        // ブランチが存在する場合はブランチ名でcheckout、detached HEAD状態の場合はOIDでcheckout
        const checkoutRef = currentBranch !== 'HEAD' ? currentBranch : targetOid;
        await git.checkout({
          fs: this.fs,
          dir: this.dir,
          ref: checkoutRef,
          force: true,
        });

        // 復元されたファイル数をカウント
        const countFiles = async (dirPath: string): Promise<number> => {
          let count = 0;
          try {
            const entries = await this.fs.promises.readdir(dirPath);
            for (const entry of entries) {
              if (entry === '.git') continue;
              const fullPath = `${dirPath}/${entry}`;
              try {
                const stats = await this.fs.promises.stat(fullPath);
                if (stats.type === 'dir') {
                  count += await countFiles(fullPath);
                } else {
                  count++;
                }
              } catch (error) {
                // Ignore
              }
            }
          } catch (error) {
            // Ignore
          }
          return count;
        };

        const restoredCount = await countFiles(this.dir);
        console.log('[NEW ARCHITECTURE] Reset: Restored files count:', restoredCount);

        // [NEW ARCHITECTURE] GitFileSystem → IndexedDBへ逆同期
        console.log('[NEW ARCHITECTURE] Starting reverse sync: GitFileSystem → IndexedDB');
        await syncManager.syncFromFSToIndexedDB(this.projectId, this.projectName);
        console.log('[NEW ARCHITECTURE] Reverse sync completed');

        const shortHash = targetOid.slice(0, 7);
        const commitMessage = targetCommit.commit.message.split('\n')[0];
        return `HEAD is now at ${shortHash} ${commitMessage}\n\n[NEW ARCHITECTURE] ${restoredCount} files synced to IndexedDB`;
      }

      // 通常のリセット（ソフトリセット）
      const targetRef = commit || 'HEAD';
      console.log('[NEW ARCHITECTURE] Reset: Soft reset to', targetRef);

      // ソフトリセット用のOID解決（短縮形コミットIDも対応）
      let targetOid: string;
      try {
        // まず expandOid で短縮形コミットIDを解決を試行
        try {
          targetOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: targetRef });
        } catch {
          // expandOid が失敗した場合は resolveRef でブランチ/タグとして解決
          targetOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: targetRef });
        }
      } catch {
        throw new Error(
          `fatal: ambiguous argument '${targetRef}': unknown revision or path not in the working tree.`
        );
      }

      // ソフトリセットはステージングエリアをクリア
      // isomorphic-gitではgit.checkoutを使用してインデックスを更新
      try {
        await git.checkout({ fs: this.fs, dir: this.dir, ref: targetOid });
      } catch {
        console.error('Failed to perform soft reset checkout');
      }

      return 'Unstaged changes after reset';
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      } else if (
        errorMessage.includes('unknown revision') ||
        errorMessage.includes('ambiguous argument')
      ) {
        throw new Error(errorMessage);
      } else if (errorMessage.includes('bad revision')) {
        throw new Error(`fatal: bad revision - commit not found`);
      }

      throw new Error(`git reset failed: ${errorMessage}`);
    }
  }
}
