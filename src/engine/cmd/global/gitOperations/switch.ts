import type FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitCheckoutOperations } from './checkout';

/**
 * [NEW ARCHITECTURE] Git switch操作を管理するクラス
 * - ローカルブランチ、リモートブランチ、コミットハッシュに対応
 * - checkout操作をラップして機能を提供
 */
export class GitSwitchOperations {
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

  private async ensureGitRepository(): Promise<void> {
    try {
      await this.fs.promises.stat(`${this.dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }
  }

  /**
   * git switch - ブランチまたはコミットに切り替え
   * origin/main, upstream/develop などのリモートブランチや
   * コミットハッシュにも対応
   */
  async switch(
    targetRef: string,
    options: {
      createNew?: boolean;
      detach?: boolean;
    } = {}
  ): Promise<string> {
    await this.ensureGitRepository();

    try {
      const { createNew = false, detach = false } = options;
      const normalizedRef = targetRef.trim();

      // コミットハッシュかどうかを判定（7文字以上の16進数、短縮系に対応）
      const isCommitHash = /^[a-f0-9]{7,}$/i.test(normalizedRef);

      if (isCommitHash) {
        // コミットハッシュの場合
        try {
          const checkoutOperations = new GitCheckoutOperations(
            this.fs,
            this.dir,
            this.projectId,
            this.projectName
          );
          return await checkoutOperations.checkout(normalizedRef, false);
        } catch (error) {
          throw new Error(
            `Failed to checkout commit '${normalizedRef}': ${(error as Error).message}`
          );
        }
      }

      // リモートブランチかどうかを判定（remote/branch形式）
      if (normalizedRef.includes('/')) {
        // origin/main, upstream/develop など
        try {
          // リモート追跡ブランチの参照を確認
          const remoteRef = `refs/remotes/${normalizedRef}`;
          let commitOid: string;

          try {
            commitOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: remoteRef });
          } catch {
            throw new Error(`Remote branch '${normalizedRef}' not found. Did you run 'git fetch'?`);
          }

          // detached HEAD状態でチェックアウト
          const checkoutOperations = new GitCheckoutOperations(
            this.fs,
            this.dir,
            this.projectId,
            this.projectName
          );

          return await checkoutOperations.checkout(commitOid, false);
        } catch (error) {
          throw new Error(`Failed to switch to remote branch: ${(error as Error).message}`);
        }
      }

      // ローカルブランチ
      if (createNew) {
        // 新しいブランチを作成して切り替え
        const checkoutOperations = new GitCheckoutOperations(
          this.fs,
          this.dir,
          this.projectId,
          this.projectName
        );
        return await checkoutOperations.checkout(normalizedRef, true);
      } else {
        // 既存のブランチに切り替え
        const checkoutOperations = new GitCheckoutOperations(
          this.fs,
          this.dir,
          this.projectId,
          this.projectName
        );
        return await checkoutOperations.checkout(normalizedRef, false);
      }
    } catch (error) {
      throw new Error(`git switch failed: ${(error as Error).message}`);
    }
  }
}
