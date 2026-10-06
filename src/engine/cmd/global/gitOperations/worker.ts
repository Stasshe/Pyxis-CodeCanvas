import git from 'isomorphic-git';
import type { FsCore } from '@/engine/core/fs/core';
import {
  createGitFs,
  type GitConflictReporter,
  type GitCredentialProvider,
  type GitFs,
  repositoryPath,
} from '@/engine/core/fs/git';
import { normalizePath } from '@/engine/core/pathUtils';
import { GitCheckoutOperations } from './checkout';
import { GitCloneOperations } from './clone';
import { GitDiffOperations } from './diff';
import type { FetchOptions } from './fetch';
import { type BranchFilterOptions, GitLogOperations } from './log';
import { GitMergeOperations } from './merge';
import { toFullRemoteRef } from './remoteUtils';
import { GitResetOperations } from './reset';
import { GitRevertOperations } from './revert';
import { formatStatusResult } from './status';
import { tree } from './tree';

export class WorkerGitCommands {
  private fs: GitFs;
  private dir: string;

  constructor(core: FsCore, root: string) {
    this.fs = createGitFs(core);
    this.dir = normalizePath(root);
  }

  configureCredentials(provider: GitCredentialProvider): void {
    this.fs.setCredentials(provider);
  }

  configureConflictReporter(reporter: GitConflictReporter): void {
    this.fs.setConflictReporter(reporter);
  }

  async tree(): Promise<string> {
    return tree(this.fs, this.dir);
  }

  private async ensureProjectDirectory(): Promise<void> {
    await this.fs.promises.mkdir(this.dir, { recursive: true });
  }

  private async ensureGitRepository(): Promise<void> {
    await this.ensureProjectDirectory();
    try {
      await this.fs.promises.stat(`${this.dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }
  }

  private async executeGitOperation<T>(
    operation: () => Promise<T>,
    errorPrefix: string
  ): Promise<T> {
    try {
      return await this.executeGitMutation(operation);
    } catch (error) {
      throw new Error(`${errorPrefix}: ${(error as Error).message}`);
    }
  }

  private async executeGitMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = await operation();
    return result;
  }

  async getCurrentBranch(): Promise<string> {
    try {
      await this.ensureGitRepository();
      const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });

      if (!branch) {
        try {
          const commits = await git.log({ fs: this.fs, dir: this.dir, depth: 1 });
          if (commits.length > 0) {
            return `(HEAD detached at ${commits[0].oid.slice(0, 7)})`;
          }
        } catch {}
        return 'main';
      }

      return branch;
    } catch {
      return '(no git)';
    }
  }

  async init(): Promise<string> {
    return this.executeGitOperation(async () => {
      await this.ensureProjectDirectory();
      await git.init({ fs: this.fs, dir: this.dir, defaultBranch: 'main' });
      return `Initialized empty Git repository in ${this.dir}`;
    }, 'git init failed');
  }

  async clone(
    url: string,
    targetDir?: string,
    options: { skipDotGit?: boolean; maxGitObjects?: number } = {}
  ): Promise<string> {
    return this.executeGitOperation(async () => {
      const cloneOps = new GitCloneOperations({
        fs: this.fs,
        dir: this.dir,
      });
      return await cloneOps.clone(url, targetDir, options);
    }, 'git clone failed');
  }

  async status(): Promise<string> {
    await this.ensureGitRepository();

    const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
    const currentBranch = await this.getCurrentBranch();
    return await formatStatusResult(status, currentBranch);
  }

  async add(filepath: string): Promise<string> {
    await this.ensureProjectDirectory();
    const { add } = await import('./add');
    return this.executeGitMutation(() => add(this.fs, this.dir, filepath));
  }

  async commit(
    message: string,
    author = { name: 'User', email: 'user@pyxis.dev' }
  ): Promise<string> {
    await this.ensureGitRepository();
    const { commit } = await import('./commit');
    return this.executeGitMutation(() => commit(this.fs, this.dir, message, author));
  }

  async reset(
    options: { filepath?: string; hard?: boolean; commit?: string } = {}
  ): Promise<string> {
    const resetOperations = new GitResetOperations(this.fs, this.dir);
    return this.executeGitMutation(() => resetOperations.reset(options));
  }

  async log(depth = 10): Promise<string> {
    const logOperations = new GitLogOperations(this.fs, this.dir);
    return await logOperations.log(depth);
  }

  async getFormattedLog(
    depth = 20,
    branchFilter: BranchFilterOptions = { mode: 'auto' }
  ): Promise<string> {
    const logOperations = new GitLogOperations(this.fs, this.dir);
    return await logOperations.getFormattedLog(depth, branchFilter);
  }

  async getAvailableBranches(): Promise<{ local: string[]; remote: string[] }> {
    const logOperations = new GitLogOperations(this.fs, this.dir);
    return await logOperations.getAvailableBranches();
  }

  async checkout(branchName: string, createNew = false): Promise<string> {
    const checkoutOperations = new GitCheckoutOperations(this.fs, this.dir);
    return this.executeGitMutation(() => checkoutOperations.checkout(branchName, createNew));
  }

  async checkoutRemote(remoteBranch: string): Promise<string> {
    await this.ensureGitRepository();

    try {
      const remoteRef = toFullRemoteRef(remoteBranch);
      let commitOid: string;

      try {
        commitOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: remoteRef });
      } catch {
        throw new Error(`Remote branch '${remoteBranch}' not found. Did you run 'git fetch'?`);
      }

      const checkoutOperations = new GitCheckoutOperations(this.fs, this.dir);

      return await this.executeGitMutation(() => checkoutOperations.checkout(commitOid, false));
    } catch (error) {
      throw new Error(`Failed to checkout remote branch: ${(error as Error).message}`);
    }
  }

  async revert(commitHash: string): Promise<string> {
    const revertOperations = new GitRevertOperations(this.fs, this.dir);
    return this.executeGitMutation(() => revertOperations.revert(commitHash));
  }

  async switch(
    targetRef: string,
    options: {
      createNew?: boolean;
      detach?: boolean;
    } = {}
  ): Promise<string> {
    const { GitSwitchOperations } = await import('./switch');
    const switchOps = new GitSwitchOperations(this.fs, this.dir);
    return this.executeGitMutation(() => switchOps.switch(targetRef, options));
  }

  async branch(
    branchName?: string,
    options: { delete?: boolean; remote?: boolean; all?: boolean } = {}
  ): Promise<string> {
    await this.ensureProjectDirectory();
    const { branch } = await import('./branch');
    if (!branchName) {
      return await branch(this.fs, this.dir, branchName, options);
    }
    return this.executeGitMutation(() => branch(this.fs, this.dir, branchName, options));
  }

  async diff(
    options: {
      staged?: boolean;
      filepath?: string;
      commit1?: string;
      commit2?: string;
      branchName?: string;
    } = {}
  ): Promise<string> {
    const diffOperations = new GitDiffOperations(this.fs, this.dir);
    return await diffOperations.diff(options);
  }

  async diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string> {
    const diffOperations = new GitDiffOperations(this.fs, this.dir);
    return await diffOperations.diffCommits(commit1, commit2, filepath);
  }

  async merge(
    branchName: string,
    options: { noFf?: boolean; message?: string; abort?: boolean } = {}
  ): Promise<string> {
    const mergeOperations = new GitMergeOperations(this.fs, this.dir);

    return this.executeGitMutation(() =>
      mergeOperations.merge(branchName, {
        noFf: options.noFf,
        message: options.message,
        abort: options.abort,
      })
    );
  }

  async discardChanges(filepath: string): Promise<string> {
    await this.ensureGitRepository();
    const { discardChanges } = await import('./discardChanges');
    return this.executeGitMutation(() => discardChanges(this.fs, this.dir, filepath));
  }

  async getFileContentAtCommit(commitId: string, filePath: string): Promise<string> {
    await this.ensureGitRepository();
    try {
      const { blob } = await git.readBlob({
        fs: this.fs,
        dir: this.dir,
        oid: commitId,
        filepath: repositoryPath(this.dir, filePath),
      });
      return new TextDecoder().decode(blob);
    } catch (e) {
      throw new Error(`Failed to read file at commit ${commitId}: ${(e as Error).message}`);
    }
  }

  async getParentCommitIds(commitId: string): Promise<string[]> {
    await this.ensureGitRepository();
    try {
      const fullOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commitId });
      const commit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: fullOid });
      return commit.commit.parent || [];
    } catch (e) {
      console.warn(`Failed to get parent commits for ${commitId}:`, e);
      return [];
    }
  }

  async getStagedFileContent(filePath: string): Promise<string | null> {
    await this.ensureGitRepository();

    let stagedContent: string | null = null;

    try {
      await git.walk({
        fs: this.fs,
        dir: this.dir,
        trees: [git.STAGE()],
        map: async (filepath, [entry]) => {
          if (filepath === repositoryPath(this.dir, filePath) && entry) {
            const oid = await entry.oid();
            if (oid) {
              const { blob } = await git.readBlob({
                fs: this.fs,
                dir: this.dir,
                oid,
              });
              stagedContent = new TextDecoder().decode(blob);
            }
          }
          return undefined;
        },
      });
    } catch (e) {
      console.warn(`Failed to get staged content for ${filePath}:`, e);
      return null;
    }

    return stagedContent;
  }

  async getHeadFileContent(filePath: string): Promise<string | null> {
    await this.ensureGitRepository();

    try {
      const headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      const { blob } = await git.readBlob({
        fs: this.fs,
        dir: this.dir,
        oid: headCommitHash,
        filepath: repositoryPath(this.dir, filePath),
      });
      return new TextDecoder().decode(blob);
    } catch (e) {
      console.warn('[git.ts] caught non-fatal error', e);
      return null;
    }
  }

  async push(
    options: { remote?: string; branch?: string; force?: boolean } = {},
    progress?: (message: string) => void
  ): Promise<string> {
    await this.ensureGitRepository();

    const { push } = await import('./push');
    return this.executeGitMutation(() => push(this.fs, this.dir, options, progress));
  }

  async addRemote(remote: string, url: string): Promise<string> {
    await this.ensureGitRepository();

    const { addRemote } = await import('./push');
    return this.executeGitMutation(() => addRemote(this.fs, this.dir, remote, url));
  }

  async listRemotes(): Promise<string> {
    await this.ensureGitRepository();

    const { listRemotes } = await import('./push');
    return listRemotes(this.fs, this.dir);
  }

  async deleteRemote(remote: string): Promise<string> {
    await this.ensureGitRepository();

    const { deleteRemote } = await import('./push');
    return this.executeGitMutation(() => deleteRemote(this.fs, this.dir, remote));
  }

  async fetch(options: FetchOptions | string[] = {}): Promise<string> {
    await this.ensureGitRepository();

    if (Array.isArray(options)) {
      const { fetchFromArgs } = await import('./fetch');
      return this.executeGitMutation(() => fetchFromArgs(this.fs, this.dir, options));
    }

    const { fetch } = await import('./fetch');
    return this.executeGitMutation(() => fetch(this.fs, this.dir, options));
  }

  async fetchAll(
    options: { depth?: number; prune?: boolean; tags?: boolean } = {}
  ): Promise<string> {
    await this.ensureGitRepository();

    const { fetchAll } = await import('./fetch');
    return this.executeGitMutation(() => fetchAll(this.fs, this.dir, options));
  }

  async listRemoteBranches(remote = 'origin'): Promise<string[]> {
    await this.ensureGitRepository();

    const { listRemoteBranches } = await import('./fetch');
    return listRemoteBranches(this.fs, this.dir, remote);
  }

  async listRemoteTags(): Promise<string[]> {
    await this.ensureGitRepository();

    const { listRemoteTags } = await import('./fetch');
    return listRemoteTags(this.fs, this.dir);
  }

  async pull(
    options: { remote?: string; branch?: string; rebase?: boolean } = {}
  ): Promise<string> {
    await this.ensureGitRepository();
    const { pull } = await import('./pull');
    return this.executeGitMutation(() => pull(this.fs, this.dir, options));
  }

  async show(args: string[]): Promise<string> {
    await this.ensureGitRepository();

    const { show } = await import('./show');
    return show(this.fs, this.dir, args);
  }
}
