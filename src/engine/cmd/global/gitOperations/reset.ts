import git from 'isomorphic-git';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';
import { clearMergeState } from './mergeState';

export class GitResetOperations {
  constructor(
    private fs: FS,
    private dir: string
  ) {}

  async reset(
    options: { filepath?: string; hard?: boolean; commit?: string } = {}
  ): Promise<string> {
    try {
      await this.fs.promises.stat(`${this.dir}/.git`);
      const { filepath, hard, commit } = options;
      if (filepath) {
        await git.resetIndex({
          fs: this.fs,
          dir: this.dir,
          filepath: repositoryPath(this.dir, filepath),
        });
        const path = repositoryPath(this.dir, filepath);
        const status = await git.statusMatrix({ fs: this.fs, dir: this.dir, filepaths: [path] });
        const entry = status.find(([file]) => file === path);
        if (!entry || entry[1] === entry[2] || entry[1] === 0) return '';
        let change = 'M';
        if (entry[2] === 0) change = 'D';
        return `Unstaged changes after reset:\n${change}\t${filepath}`;
      }

      const targetRef = commit || 'HEAD';
      let targetOid: string;
      try {
        targetOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: targetRef });
      } catch {
        targetOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: targetRef });
      }
      // Validate the target before changing the branch or working tree.
      const targetCommit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: targetOid });
      const currentBranch = await git.currentBranch({ fs: this.fs, dir: this.dir, fullname: true });
      const currentRef = currentBranch || 'HEAD';

      if (hard) {
        await git.checkout({
          fs: this.fs,
          dir: this.dir,
          ref: targetOid,
          force: true,
          noUpdateHead: true,
        });
      }
      if (!hard) {
        const indexPath = `${this.dir}/.git/index`;
        let originalIndex: Uint8Array | undefined;
        try {
          originalIndex = await this.fs.promises.readFile(indexPath);
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
            throw error;
        }
        try {
          const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
          for (const [file] of status) {
            await git.resetIndex({ fs: this.fs, dir: this.dir, filepath: file, ref: targetOid });
          }
        } catch (error) {
          if (originalIndex) await this.fs.promises.writeFile(indexPath, originalIndex);
          else {
            try {
              await this.fs.promises.unlink(indexPath);
            } catch (cleanupError) {
              if (
                !(cleanupError instanceof Error) ||
                !('code' in cleanupError) ||
                cleanupError.code !== 'ENOENT'
              )
                throw cleanupError;
            }
          }
          throw error;
        }
      }
      await git.writeRef({
        fs: this.fs,
        dir: this.dir,
        ref: currentRef,
        value: targetOid,
        force: true,
      });

      await clearMergeState(this.fs, this.dir);
      return `HEAD is now at ${targetOid.slice(0, 7)} ${targetCommit.commit.message.split('\n')[0]}`;
    } catch (error) {
      throw new Error(`git reset failed: ${(error as Error).message}`);
    }
  }
}
