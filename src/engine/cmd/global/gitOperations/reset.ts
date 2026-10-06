import git from 'isomorphic-git';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';

export class GitResetOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  async reset(
    options: { filepath?: string; hard?: boolean; commit?: string } = {}
  ): Promise<string> {
    try {
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const { filepath, hard, commit } = options;

      if (filepath) {
        console.log('Reset: Unstaging file:', filepath);
        await git.resetIndex({
          fs: this.fs,
          dir: this.dir,
          filepath: repositoryPath(this.dir, filepath),
        });
        return `Unstaged changes after reset:\nM\t${filepath}`;
      }

      if (hard) {
        const targetRef = commit || 'HEAD';

        console.log('Reset: Hard reset to', targetRef);

        let targetOid: string;
        try {
          try {
            targetOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: targetRef });
          } catch {
            targetOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: targetRef });
          }
        } catch {
          throw new Error(
            `fatal: ambiguous argument '${targetRef}': unknown revision or path not in the working tree.`
          );
        }

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

        await git.writeRef({
          fs: this.fs,
          dir: this.dir,
          ref: currentBranch,
          value: targetOid,
          force: true,
        });

        const targetCommit = await git.readCommit({
          fs: this.fs,
          dir: this.dir,
          oid: targetOid,
        });

        console.log('Reset: Checking out target commit');

        let checkoutRef = targetOid;
        if (currentBranch !== 'HEAD') checkoutRef = currentBranch;
        await git.checkout({
          fs: this.fs,
          dir: this.dir,
          ref: checkoutRef,
          force: true,
        });

        const countFiles = async (dirPath: string): Promise<number> => {
          let count = 0;
          try {
            const entries = await this.fs.promises.readdir(dirPath);
            for (const entry of entries) {
              if (entry === '.git') continue;
              const fullPath = `${dirPath}/${entry}`;
              try {
                const stats = await this.fs.promises.stat(fullPath);
                if (stats.isDirectory()) {
                  count += await countFiles(fullPath);
                } else {
                  count++;
                }
              } catch (error) {
                console.warn('[reset.ts] caught non-fatal error', error);
              }
            }
          } catch (error) {
            console.warn('[reset.ts] caught non-fatal error', error);
          }
          return count;
        };

        const restoredCount = await countFiles(this.dir);
        console.log('Reset: Restored files count:', restoredCount);

        const shortHash = targetOid.slice(0, 7);
        const commitMessage = targetCommit.commit.message.split('\n')[0];
        return `HEAD is now at ${shortHash} ${commitMessage}\n\n${restoredCount} files restored`;
      }

      const targetRef = commit || 'HEAD';
      console.log('Reset: Soft reset to', targetRef);

      let targetOid: string;
      try {
        try {
          targetOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: targetRef });
        } catch {
          targetOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: targetRef });
        }
      } catch {
        throw new Error(
          `fatal: ambiguous argument '${targetRef}': unknown revision or path not in the working tree.`
        );
      }

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

      await git.writeRef({
        fs: this.fs,
        dir: this.dir,
        ref: currentBranch,
        value: targetOid,
        force: true,
      });

      const targetCommit = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: targetOid,
      });

      const shortHash = targetOid.slice(0, 7);
      const commitMessage = targetCommit.commit.message.split('\n')[0];
      return `HEAD is now at ${shortHash} ${commitMessage}`;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      }
      if (
        errorMessage.includes('unknown revision') ||
        errorMessage.includes('ambiguous argument')
      ) {
        throw new Error(errorMessage);
      }
      if (errorMessage.includes('bad revision')) {
        throw new Error('fatal: bad revision - commit not found');
      }

      throw new Error(`git reset failed: ${errorMessage}`);
    }
  }
}
