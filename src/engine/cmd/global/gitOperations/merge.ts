import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { GitFileSystemHelper } from './fileSystemHelper';
import { MergeConflictDetector } from './mergeConflictDetector';

export class GitMergeOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
  }

  private async ensureGitRepository(): Promise<void> {
    await this.ensureProjectDirectory();
    try {
      await this.fs.promises.stat(`${this.dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }
  }

  private async getCurrentBranch(): Promise<string | null> {
    try {
      await this.ensureGitRepository();
      const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });
      return branch || null;
    } catch {
      return null;
    }
  }

  private async branchExists(branchName: string): Promise<boolean> {
    try {
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/heads/${branchName}` });
      return true;
    } catch {
      return false;
    }
  }

  private async isWorkingDirectoryClean(): Promise<boolean> {
    try {
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });

      for (const [_filepath, HEAD, workdir, stage] of status) {
        if (HEAD !== workdir || stage !== HEAD) {
          return false;
        }
      }

      return true;
    } catch {
      return true;
    }
  }

  private async getAllFiles(dirPath: string): Promise<string[]> {
    return await GitFileSystemHelper.getAllFiles(this.fs, dirPath);
  }

  private async resolveBranchCommit(branchName: string): Promise<string> {
    const tryRefs = [`refs/heads/${branchName}`, `refs/remotes/${branchName}`, branchName];

    for (let i = 0; i < tryRefs.length; i++) {
      try {
        const oid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: tryRefs[i] });
        return oid;
      } catch {}
    }

    try {
      const remoteRef = `refs/remotes/${branchName}`;
      const oid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: remoteRef });
      return oid;
    } catch (error) {
      throw new Error(
        `Failed to resolve branch ref for '${branchName}': ${(error as Error).message}`
      );
    }
  }

  private async canFastForward(
    sourceBranch: string,
    targetBranch: string
  ): Promise<{ canFF: boolean; sourceCommit: string; targetCommit: string }> {
    try {
      const sourceCommit = await this.resolveBranchCommit(sourceBranch);
      const targetCommit = await this.resolveBranchCommit(targetBranch);

      const isDescendent = await git.isDescendent({
        fs: this.fs,
        dir: this.dir,
        oid: targetCommit,
        ancestor: sourceCommit,
      });

      return {
        canFF: isDescendent,
        sourceCommit,
        targetCommit,
      };
    } catch (error) {
      throw new Error(`Failed to check fast-forward possibility: ${(error as Error).message}`);
    }
  }

  async merge(
    branchName: string,
    options: { noFf?: boolean; message?: string; abort?: boolean } = {}
  ): Promise<string> {
    try {
      await this.ensureGitRepository();

      if (options.abort) {
        return 'Merge aborted (not fully implemented yet)';
      }

      const isClean = await this.isWorkingDirectoryClean();
      if (!isClean) {
        return 'error: Your local changes to the following files would be overwritten by merge:\nPlease commit your changes or stash them before you merge.';
      }

      const currentBranch = await this.getCurrentBranch();

      if (!currentBranch) {
        return 'fatal: You are not currently on a branch.\nTo make a commit, create a new branch or switch to an existing branch.';
      }

      if (currentBranch === branchName) {
        return 'Already up to date.';
      }

      if (!(await this.branchExists(branchName))) {
        const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
        return `merge: ${branchName} - not something we can merge\nAvailable branches: ${branches.join(', ')}`;
      }

      const { canFF, sourceCommit, targetCommit } = await this.canFastForward(
        currentBranch,
        branchName
      );

      if (canFF && !options.noFf) {
        console.log('Performing fast-forward merge');

        await git.writeRef({
          fs: this.fs,
          dir: this.dir,
          ref: `refs/heads/${currentBranch}`,
          value: targetCommit,
        });

        await git.checkout({ fs: this.fs, dir: this.dir, ref: currentBranch });

        const shortTarget = targetCommit.slice(0, 7);
        return `Updating ${sourceCommit.slice(0, 7)}..${shortTarget}\nFast-forward`;
      }

      console.log('Performing 3-way merge');

      const commitMessage = options.message || `Merge branch '${branchName}' into ${currentBranch}`;

      try {
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

        console.log('Merge result:', result);

        if (result && !result.alreadyMerged) {
          if (result.oid) {
            await git.checkout({ fs: this.fs, dir: this.dir, ref: result.oid });
          }

          let mergeCommit = 'unresolved';
          if (result.oid) mergeCommit = result.oid.slice(0, 7);
          return `Merge made by the 'ort' strategy.\nMerge commit: ${mergeCommit}`;
        }
        if (result?.alreadyMerged) {
          return 'Already up to date.';
        }

        return 'Merge completed successfully.';
      } catch (mergeError) {
        const error = mergeError as Error & { code?: string };
        if (error.code === 'MergeNotSupportedError' || error.message?.includes('conflict')) {
          console.log('Merge conflict detected, opening resolution tab');

          const detector = new MergeConflictDetector(this.fs, this.dir);
          const conflicts = await detector.detectConflicts(currentBranch, branchName);

          if (conflicts.length > 0) {
            await this.fs.reportMergeConflict({
              conflicts,
              oursBranch: currentBranch,
              theirsBranch: branchName,
              root: this.dir,
            });

            return `CONFLICT: Automatic merge failed.\n${conflicts.length} conflicting file(s) detected.\nMerge conflict resolution tab has been opened.`;
          }

          return 'CONFLICT: Automatic merge failed. Please resolve conflicts manually.\nMerge conflicts detected but could not extract conflict details.';
        }
        throw new Error(`Merge failed: ${error.message}`);
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('not a git repository')) {
        throw error;
      }

      throw new Error(`git merge failed: ${errorMessage}`);
    }
  }

  async mergeAbort(): Promise<string> {
    try {
      await this.ensureGitRepository();

      try {
        await this.fs.promises.stat(`${this.dir}/.git/MERGE_HEAD`);
      } catch {
        return 'fatal: There is no merge to abort (MERGE_HEAD missing).';
      }

      try {
        await this.fs.promises.unlink(`${this.dir}/.git/MERGE_HEAD`);

        try {
          await this.fs.promises.unlink(`${this.dir}/.git/MERGE_MSG`);
        } catch {}

        const currentBranch = await this.getCurrentBranch();
        if (currentBranch) {
          await git.checkout({ fs: this.fs, dir: this.dir, ref: currentBranch, force: true });
        }

        return 'Merge aborted. Working tree has been reset.';
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
