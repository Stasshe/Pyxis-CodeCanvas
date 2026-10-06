import type { GitFs as FS } from '@/engine/core/fs/git';

import { GitCheckoutOperations } from './checkout';
import { isRemoteRef, resolveRemoteRef } from './remoteUtils';

export class GitSwitchOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  private async ensureGitRepository(): Promise<void> {
    try {
      await this.fs.promises.stat(`${this.dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }
  }

  private createCheckoutOperations(): GitCheckoutOperations {
    return new GitCheckoutOperations(this.fs, this.dir);
  }

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
      const normalizedRef = targetRef.trim();

      const isCommitHash = /^[a-f0-9]{7,}$/i.test(normalizedRef);

      if (isCommitHash) {
        try {
          return await this.createCheckoutOperations().checkout(normalizedRef, false);
        } catch (error) {
          throw new Error(
            `Failed to checkout commit '${normalizedRef}': ${(error as Error).message}`
          );
        }
      }

      if (isRemoteRef(normalizedRef)) {
        try {
          const commitOid = await resolveRemoteRef(this.fs, this.dir, normalizedRef);

          if (!commitOid) {
            throw new Error(`Remote branch '${normalizedRef}' not found. Did you run 'git fetch'?`);
          }

          return await this.createCheckoutOperations().checkout(commitOid, false);
        } catch (error) {
          throw new Error(`Failed to switch to remote branch: ${(error as Error).message}`);
        }
      }

      if (createNew) {
        return await this.createCheckoutOperations().checkout(normalizedRef, true);
      }
      return await this.createCheckoutOperations().checkout(normalizedRef, false);
    } catch (error) {
      throw new Error(`git switch failed: ${(error as Error).message}`);
    }
  }
}
