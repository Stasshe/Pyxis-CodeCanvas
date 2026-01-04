import type FS from '@isomorphic-git/lightning-fs';

import { GitCheckoutOperations } from './checkout';
import { isRemoteRef, resolveRemoteRef } from './remoteUtils';

/**
 * [NEW ARCHITECTURE] Git switch操作を管理するクラス
 * - ローカルブランチ、リモートブランチ、コミットハッシュに対応
 * - checkout操作をラップして機能を提供
 * - リモートブランチはremoteUtilsを使用して標準化された処理を行う
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
   * Helper method to create checkout operations instance
   */
  private createCheckoutOperations(): GitCheckoutOperations {
    return new GitCheckoutOperations(this.fs, this.dir, this.projectId, this.projectName);
  }

  /**
   * git switch - ブランチまたはコミットに切り替え
   * origin/main, upstream/develop などのリモートブランチや
   * コミットハッシュにも対応
   *
   * Note: The `detach` option is accepted for API compatibility but currently
   * checkout to commit hashes or remote branches automatically results in
   * detached HEAD state.
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
      const { createNew = false } = options;
      // Note: detach option is not explicitly used as checkout to commits/remote refs
      // automatically enters detached HEAD state
      const normalizedRef = targetRef.trim();

      // コミットハッシュかどうかを判定（7文字以上の16進数、短縮系に対応）
      const isCommitHash = /^[a-f0-9]{7,}$/i.test(normalizedRef);

      if (isCommitHash) {
        // コミットハッシュの場合
        try {
          return await this.createCheckoutOperations().checkout(normalizedRef, false);
        } catch (error) {
          throw new Error(
            `Failed to checkout commit '${normalizedRef}': ${(error as Error).message}`
          );
        }
      }

      // Use remoteUtils to check if this is a remote reference
      if (isRemoteRef(normalizedRef)) {
        try {
          // Resolve remote branch using standardized utility
          const commitOid = await resolveRemoteRef(this.fs, this.dir, normalizedRef);

          if (!commitOid) {
            throw new Error(`Remote branch '${normalizedRef}' not found. Did you run 'git fetch'?`);
          }

          // detached HEAD状態でチェックアウト
          return await this.createCheckoutOperations().checkout(commitOid, false);
        } catch (error) {
          throw new Error(`Failed to switch to remote branch: ${(error as Error).message}`);
        }
      }

      // ローカルブランチ
      if (createNew) {
        // 新しいブランチを作成して切り替え
        return await this.createCheckoutOperations().checkout(normalizedRef, true);
      } else {
        // 既存のブランチに切り替え
        return await this.createCheckoutOperations().checkout(normalizedRef, false);
      }
    } catch (error) {
      throw new Error(`git switch failed: ${(error as Error).message}`);
    }
  }
}
