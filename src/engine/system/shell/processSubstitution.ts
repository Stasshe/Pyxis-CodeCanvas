import { type FsApi, getFifoApi } from '@/engine/core/fs/index';
import type { ShellExecutor, ShellRunResult } from './executor';
import type { ShellJobIdentity } from './jobs';
import type { Process } from './process';
import { Process as ShellProcess } from './process';
import type { OutputCallbacks } from './types';
import type { ExpansionResources } from './wordExpansion';

type ProcessSubstitutionChild = Pick<
  ShellExecutor,
  'run' | 'dispose' | 'killForeground' | 'registerFifoOwner' | 'releaseFifoOwner'
>;

type ProcessSubstitutionOptions = {
  fsClient: FsApi;
  fork: () => Promise<ProcessSubstitutionChild>;
  registerParentFifoOwner: (path: string, ownerId: string) => void;
  releaseParentFifoOwner: (path: string) => void;
  trackChild: (child: ProcessSubstitutionChild, tracked: boolean) => void;
  addJob: (
    completion: Promise<ShellRunResult>,
    callbacks: OutputCallbacks | undefined,
    cancel: () => void,
    pid: number
  ) => ShellJobIdentity;
  setLastJob: (pid: number) => void;
};

export type ProcessSubstitutionHandler = (
  command: string,
  direction: 'input' | 'output',
  resources: ExpansionResources
) => Promise<string>;

export function createProcessSubstitutionHandler(
  options: ProcessSubstitutionOptions
): ProcessSubstitutionHandler {
  return (command, direction, resources) =>
    startProcessSubstitution(command, direction, resources, options);
}

async function startProcessSubstitution(
  command: string,
  direction: 'input' | 'output',
  resources: ExpansionResources,
  options: ProcessSubstitutionOptions
): Promise<string> {
  const fifoApi = getFifoApi(options.fsClient);
  if (!fifoApi) throw new Error('Process substitution requires FIFO support');

  const id = crypto.randomUUID().replaceAll('-', '');
  const parentOwnerId = `process-sub-parent-${id}`;
  const childOwnerId = `process-sub-child-${id}`;
  let pipe: Awaited<ReturnType<typeof fifoApi.createPipe>>;
  if (direction === 'input') pipe = await fifoApi.createPipe(parentOwnerId, childOwnerId);
  else pipe = await fifoApi.createPipe(childOwnerId, parentOwnerId);
  let parentPath: string;
  let childPath: string;
  let operator: '>' | '<';
  if (direction === 'input') {
    parentPath = pipe.readPath;
    childPath = pipe.writePath;
    operator = '>';
  } else {
    parentPath = pipe.writePath;
    childPath = pipe.readPath;
    operator = '<';
  }
  resources.fifoOwners.push({ path: parentPath, ownerId: parentOwnerId });
  options.registerParentFifoOwner(parentPath, parentOwnerId);

  let child: ProcessSubstitutionChild;
  try {
    child = await options.fork();
  } catch (error) {
    resources.fifoOwners.pop();
    options.releaseParentFifoOwner(parentPath);
    await fifoApi.closeFifos(parentOwnerId);
    await fifoApi.closeFifos(childOwnerId);
    throw error;
  }

  child.registerFifoOwner(childPath, childOwnerId);
  options.trackChild(child, true);
  resources.cancelChildren.push(async () => {
    child.killForeground('SIGINT');
    await fifoApi.closeFifos(childOwnerId);
  });

  const pid = ShellProcess.allocatePid();
  const completion = child
    .run(`(${command}) ${operator} ${childPath}`, resources.processSubstitutionCallbacks, {
      processPid: pid,
    })
    .finally(async () => {
      child.releaseFifoOwner(childPath);
      options.trackChild(child, false);
      try {
        await fifoApi.closeFifos(childOwnerId);
      } finally {
        child.dispose();
      }
    });
  const identity = options.addJob(
    completion,
    resources.processSubstitutionCallbacks,
    () => child.killForeground('SIGINT'),
    pid
  );
  options.setLastJob(identity.pid);
  return parentPath;
}

export async function closeExpansionResources(
  resources: ExpansionResources,
  fsClient: FsApi,
  releaseOwnerPath: (path: string) => void,
  cancelChildren = false
): Promise<void> {
  const fifoApi = getFifoApi(fsClient);
  const owners = resources.fifoOwners.splice(0);
  for (const owner of owners) {
    releaseOwnerPath(owner.path);
    if (fifoApi) await fifoApi.closeFifos(owner.ownerId);
  }
  if (cancelChildren) {
    const cancel = resources.cancelChildren.splice(0);
    await Promise.all(cancel.map(close => close()));
  }
}

export function closeExpansionResourcesOnExit(
  process: Process,
  resources: ExpansionResources,
  fsClient: FsApi,
  releaseOwnerPath: (path: string) => void
): void {
  if (resources.fifoOwners.length === 0) return;
  process.once('exit', (_code, signal) => {
    const cleanup = () => closeExpansionResources(resources, fsClient, releaseOwnerPath);
    if (!process.hasStarted || signal !== null) {
      process.trackCleanup(cleanup());
      return;
    }
    process.deferIOCleanup(cleanup);
  });
}
