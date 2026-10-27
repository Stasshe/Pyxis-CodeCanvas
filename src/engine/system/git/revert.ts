import git from 'isomorphic-git';
import { detectFileContent } from '@/engine/core/fileBytes';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { resolveCommitAuthor } from './commit';
import { assertNoMergeInProgress } from './mergeState';

export class GitRevertOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  async revert(commitHash: string): Promise<string> {
    try {
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      await assertNoMergeInProgress(this.fs, this.dir);

      let fullCommitHash: string;
      try {
        const expandedOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commitHash });
        fullCommitHash = expandedOid;
      } catch {
        throw new Error(`bad revision '${commitHash}'`);
      }

      const commitToRevert = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: fullCommitHash,
      });

      if (commitToRevert.commit.parent.length === 0) {
        throw new Error(`cannot revert initial commit ${commitHash.slice(0, 7)}`);
      }

      if (commitToRevert.commit.parent.length > 1) {
        throw new Error(`commit ${commitHash.slice(0, 7)} is a merge commit`);
      }

      const parentHash = commitToRevert.commit.parent[0];

      const parentCommit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: parentHash });

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const hasChanges = status.some(row => {
        const [, headStatus, workdirStatus, stageStatus] = row;
        return headStatus !== workdirStatus || headStatus !== stageStatus;
      });

      if (hasChanges) {
        throw new Error(
          'error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.'
        );
      }

      const head = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      const conflictingPaths: string[] = [];
      await git.walk({
        fs: this.fs,
        dir: this.dir,
        trees: [
          git.TREE({ ref: fullCommitHash }),
          git.TREE({ ref: head }),
          git.TREE({ ref: parentHash }),
        ],
        map: async (filepath, entries) => {
          if (filepath === '.') return;
          const [base, ours, theirs] = entries;
          if (!base || !ours || !theirs) return;
          const versions = [base, ours, theirs];
          if (
            (await base.type()) !== 'blob' ||
            (await ours.type()) !== 'blob' ||
            (await theirs.type()) !== 'blob'
          )
            return;
          const [baseOid, oursOid, theirsOid] = await Promise.all(
            versions.map(entry => entry.oid())
          );
          const [baseMode, oursMode, theirsMode] = await Promise.all(
            versions.map(entry => entry.mode())
          );
          const oursChanged = baseOid !== oursOid || baseMode !== oursMode;
          const theirsChanged = baseOid !== theirsOid || baseMode !== theirsMode;
          if (!oursChanged || !theirsChanged || (oursOid === theirsOid && oursMode === theirsMode))
            return;
          const contents = await Promise.all(
            versions.map(async entry => {
              const bytes = await entry.content();
              if (!bytes) throw new Error(`Cannot read blob: ${filepath}`);
              return detectFileContent(filepath, bytes);
            })
          );
          if (contents.some(content => content.kind === 'binary')) {
            conflictingPaths.push(filepath);
          } else if (
            (await base.mode()) === 0o120000 ||
            (await ours.mode()) === 0o120000 ||
            (await theirs.mode()) === 0o120000
          ) {
            conflictingPaths.push(filepath);
          }
        },
      });
      if (conflictingPaths.length)
        throw new Error(`Revert conflicts in: ${conflictingPaths.join(', ')}`);

      const revertMessage = `Revert "${commitToRevert.commit.message.split('\n')[0]}"\n\nThis reverts commit ${fullCommitHash}.`;
      const author = await resolveCommitAuthor(this.fs);
      const signature = {
        ...author,
        timestamp: Math.floor(Date.now() / 1000),
        timezoneOffset: new Date().getTimezoneOffset(),
      };
      const inverse = await git.writeCommit({
        fs: this.fs,
        dir: this.dir,
        commit: {
          tree: parentCommit.commit.tree,
          parent: [fullCommitHash],
          message: revertMessage,
          author: signature,
          committer: signature,
        },
      });
      const commitOid = await git.cherryPick({
        fs: this.fs,
        dir: this.dir,
        oid: inverse,
        abortOnConflict: true,
        noUpdateBranch: true,
        committer: author,
      });
      await git.checkout({ fs: this.fs, dir: this.dir, ref: commitOid, noUpdateHead: true });
      const branch = await git.currentBranch({ fs: this.fs, dir: this.dir, fullname: true });
      await git.writeRef({
        fs: this.fs,
        dir: this.dir,
        ref: branch || 'HEAD',
        value: commitOid,
        force: true,
      });

      return `[${commitOid.slice(0, 7)}] ${revertMessage.split('\n')[0]}`;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('bad revision')) {
        throw new Error(errorMessage);
      }
      if (errorMessage.includes('cannot revert initial commit')) {
        throw new Error(`error: ${errorMessage}`);
      }
      if (errorMessage.includes('is a merge commit')) {
        throw new Error(`error: ${errorMessage}`);
      }
      if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      }
      if (errorMessage.includes('your local changes would be overwritten')) {
        throw new Error(errorMessage);
      }

      throw new Error(`git revert failed: ${errorMessage}`);
    }
  }
}
