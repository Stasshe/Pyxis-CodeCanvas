import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { resolveCommitAuthor } from './commit';
import { GitFileSystemHelper } from './fileSystemHelper';
import { MergeConflictDetector } from './mergeConflictDetector';
import { assertNoMergeInProgress, clearMergeState, readMergeHead } from './mergeState';

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
    const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });
    return branch || null;
  }

  private async branchExists(branchName: string): Promise<boolean> {
    try {
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: branchName });
      return true;
    } catch {
      return false;
    }
  }

  private async isWorkingDirectoryClean(): Promise<boolean> {
    const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
    return status.every(
      ([, head, workdir, stage]) =>
        (head === 0 && stage === 0) || (head === workdir && stage === head)
    );
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
        return await this.mergeAbort();
      }
      await assertNoMergeInProgress(this.fs, this.dir);

      const isClean = await this.isWorkingDirectoryClean();
      if (!isClean) {
        throw new Error(
          'error: Your local changes to the following files would be overwritten by merge:\nPlease commit your changes or stash them before you merge.'
        );
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

      await this.assertNoUntrackedCollisions(targetCommit);

      if (canFF && !options.noFf) {
        await this.checkoutAndUpdateBranch(currentBranch, targetCommit, sourceCommit);

        const shortTarget = targetCommit.slice(0, 7);
        return `Updating ${sourceCommit.slice(0, 7)}..${shortTarget}\nFast-forward`;
      }

      const commitMessage = options.message || `Merge branch '${branchName}' into ${currentBranch}`;
      const author = await resolveCommitAuthor(this.fs);
      const detector = new MergeConflictDetector(this.fs, this.dir);
      const candidates = await detector.detectConflicts(currentBranch, branchName);
      const binaryConflicts = candidates.filter(conflict => conflict.binary);
      const binaryPaths = new Set(
        binaryConflicts.map(conflict => conflict.filePath.slice(this.dir.length + 1))
      );
      const symlinkPaths = new Set<string>();
      const binaryOurs = new Map<string, { oid: string; mode: number }>();
      const [baseCommit] = await git.findMergeBase({
        fs: this.fs,
        dir: this.dir,
        oids: [sourceCommit, targetCommit],
      });
      await git.walk({
        fs: this.fs,
        dir: this.dir,
        trees: [
          git.TREE({ ref: baseCommit }),
          git.TREE({ ref: sourceCommit }),
          git.TREE({ ref: targetCommit }),
        ],
        map: async (filepath, entries) => {
          const ours = entries[1];
          if (ours && binaryPaths.has(filepath)) {
            binaryOurs.set(filepath, { oid: await ours.oid(), mode: await ours.mode() });
          }
          for (const entry of entries) {
            if ((await entry?.mode()) === 0o120000) symlinkPaths.add(filepath);
          }
        },
      });
      const mergeFs: FS = {
        ...this.fs,
        promises: {
          ...this.fs.promises,
          writeFile: async (path, content) => {
            const filepath = path.slice(this.dir.length + 1);
            if (binaryPaths.has(filepath) || symlinkPaths.has(filepath)) return;
            await this.fs.promises.writeFile(path, content);
          },
        },
      };
      let conflictPaths = new Set(binaryPaths);
      let mergedOid: string | undefined;
      try {
        const result = await git.merge({
          fs: mergeFs,
          dir: this.dir,
          ours: currentBranch,
          theirs: branchName,
          author,
          committer: author,
          message: commitMessage,
          fastForward: !options.noFf,
          noUpdateBranch: true,
          abortOnConflict: false,
        });
        if (result.alreadyMerged) return 'Already up to date.';
        mergedOid = result.oid;
      } catch (mergeError) {
        const error = mergeError as Error & { code?: string; data?: { filepaths?: string[] } };
        if (error.code !== 'MergeConflictError') throw error;
        conflictPaths = new Set([...conflictPaths, ...(error.data?.filepaths || [])]);
      }

      if (conflictPaths.size === 0) {
        if (!mergedOid) throw new Error('Merge did not produce a commit.');
        await this.checkoutAndUpdateBranch(currentBranch, mergedOid, sourceCommit);
        return `Merge made by the 'ort' strategy.\nMerge commit: ${mergedOid.slice(0, 7)}`;
      }

      // A successful text merge can still contain a binary conflict. Materialize
      // its automatic tree without writing the decoded binary result.
      if (mergedOid) {
        await this.materializeAutomaticTree(sourceCommit, mergedOid, binaryPaths);
      } else {
        await this.stageAutomaticChanges(sourceCommit, targetCommit, conflictPaths);
      }
      for (const conflict of binaryConflicts) {
        const filepath = conflict.filePath.slice(this.dir.length + 1);
        if (conflict.binary?.ours === null) {
          await this.removeWorktreeFile(filepath);
          await git.remove({ fs: this.fs, dir: this.dir, filepath });
        } else {
          const ours = binaryOurs.get(filepath);
          if (!ours) throw new Error(`Cannot read our binary tree entry: ${filepath}`);
          await git.updateIndex({
            fs: this.fs,
            dir: this.dir,
            filepath,
            oid: ours.oid,
            mode: ours.mode,
            add: true,
          });
        }
      }
      const conflicts = await detector.detectConflicts(currentBranch, branchName, conflictPaths);
      await this.fs.promises.writeFile(`${this.dir}/.git/MERGE_HEAD`, `${targetCommit}\n`);
      await this.fs.promises.writeFile(`${this.dir}/.git/MERGE_MSG`, commitMessage);
      await this.fs.reportMergeConflict({
        conflicts,
        oursBranch: currentBranch,
        theirsBranch: branchName,
        root: this.dir,
      });
      return `CONFLICT: Automatic merge failed.\n${conflicts.length} conflicting file(s) detected.\nMerge conflict resolution tab has been opened.`;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('not a git repository')) {
        throw error;
      }

      throw new Error(`git merge failed: ${errorMessage}`);
    }
  }

  private async checkoutAndUpdateBranch(
    branchName: string,
    targetCommit: string,
    rollbackCommit: string
  ): Promise<void> {
    await git.checkout({ fs: this.fs, dir: this.dir, ref: targetCommit, noUpdateHead: true });
    try {
      await git.writeRef({
        fs: this.fs,
        dir: this.dir,
        ref: `refs/heads/${branchName}`,
        value: targetCommit,
        force: true,
      });
    } catch (error) {
      try {
        await git.checkout({
          fs: this.fs,
          dir: this.dir,
          ref: rollbackCommit,
          noUpdateHead: true,
          force: true,
        });
      } catch (rollbackError) {
        throw new Error(
          `Branch ref update failed: ${(error as Error).message}; worktree rollback failed: ${(rollbackError as Error).message}`
        );
      }
      throw error;
    }
  }

  private async assertNoUntrackedCollisions(theirs: string): Promise<void> {
    const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
    const untracked = status
      .filter(([, head, , stage]) => head === 0 && stage === 0)
      .map(([path]) => path);
    if (!untracked.length) return;
    await git.walk({
      fs: this.fs,
      dir: this.dir,
      trees: [git.TREE({ ref: theirs })],
      map: async (filepath, [entry]) => {
        if (!entry || (await entry.type()) === 'tree') return;
        const collision = untracked.find(
          path =>
            path === filepath || path.startsWith(`${filepath}/`) || filepath.startsWith(`${path}/`)
        );
        if (collision)
          throw new Error(`Untracked file would be overwritten by merge: ${collision}`);
      },
    });
  }

  private async removeWorktreeFile(filepath: string): Promise<void> {
    try {
      await this.fs.promises.unlink(`${this.dir}/${filepath}`);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }

  private async materializeAutomaticTree(
    ours: string,
    merged: string,
    conflicts: ReadonlySet<string>
  ): Promise<void> {
    await git.walk({
      fs: this.fs,
      dir: this.dir,
      trees: [git.TREE({ ref: ours }), git.TREE({ ref: merged })],
      map: async (filepath, [before, after]) => {
        if (filepath === '.' || conflicts.has(filepath)) return;
        if ((await before?.type()) === 'tree' || (await after?.type()) === 'tree') return;
        if (!after) {
          await this.removeWorktreeFile(filepath);
          await git.remove({ fs: this.fs, dir: this.dir, filepath });
          return;
        }
        const content = await after.content();
        if (!content) throw new Error(`Cannot read blob: ${filepath}`);
        const mode = await after.mode();
        const parent = `${this.dir}/${filepath}`.slice(
          0,
          `${this.dir}/${filepath}`.lastIndexOf('/')
        );
        await GitFileSystemHelper.ensureDirectory(this.fs, parent);
        if (mode === 0o120000) {
          await this.removeWorktreeFile(filepath);
          await this.fs.promises.symlink(
            new TextDecoder().decode(content),
            `${this.dir}/${filepath}`
          );
        } else {
          if ((await before?.mode()) === 0o120000) await this.removeWorktreeFile(filepath);
          await this.fs.promises.writeFile(`${this.dir}/${filepath}`, content);
        }
        await git.updateIndex({
          fs: this.fs,
          dir: this.dir,
          filepath,
          oid: await after.oid(),
          mode,
          add: true,
        });
      },
    });
  }

  private async stageAutomaticChanges(
    ours: string,
    theirs: string,
    conflicts: ReadonlySet<string>
  ): Promise<void> {
    const [base] = await git.findMergeBase({ fs: this.fs, dir: this.dir, oids: [ours, theirs] });
    await git.walk({
      fs: this.fs,
      dir: this.dir,
      trees: [git.TREE({ ref: base }), git.TREE({ ref: ours }), git.TREE({ ref: theirs })],
      map: async (filepath, [before, current, incoming]) => {
        if (filepath === '.' || conflicts.has(filepath)) return;
        if (
          (await before?.type()) === 'tree' ||
          (await current?.type()) === 'tree' ||
          (await incoming?.type()) === 'tree'
        )
          return;
        const oursChanged =
          (await before?.oid()) !== (await current?.oid()) ||
          (await before?.mode()) !== (await current?.mode());
        const theirsChanged =
          (await before?.oid()) !== (await incoming?.oid()) ||
          (await before?.mode()) !== (await incoming?.mode());
        if (oursChanged || !theirsChanged) return;
        if (!incoming) {
          await this.removeWorktreeFile(filepath);
          await git.remove({ fs: this.fs, dir: this.dir, filepath });
        } else {
          const mode = await incoming.mode();
          const content = await incoming.content();
          if (!content) throw new Error(`Cannot read blob: ${filepath}`);
          const path = `${this.dir}/${filepath}`;
          await GitFileSystemHelper.ensureDirectory(this.fs, path.slice(0, path.lastIndexOf('/')));
          if (mode === 0o120000 || (await current?.mode()) === 0o120000)
            await this.removeWorktreeFile(filepath);
          if (mode === 0o120000) {
            await this.fs.promises.symlink(new TextDecoder().decode(content), path);
          } else {
            await this.fs.promises.writeFile(path, content);
          }
          await git.updateIndex({
            fs: this.fs,
            dir: this.dir,
            filepath,
            oid: await incoming.oid(),
            mode,
            add: true,
          });
        }
      },
    });
  }

  async mergeAbort(): Promise<string> {
    try {
      await this.ensureGitRepository();

      if (!(await readMergeHead(this.fs, this.dir))) {
        return 'fatal: There is no merge to abort (MERGE_HEAD missing).';
      }

      try {
        const currentBranch = await this.getCurrentBranch();
        if (!currentBranch) throw new Error('Cannot abort merge without a current branch.');
        await git.checkout({ fs: this.fs, dir: this.dir, ref: currentBranch, force: true });
        await clearMergeState(this.fs, this.dir);

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
