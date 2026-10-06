import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { GitFileSystemHelper } from './fileSystemHelper';
import { isRemoteRef, resolveRemoteRef, toFullRemoteRef } from './remoteUtils';

export class GitCheckoutOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
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

      let targetCommitHash: string | undefined;
      let resolvedFromRemote = false;
      let resolvedFromLocal = false;

      if (createNew) {
        try {
          targetCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
        } catch {
          throw new Error('Cannot create new branch - no commits found in current branch');
        }
        await git.branch({ fs: this.fs, dir: this.dir, ref: branchName });
      } else {
        if (isRemoteRef(branchName)) {
          const remoteOid = await resolveRemoteRef(this.fs, this.dir, branchName);
          if (remoteOid) {
            targetCommitHash = remoteOid;
            resolvedFromRemote = true;
          }
        }

        if (!targetCommitHash) {
          try {
            targetCommitHash = await git.resolveRef({
              fs: this.fs,
              dir: this.dir,
              ref: `refs/heads/${branchName}`,
            });
            resolvedFromLocal = true;
          } catch {
            try {
              targetCommitHash = await git.resolveRef({
                fs: this.fs,
                dir: this.dir,
                ref: branchName,
              });
              if (branchName.startsWith('refs/remotes/')) resolvedFromRemote = true;
              if (branchName.startsWith('refs/heads/')) resolvedFromLocal = true;
            } catch {
              try {
                const expandedOid = await git.expandOid({
                  fs: this.fs,
                  dir: this.dir,
                  oid: branchName,
                });
                targetCommitHash = expandedOid;
              } catch {
                try {
                  const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
                  throw new Error(
                    `pathspec '${branchName}' did not match any file(s) known to git\nAvailable branches: ${branches.join(', ')}`
                  );
                } catch {
                  throw new Error(
                    `pathspec '${branchName}' did not match any file(s) known to git`
                  );
                }
              }
            }
          }
        }
      }

      let checkoutRef = targetCommitHash || branchName;
      if (createNew || resolvedFromLocal) checkoutRef = branchName;

      console.log('Executing git checkout (ref):', checkoutRef);
      await git.checkout({ fs: this.fs, dir: this.dir, ref: checkoutRef });
      console.log('Checkout completed');

      if (!targetCommitHash) {
        throw new Error(`Failed to resolve ref: ${branchName}`);
      }

      const targetCommit = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: targetCommitHash,
      });

      let result = '';
      if (createNew) {
        result = `Switched to a new branch '${branchName}'`;
      } else if (
        resolvedFromRemote ||
        (branchName.length >= 7 && branchName === targetCommitHash.slice(0, branchName.length))
      ) {
        const shortHash = targetCommitHash.slice(0, 7);
        const commitMessage = targetCommit.commit.message.split('\n')[0];
        result = `Note: switching to '${branchName}'.\n\nYou are in 'detached HEAD' state.\nHEAD is now at ${shortHash} ${commitMessage}`;
      } else {
        result = `Switched to branch '${branchName}'`;
      }

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('pathspec')) {
        throw new Error(errorMessage);
      }
      if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      }
      if (errorMessage.includes('Cannot create new branch')) {
        throw new Error(`fatal: ${errorMessage}`);
      }

      throw new Error(`git checkout failed: ${errorMessage}`);
    }
  }
}
