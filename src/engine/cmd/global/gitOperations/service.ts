import type { FsCore } from '@/engine/core/fs/core';
import { WorkerGitCommands } from './worker';

type Scheduler = <T>(operation: () => Promise<T>) => Promise<T>;

/** Serialize whole Git operations with all filesystem worker clients. */
export class QueuedGitCommands {
  private readonly commands: WorkerGitCommands;

  constructor(
    core: FsCore,
    root: string,
    private schedule: Scheduler
  ) {
    this.commands = new WorkerGitCommands(core, root);
  }

  configureCredentials(
    ...args: Parameters<WorkerGitCommands['configureCredentials']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['configureCredentials']>>> {
    return this.schedule(async () => this.commands.configureCredentials(...args));
  }

  configureConflictReporter(
    ...args: Parameters<WorkerGitCommands['configureConflictReporter']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['configureConflictReporter']>>> {
    return this.schedule(async () => this.commands.configureConflictReporter(...args));
  }

  getCurrentBranch(
    ...args: Parameters<WorkerGitCommands['getCurrentBranch']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['getCurrentBranch']>>> {
    return this.schedule(async () => this.commands.getCurrentBranch(...args));
  }

  tree(
    ...args: Parameters<WorkerGitCommands['tree']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['tree']>>> {
    return this.schedule(async () => this.commands.tree(...args));
  }

  init(
    ...args: Parameters<WorkerGitCommands['init']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['init']>>> {
    return this.schedule(async () => this.commands.init(...args));
  }

  clone(
    ...args: Parameters<WorkerGitCommands['clone']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['clone']>>> {
    return this.schedule(async () => this.commands.clone(...args));
  }

  status(
    ...args: Parameters<WorkerGitCommands['status']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['status']>>> {
    return this.schedule(async () => this.commands.status(...args));
  }

  add(
    ...args: Parameters<WorkerGitCommands['add']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['add']>>> {
    return this.schedule(async () => this.commands.add(...args));
  }

  commit(
    ...args: Parameters<WorkerGitCommands['commit']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['commit']>>> {
    return this.schedule(async () => this.commands.commit(...args));
  }

  reset(
    ...args: Parameters<WorkerGitCommands['reset']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['reset']>>> {
    return this.schedule(async () => this.commands.reset(...args));
  }

  log(
    ...args: Parameters<WorkerGitCommands['log']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['log']>>> {
    return this.schedule(async () => this.commands.log(...args));
  }

  getFormattedLog(
    ...args: Parameters<WorkerGitCommands['getFormattedLog']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['getFormattedLog']>>> {
    return this.schedule(async () => this.commands.getFormattedLog(...args));
  }

  getAvailableBranches(
    ...args: Parameters<WorkerGitCommands['getAvailableBranches']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['getAvailableBranches']>>> {
    return this.schedule(async () => this.commands.getAvailableBranches(...args));
  }

  checkout(
    ...args: Parameters<WorkerGitCommands['checkout']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['checkout']>>> {
    return this.schedule(async () => this.commands.checkout(...args));
  }

  checkoutRemote(
    ...args: Parameters<WorkerGitCommands['checkoutRemote']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['checkoutRemote']>>> {
    return this.schedule(async () => this.commands.checkoutRemote(...args));
  }

  revert(
    ...args: Parameters<WorkerGitCommands['revert']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['revert']>>> {
    return this.schedule(async () => this.commands.revert(...args));
  }

  switch(
    ...args: Parameters<WorkerGitCommands['switch']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['switch']>>> {
    return this.schedule(async () => this.commands.switch(...args));
  }

  branch(
    ...args: Parameters<WorkerGitCommands['branch']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['branch']>>> {
    return this.schedule(async () => this.commands.branch(...args));
  }

  diff(
    ...args: Parameters<WorkerGitCommands['diff']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['diff']>>> {
    return this.schedule(async () => this.commands.diff(...args));
  }

  diffCommits(
    ...args: Parameters<WorkerGitCommands['diffCommits']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['diffCommits']>>> {
    return this.schedule(async () => this.commands.diffCommits(...args));
  }

  merge(
    ...args: Parameters<WorkerGitCommands['merge']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['merge']>>> {
    return this.schedule(async () => this.commands.merge(...args));
  }

  discardChanges(
    ...args: Parameters<WorkerGitCommands['discardChanges']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['discardChanges']>>> {
    return this.schedule(async () => this.commands.discardChanges(...args));
  }

  getFileContentAtCommit(
    ...args: Parameters<WorkerGitCommands['getFileContentAtCommit']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['getFileContentAtCommit']>>> {
    return this.schedule(async () => this.commands.getFileContentAtCommit(...args));
  }

  getParentCommitIds(
    ...args: Parameters<WorkerGitCommands['getParentCommitIds']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['getParentCommitIds']>>> {
    return this.schedule(async () => this.commands.getParentCommitIds(...args));
  }

  getStagedFileContent(
    ...args: Parameters<WorkerGitCommands['getStagedFileContent']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['getStagedFileContent']>>> {
    return this.schedule(async () => this.commands.getStagedFileContent(...args));
  }

  getHeadFileContent(
    ...args: Parameters<WorkerGitCommands['getHeadFileContent']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['getHeadFileContent']>>> {
    return this.schedule(async () => this.commands.getHeadFileContent(...args));
  }

  push(
    ...args: Parameters<WorkerGitCommands['push']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['push']>>> {
    return this.schedule(async () => this.commands.push(...args));
  }

  addRemote(
    ...args: Parameters<WorkerGitCommands['addRemote']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['addRemote']>>> {
    return this.schedule(async () => this.commands.addRemote(...args));
  }

  listRemotes(
    ...args: Parameters<WorkerGitCommands['listRemotes']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['listRemotes']>>> {
    return this.schedule(async () => this.commands.listRemotes(...args));
  }

  deleteRemote(
    ...args: Parameters<WorkerGitCommands['deleteRemote']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['deleteRemote']>>> {
    return this.schedule(async () => this.commands.deleteRemote(...args));
  }

  fetch(
    ...args: Parameters<WorkerGitCommands['fetch']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['fetch']>>> {
    return this.schedule(async () => this.commands.fetch(...args));
  }

  fetchAll(
    ...args: Parameters<WorkerGitCommands['fetchAll']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['fetchAll']>>> {
    return this.schedule(async () => this.commands.fetchAll(...args));
  }

  listRemoteBranches(
    ...args: Parameters<WorkerGitCommands['listRemoteBranches']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['listRemoteBranches']>>> {
    return this.schedule(async () => this.commands.listRemoteBranches(...args));
  }

  listRemoteTags(
    ...args: Parameters<WorkerGitCommands['listRemoteTags']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['listRemoteTags']>>> {
    return this.schedule(async () => this.commands.listRemoteTags(...args));
  }

  pull(
    ...args: Parameters<WorkerGitCommands['pull']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['pull']>>> {
    return this.schedule(async () => this.commands.pull(...args));
  }

  show(
    ...args: Parameters<WorkerGitCommands['show']>
  ): Promise<Awaited<ReturnType<WorkerGitCommands['show']>>> {
    return this.schedule(async () => this.commands.show(...args));
  }
}
