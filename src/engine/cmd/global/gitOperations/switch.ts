import type { GitFs as FS } from '@/engine/core/fs/git';

import { GitCheckoutOperations } from './checkout';

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
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
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
      const { createNew = false, detach = false } = options;
      if (createNew && detach) throw new Error('Cannot combine branch creation with detached HEAD');
      const normalizedRef = targetRef.trim();

      return await this.createCheckoutOperations().checkout(normalizedRef, createNew, detach);
    } catch (error) {
      throw new Error(`git switch failed: ${(error as Error).message}`);
    }
  }
}
