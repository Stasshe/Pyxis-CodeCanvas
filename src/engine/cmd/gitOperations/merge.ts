import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitFileSystemHelper } from './fileSystemHelper';
import { syncManager } from '@/engine/core/syncManager';

/**
 * [NEW ARCHITECTURE] Git merge操作を管理するクラス
 * - merge後にsyncManager.syncFromFSToIndexedDB()で逆同期
 */
export class GitMergeOperations {
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

  // プロジェクトディレクトリの存在を確認し、なければ作成
  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
  }

  // Gitリポジトリが初期化されているかチェック
  private async ensureGitRepository(): Promise<void> {
    await this.ensureProjectDirectory();
    try {
      await this.fs.promises.stat(`${this.dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }
  }

  // 現在のブランチ名を取得
  private async getCurrentBranch(): Promise<string> {
    try {
      await this.ensureGitRepository();
      const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });
      return branch || 'main';
    } catch {
      return '(no git)';
    }
  }

  // ブランチが存在するかチェック
  private async branchExists(branchName: string): Promise<boolean> {
    try {
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/heads/${branchName}` });
      return true;
    } catch {
      return false;
    }
  }

  // ワーキングディレクトリがクリーンかチェック
  private async isWorkingDirectoryClean(): Promise<boolean> {
    try {
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });

      // 変更されたファイルまたはステージされたファイルがあるかチェック
      for (const [filepath, HEAD, workdir, stage] of status) {
        // 変更がある場合
        if (HEAD !== workdir || stage !== HEAD) {
          return false;
        }
      }

      return true;
    } catch {
      return true; // エラーの場合はクリーンとみなす
    }
  }

  // すべてのファイルを取得（再帰的）
  private async getAllFiles(dirPath: string): Promise<string[]> {
    return await GitFileSystemHelper.getAllFiles(this.fs, dirPath);
  }

  // Fast-forward マージかチェック
  private async canFastForward(
    sourceBranch: string,
    targetBranch: string
  ): Promise<{ canFF: boolean; sourceCommit: string; targetCommit: string }> {
    try {
      const sourceCommit = await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: `refs/heads/${sourceBranch}`,
      });
      const targetCommit = await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: `refs/heads/${targetBranch}`,
      });

      // targetBranchがsourceBranchの祖先かチェック（bがaの祖先か？）
      const isAncestor = await git.isDescendent({
        fs: this.fs,
        dir: this.dir,
        oid: targetCommit,
        ancestor: sourceCommit,
      });

      return {
        canFF: isAncestor,
        sourceCommit,
        targetCommit,
      };
    } catch (error) {
      throw new Error(`Failed to check fast-forward possibility: ${(error as Error).message}`);
    }
  }

  // git merge - ブランチをマージ
  async merge(
    branchName: string,
    options: { noFf?: boolean; message?: string; abort?: boolean } = {}
  ): Promise<string> {
    try {
      await this.ensureGitRepository();

      // git merge --abort の処理
      if (options.abort) {
        // 簡易実装: マージ中の状態をリセット
        return 'Merge aborted (not fully implemented yet)';
      }

      // ワーキングディレクトリがクリーンかチェック
      const isClean = await this.isWorkingDirectoryClean();
      if (!isClean) {
        return 'error: Your local changes to the following files would be overwritten by merge:\nPlease commit your changes or stash them before you merge.';
      }

      // 現在のブランチを取得
      const currentBranch = await this.getCurrentBranch();

      // 自分自身をマージしようとした場合
      if (currentBranch === branchName) {
        return `Already up to date.`;
      }

      // マージ対象のブランチが存在するかチェック
      if (!(await this.branchExists(branchName))) {
        const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
        return `merge: ${branchName} - not something we can merge\nAvailable branches: ${branches.join(', ')}`;
      }

      // Fast-forward チェック
      const { canFF, sourceCommit, targetCommit } = await this.canFastForward(
        currentBranch,
        branchName
      );

      // Fast-forward マージの場合
      if (canFF && !options.noFf) {
        console.log('[NEW ARCHITECTURE] Performing fast-forward merge');

        // Fast-forward マージを実行（HEADを対象ブランチに移動）
        await git.writeRef({
          fs: this.fs,
          dir: this.dir,
          ref: `refs/heads/${currentBranch}`,
          value: targetCommit,
        });

        // ワーキングディレクトリを更新
        await git.checkout({ fs: this.fs, dir: this.dir, ref: currentBranch });

        // [NEW ARCHITECTURE] GitFileSystem → IndexedDBへ逆同期
        console.log('[NEW ARCHITECTURE] Starting reverse sync: GitFileSystem → IndexedDB');
        await syncManager.syncFromFSToIndexedDB(this.projectId, this.projectName);
        console.log('[NEW ARCHITECTURE] Reverse sync completed');

        const shortTarget = targetCommit.slice(0, 7);
        return `Updating ${sourceCommit.slice(0, 7)}..${shortTarget}\nFast-forward\n\n[NEW ARCHITECTURE] Changes synced to IndexedDB`;
      }

      // 3-way マージを実行
      console.log('[NEW ARCHITECTURE] Performing 3-way merge');

      const commitMessage = options.message || `Merge branch '${branchName}' into ${currentBranch}`;

      try {
        // isomorphic-git の merge 関数を使用
        const result = await git.merge({
          fs: this.fs,
          dir: this.dir,
          ours: currentBranch,
          theirs: branchName,
          author: {
            name: 'User',
            email: 'user@pyxis.dev',
          },
          committer: {
            name: 'User',
            email: 'user@pyxis.dev',
          },
          message: commitMessage,
        });

        console.log('[NEW ARCHITECTURE] Merge result:', result);

        // マージが成功した場合
        if (result && !result.alreadyMerged) {
          // マージコミットのOIDをcheckoutし、その状態を反映
          if (result.oid) {
            await git.checkout({ fs: this.fs, dir: this.dir, ref: result.oid });
          }

          // [NEW ARCHITECTURE] GitFileSystem → IndexedDBへ逆同期
          console.log('[NEW ARCHITECTURE] Starting reverse sync: GitFileSystem → IndexedDB');
          await syncManager.syncFromFSToIndexedDB(this.projectId, this.projectName);
          console.log('[NEW ARCHITECTURE] Reverse sync completed');

          const mergeCommit = result.oid ? result.oid.slice(0, 7) : 'unknown';
          return `Merge made by the 'ort' strategy.\nMerge commit: ${mergeCommit}\n\n[NEW ARCHITECTURE] Changes synced to IndexedDB`;
        } else if (result && result.alreadyMerged) {
          return `Already up to date.`;
        } else {
          // [NEW ARCHITECTURE] GitFileSystem → IndexedDBへ逆同期
          console.log('[NEW ARCHITECTURE] Starting reverse sync: GitFileSystem → IndexedDB');
          await syncManager.syncFromFSToIndexedDB(this.projectId, this.projectName);
          console.log('[NEW ARCHITECTURE] Reverse sync completed');

          return `Merge completed successfully.\n\n[NEW ARCHITECTURE] Changes synced to IndexedDB`;
        }
      } catch (mergeError) {
        const error = mergeError as any;
        // マージコンフリクトの場合
        if (error.code === 'MergeNotSupportedError' || error.message?.includes('conflict')) {
          return `CONFLICT: Automatic merge failed. Please resolve conflicts manually.\nMerge conflicts detected in the following files. This CLI doesn't support conflict resolution yet.`;
        }
        // その他のマージエラー
        throw new Error(`Merge failed: ${error.message}`);
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      // 特定のエラーは再スロー
      if (errorMessage.includes('not a git repository')) {
        throw error;
      }

      // その他のエラーは詳細なメッセージで包む
      throw new Error(`git merge failed: ${errorMessage}`);
    }
  }

  // git merge --abort - マージを中止（簡易実装）
  async mergeAbort(): Promise<string> {
    try {
      await this.ensureGitRepository();

      // マージ状態をチェック（MERGE_HEADファイルの存在確認）
      try {
        await this.fs.promises.stat(`${this.dir}/.git/MERGE_HEAD`);
      } catch {
        return 'fatal: There is no merge to abort (MERGE_HEAD missing).';
      }

      // MERGE_HEAD ファイルを削除してマージ状態をクリア
      try {
        await this.fs.promises.unlink(`${this.dir}/.git/MERGE_HEAD`);

        // MERGE_MSG ファイルも削除（存在する場合）
        try {
          await this.fs.promises.unlink(`${this.dir}/.git/MERGE_MSG`);
        } catch {
          // MERGE_MSG がない場合は無視
        }

        // 現在のブランチにハードリセット
        const currentBranch = await this.getCurrentBranch();
        await git.checkout({ fs: this.fs, dir: this.dir, ref: currentBranch, force: true });

        // [NEW ARCHITECTURE] GitFileSystem → IndexedDBへ逆同期
        console.log('[NEW ARCHITECTURE] Starting reverse sync: GitFileSystem → IndexedDB');
        await syncManager.syncFromFSToIndexedDB(this.projectId, this.projectName);
        console.log('[NEW ARCHITECTURE] Reverse sync completed');

        return `Merge aborted. Working tree has been reset.\n\n[NEW ARCHITECTURE] Changes synced to IndexedDB`;
      } catch (error) {
        throw new Error(`Failed to abort merge: ${(error as Error).message}`);
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('not a git repository')) {
        throw error;
      }

      throw new Error(`git merge --abort failed: ${errorMessage}`);
    }
  }
}
