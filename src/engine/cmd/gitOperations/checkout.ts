import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitFileSystemHelper } from './fileSystemHelper';
import { syncManager } from '@/engine/core/syncManager';

/**
 * [NEW ARCHITECTURE] Git checkout操作を管理するクラス
 * - checkout後にsyncManager.syncFromFSToIndexedDB()で逆同期
 */
export class GitCheckoutOperations {
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

  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
  }

  private async getCurrentBranch(): Promise<string> {
    try {
      return (await git.currentBranch({ fs: this.fs, dir: this.dir, fullname: false })) || 'HEAD';
    } catch {
      return 'HEAD';
    }
  }

  private async getAllFiles(dirPath: string): Promise<string[]> {
    return await GitFileSystemHelper.getAllFiles(this.fs, dirPath);
  }

  // [NEW ARCHITECTURE] git checkout - ブランチ切り替え/作成 + 逆同期
  async checkout(branchName: string, createNew = false): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const currentBranch = await this.getCurrentBranch();

      if (currentBranch === branchName && !createNew) {
        return `Already on '${branchName}'`;
      }

      let targetCommitHash: string;
      let isNewBranch = createNew;

      if (createNew) {
        try {
          targetCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
        } catch {
          throw new Error('Cannot create new branch - no commits found in current branch');
        }
        await git.branch({ fs: this.fs, dir: this.dir, ref: branchName });
      } else {
        try {
          try {
            targetCommitHash = await git.resolveRef({
              fs: this.fs,
              dir: this.dir,
              ref: `refs/heads/${branchName}`,
            });
          } catch {
            try {
              const expandedOid = await git.expandOid({
                fs: this.fs,
                dir: this.dir,
                oid: branchName,
              });
              targetCommitHash = expandedOid;
              isNewBranch = false;
            } catch {
              try {
                const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
                throw new Error(
                  `pathspec '${branchName}' did not match any file(s) known to git\nAvailable branches: ${branches.join(', ')}`
                );
              } catch {
                throw new Error(`pathspec '${branchName}' did not match any file(s) known to git`);
              }
            }
          }
        } catch (error) {
          throw error;
        }
      }

      // チェックアウト前のファイル数を記録
      const beforeFiles = await this.getAllFiles(this.dir);
      console.log('[NEW ARCHITECTURE] Checkout: Before files count:', beforeFiles.length);

      // チェックアウト実行
      console.log('[NEW ARCHITECTURE] Executing git checkout:', branchName);
      await git.checkout({ fs: this.fs, dir: this.dir, ref: branchName });
      console.log('[NEW ARCHITECTURE] Checkout completed');

      // チェックアウト後のファイル数を記録
      const afterFiles = await this.getAllFiles(this.dir);
      console.log('[NEW ARCHITECTURE] Checkout: After files count:', afterFiles.length);

      // [NEW ARCHITECTURE] GitFileSystem → IndexedDBへ逆同期
      console.log('[NEW ARCHITECTURE] Starting reverse sync: GitFileSystem → IndexedDB');
      await syncManager.syncFromFSToIndexedDB(this.projectId, this.projectName);
      console.log('[NEW ARCHITECTURE] Reverse sync completed');

      // ターゲットコミットの情報を取得
      const targetCommit = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: targetCommitHash,
      });

      // 結果メッセージを生成
      let result = '';
      if (createNew) {
        result = `Switched to a new branch '${branchName}'`;
      } else if (
        branchName.length >= 7 &&
        branchName === targetCommitHash.slice(0, branchName.length)
      ) {
        const shortHash = targetCommitHash.slice(0, 7);
        const commitMessage = targetCommit.commit.message.split('\n')[0];
        result = `Note: switching to '${branchName}'.\n\nYou are in 'detached HEAD' state.\nHEAD is now at ${shortHash} ${commitMessage}`;
      } else {
        result = `Switched to branch '${branchName}'`;
      }

      // ファイル変更数を追加
      const filesChanged = Math.abs(afterFiles.length - beforeFiles.length);
      if (filesChanged > 0) {
        result += `\n\n[NEW ARCHITECTURE] Files synced to IndexedDB: ${afterFiles.length}`;
      }

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('pathspec')) {
        throw new Error(errorMessage);
      } else if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      } else if (errorMessage.includes('Cannot create new branch')) {
        throw new Error(`fatal: ${errorMessage}`);
      }

      throw new Error(`git checkout failed: ${errorMessage}`);
    }
  }
}
