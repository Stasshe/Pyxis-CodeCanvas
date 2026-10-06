import * as Comlink from 'comlink';
import type { TerminalUI } from '@/engine/cmd/terminalUI';
import { fsClient } from '@/engine/core/fs/client';
import type { GitCredentials, GitMergeConflict } from '@/engine/core/fs/git';
import { authRepository } from '@/engine/user/authRepository';
import { tabActions } from '@/stores/tabState';
import type { WorkerGitCommands } from './gitOperations/worker';

/** Main-thread bridge to Git operations owned by the filesystem worker. */
export class GitCommands {
  private remote: Promise<Comlink.Remote<WorkerGitCommands>> | null = null;
  private terminalUI?: TerminalUI;

  constructor(private root: string) {}

  setTerminalUI(ui: TerminalUI): void {
    this.terminalUI = ui;
  }

  private getRemote(): Promise<Comlink.Remote<WorkerGitCommands>> {
    if (!this.remote) this.remote = this.connect();
    return this.remote;
  }

  private async connect(): Promise<Comlink.Remote<WorkerGitCommands>> {
    const remote = await fsClient.getGit(this.root);
    await remote.configureCredentials(
      Comlink.proxy(async (): Promise<GitCredentials | null> => {
        const auth = await authRepository.getAuth();
        if (!auth) return null;
        return { username: 'x-access-token', password: auth.accessToken };
      })
    );
    await remote.configureConflictReporter(
      Comlink.proxy(async (conflict: GitMergeConflict): Promise<void> => {
        await tabActions.openTab(
          {
            conflicts: conflict.conflicts,
            oursBranch: conflict.oursBranch,
            theirsBranch: conflict.theirsBranch,
            rootPath: conflict.root,
          },
          { kind: 'merge-conflict' }
        );
      })
    );
    return remote;
  }

  async getCurrentBranch(
    ...args: Parameters<WorkerGitCommands['getCurrentBranch']>
  ): ReturnType<WorkerGitCommands['getCurrentBranch']> {
    return (await this.getRemote()).getCurrentBranch(...args);
  }

  async tree(): Promise<string> {
    return (await this.getRemote()).tree();
  }

  async init(
    ...args: Parameters<WorkerGitCommands['init']>
  ): ReturnType<WorkerGitCommands['init']> {
    return (await this.getRemote()).init(...args);
  }

  async clone(
    ...args: Parameters<WorkerGitCommands['clone']>
  ): ReturnType<WorkerGitCommands['clone']> {
    return (await this.getRemote()).clone(...args);
  }

  async status(
    ...args: Parameters<WorkerGitCommands['status']>
  ): ReturnType<WorkerGitCommands['status']> {
    return (await this.getRemote()).status(...args);
  }

  async add(...args: Parameters<WorkerGitCommands['add']>): ReturnType<WorkerGitCommands['add']> {
    return (await this.getRemote()).add(...args);
  }

  async commit(
    ...args: Parameters<WorkerGitCommands['commit']>
  ): ReturnType<WorkerGitCommands['commit']> {
    return (await this.getRemote()).commit(...args);
  }

  async reset(
    ...args: Parameters<WorkerGitCommands['reset']>
  ): ReturnType<WorkerGitCommands['reset']> {
    return (await this.getRemote()).reset(...args);
  }

  async log(...args: Parameters<WorkerGitCommands['log']>): ReturnType<WorkerGitCommands['log']> {
    return (await this.getRemote()).log(...args);
  }

  async getFormattedLog(
    ...args: Parameters<WorkerGitCommands['getFormattedLog']>
  ): ReturnType<WorkerGitCommands['getFormattedLog']> {
    return (await this.getRemote()).getFormattedLog(...args);
  }

  async getAvailableBranches(
    ...args: Parameters<WorkerGitCommands['getAvailableBranches']>
  ): ReturnType<WorkerGitCommands['getAvailableBranches']> {
    return (await this.getRemote()).getAvailableBranches(...args);
  }

  async checkout(
    ...args: Parameters<WorkerGitCommands['checkout']>
  ): ReturnType<WorkerGitCommands['checkout']> {
    return (await this.getRemote()).checkout(...args);
  }

  async checkoutRemote(
    ...args: Parameters<WorkerGitCommands['checkoutRemote']>
  ): ReturnType<WorkerGitCommands['checkoutRemote']> {
    return (await this.getRemote()).checkoutRemote(...args);
  }

  async revert(
    ...args: Parameters<WorkerGitCommands['revert']>
  ): ReturnType<WorkerGitCommands['revert']> {
    return (await this.getRemote()).revert(...args);
  }

  async switch(
    ...args: Parameters<WorkerGitCommands['switch']>
  ): ReturnType<WorkerGitCommands['switch']> {
    return (await this.getRemote()).switch(...args);
  }

  async branch(
    ...args: Parameters<WorkerGitCommands['branch']>
  ): ReturnType<WorkerGitCommands['branch']> {
    return (await this.getRemote()).branch(...args);
  }

  async diff(
    ...args: Parameters<WorkerGitCommands['diff']>
  ): ReturnType<WorkerGitCommands['diff']> {
    return (await this.getRemote()).diff(...args);
  }

  async diffCommits(
    ...args: Parameters<WorkerGitCommands['diffCommits']>
  ): ReturnType<WorkerGitCommands['diffCommits']> {
    return (await this.getRemote()).diffCommits(...args);
  }

  async merge(
    ...args: Parameters<WorkerGitCommands['merge']>
  ): ReturnType<WorkerGitCommands['merge']> {
    return (await this.getRemote()).merge(...args);
  }

  async discardChanges(
    ...args: Parameters<WorkerGitCommands['discardChanges']>
  ): ReturnType<WorkerGitCommands['discardChanges']> {
    return (await this.getRemote()).discardChanges(...args);
  }

  async getFileContentAtCommit(
    ...args: Parameters<WorkerGitCommands['getFileContentAtCommit']>
  ): ReturnType<WorkerGitCommands['getFileContentAtCommit']> {
    return (await this.getRemote()).getFileContentAtCommit(...args);
  }

  async getParentCommitIds(
    ...args: Parameters<WorkerGitCommands['getParentCommitIds']>
  ): ReturnType<WorkerGitCommands['getParentCommitIds']> {
    return (await this.getRemote()).getParentCommitIds(...args);
  }

  async getStagedFileContent(
    ...args: Parameters<WorkerGitCommands['getStagedFileContent']>
  ): ReturnType<WorkerGitCommands['getStagedFileContent']> {
    return (await this.getRemote()).getStagedFileContent(...args);
  }

  async getHeadFileContent(
    ...args: Parameters<WorkerGitCommands['getHeadFileContent']>
  ): ReturnType<WorkerGitCommands['getHeadFileContent']> {
    return (await this.getRemote()).getHeadFileContent(...args);
  }

  async push(options: Parameters<WorkerGitCommands['push']>[0] = {}): Promise<string> {
    const remote = await this.getRemote();
    const progress = Comlink.proxy((message: string): void => {
      void this.terminalUI?.println(message);
    });
    return remote.push(options, progress);
  }

  async addRemote(
    ...args: Parameters<WorkerGitCommands['addRemote']>
  ): ReturnType<WorkerGitCommands['addRemote']> {
    return (await this.getRemote()).addRemote(...args);
  }

  async listRemotes(
    ...args: Parameters<WorkerGitCommands['listRemotes']>
  ): ReturnType<WorkerGitCommands['listRemotes']> {
    return (await this.getRemote()).listRemotes(...args);
  }

  async deleteRemote(
    ...args: Parameters<WorkerGitCommands['deleteRemote']>
  ): ReturnType<WorkerGitCommands['deleteRemote']> {
    return (await this.getRemote()).deleteRemote(...args);
  }

  async fetch(
    ...args: Parameters<WorkerGitCommands['fetch']>
  ): ReturnType<WorkerGitCommands['fetch']> {
    return (await this.getRemote()).fetch(...args);
  }

  async fetchAll(
    ...args: Parameters<WorkerGitCommands['fetchAll']>
  ): ReturnType<WorkerGitCommands['fetchAll']> {
    return (await this.getRemote()).fetchAll(...args);
  }

  async listRemoteBranches(
    ...args: Parameters<WorkerGitCommands['listRemoteBranches']>
  ): ReturnType<WorkerGitCommands['listRemoteBranches']> {
    return (await this.getRemote()).listRemoteBranches(...args);
  }

  async listRemoteTags(
    ...args: Parameters<WorkerGitCommands['listRemoteTags']>
  ): ReturnType<WorkerGitCommands['listRemoteTags']> {
    return (await this.getRemote()).listRemoteTags(...args);
  }

  async pull(
    ...args: Parameters<WorkerGitCommands['pull']>
  ): ReturnType<WorkerGitCommands['pull']> {
    return (await this.getRemote()).pull(...args);
  }

  async show(
    ...args: Parameters<WorkerGitCommands['show']>
  ): ReturnType<WorkerGitCommands['show']> {
    return (await this.getRemote()).show(...args);
  }
}
