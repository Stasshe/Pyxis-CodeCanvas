import * as Comlink from 'comlink';
import { QueuedGitCommands } from '@/engine/cmd/global/gitOperations/service';
import { WorkerNpmCommands } from '@/engine/cmd/global/npmOperations/worker';
import { attachRuntimePort } from '@/engine/runtime/bridge/endpoint';
import type { FsBenchmark, FsStat } from '@/engine/runtime/bridge/protocol';
import type { TranspilerDescriptor } from '@/engine/runtime/core/RuntimeProvider';
import { TranspileManager } from '@/engine/runtime/transpiler/transpileManager';
import { FsCore } from './core';
import { registerFsErrors } from './errors';
import { queueRootOperation } from './locks';
import { type SearchRequest, searchFiles } from './search';
import type {
  FifoMode,
  FifoOpenOptions,
  FsChangeEvent,
  MkdirOptions,
  RenameOptions,
  RmOptions,
} from './types';
import { createWorkspace, ensureDemoWorkspace } from './workspace';

registerFsErrors();

const core = new FsCore();
const transpileManager = new TranspileManager(core);
/** Core leases protect each filesystem operation; network waits never block editor I/O. */
async function run<T>(operation: () => Promise<T>, benchmark?: FsBenchmark): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    if (benchmark) benchmark.coreMs += performance.now() - startedAt;
  }
}

const api = {
  async init(onChange: (event: FsChangeEvent) => void): Promise<void> {
    core.setChangeListener(onChange);
    await run(() => core.init());
  },
  readFile: (path: string, benchmark?: FsBenchmark, ownerId?: string) =>
    run(() => core.readFile(path, ownerId), benchmark),
  readText: (path: string, ownerId?: string) => run(() => core.readText(path, ownerId)),
  writeFile: (path: string, data: string | Uint8Array, benchmark?: FsBenchmark, ownerId?: string) =>
    run(() => core.writeFile(path, data, true, ownerId), benchmark),
  mkfifo: (path: string) => run(() => core.mkfifo(path)),
  createPipe: (readOwnerId: string, writeOwnerId: string) =>
    run(() => core.createPipe(readOwnerId, writeOwnerId)),
  getDescriptorPath: (endpointId: string) => run(() => core.getDescriptorPath(endpointId)),
  openFifo: (
    path: string,
    mode: FifoMode,
    endpointId: string,
    ownerId: string,
    options?: FifoOpenOptions
  ) => run(() => core.openFifo(path, mode, endpointId, ownerId, options)),
  readFifo: (endpointId: string, maxBytes: number) =>
    run(() => core.readFifo(endpointId, maxBytes)),
  writeFifo: (endpointId: string, bytes: Uint8Array) =>
    run(() => core.writeFifo(endpointId, bytes)),
  closeFifo: (endpointId: string) => run(() => core.closeFifo(endpointId)),
  closeFifos: (ownerId: string) => run(() => core.closeFifos(ownerId)),
  writeRange: (
    path: string,
    data: Uint8Array,
    position: number | null,
    create = false,
    exclusive = false,
    benchmark?: FsBenchmark
  ) => run(() => core.writeRange(path, data, position, create, exclusive), benchmark),
  readdir: (path: string, benchmark?: FsBenchmark) => run(() => core.readdir(path), benchmark),
  stat: (path: string, benchmark?: FsBenchmark) => run(() => core.stat(path), benchmark),
  lstat: (path: string, benchmark?: FsBenchmark) => run(() => core.lstat(path), benchmark),
  realpath: (path: string, benchmark?: FsBenchmark) => run(() => core.realpath(path), benchmark),
  readlink: (path: string, benchmark?: FsBenchmark) => run(() => core.readlink(path), benchmark),
  symlink: (target: string, path: string, benchmark?: FsBenchmark) =>
    run(() => core.symlink(target, path), benchmark),
  mkdir: (path: string, options?: MkdirOptions, benchmark?: FsBenchmark) =>
    run(() => core.mkdir(path, options), benchmark),
  rm: (path: string, options?: RmOptions, benchmark?: FsBenchmark) =>
    run(() => core.rm(path, options), benchmark),
  rename: (oldPath: string, newPath: string, benchmark?: FsBenchmark, options?: RenameOptions) =>
    run(() => core.rename(oldPath, newPath, options), benchmark),
  walk: (root: string) => run(() => core.walk(root)),
  exists: (path: string) => run(() => core.exists(path)),
  createWorkspace: (name: string) => run(() => createWorkspace(core, name)),
  ensureDemoWorkspace: () => run(() => ensureDemoWorkspace(core)),
  configureTranspilers(descriptors: TranspilerDescriptor[]): void {
    transpileManager.configureTranspilers(descriptors);
  },
  search: (root: string, request: SearchRequest) => run(() => searchFiles(core, root, request)),
  createRuntimePort(): MessagePort {
    const channel = new MessageChannel();
    attachRuntimePort(
      channel.port1,
      {
        readFile: api.readFile,
        writeFile: api.writeFile,
        openFifo: api.openFifo,
        readFifo: api.readFifo,
        writeFifo: api.writeFifo,
        closeFifo: api.closeFifo,
        writeRange: api.writeRange,
        mkdir: api.mkdir,
        rm: api.rm,
        rename: api.rename,
        realpath: api.realpath,
        readlink: api.readlink,
        symlink: api.symlink,
        async lstat(path, benchmark): Promise<FsStat> {
          const entry = await api.lstat(path, benchmark);
          let type: FsStat['type'] = 'file';
          if (entry.type === 'folder') type = 'directory';
          else if (entry.type === 'symlink') type = 'symlink';
          else if (entry.type === 'fifo') type = 'fifo';
          else if (entry.type === 'characterDevice') type = 'characterDevice';
          return { type, size: entry.size, mtime: entry.mtime };
        },
        async readdir(path, benchmark) {
          return (await api.readdir(path, benchmark)).map(entry =>
            entry.path.slice(entry.path.lastIndexOf('/') + 1)
          );
        },
        async stat(path, benchmark): Promise<FsStat> {
          const entry = await api.stat(path, benchmark);
          let type: FsStat['type'] = 'file';
          if (entry.type === 'folder') type = 'directory';
          else if (entry.type === 'fifo') type = 'fifo';
          else if (entry.type === 'characterDevice') type = 'characterDevice';
          return { type, size: entry.size, mtime: entry.mtime };
        },
      },
      request => transpileManager.transpile(request)
    );
    return Comlink.transfer(channel.port2, [channel.port2]);
  },
  getGit(root: string) {
    return Comlink.proxy(new QueuedGitCommands(core, root));
  },
  getNpm(rootPath: string) {
    const npm = new WorkerNpmCommands(core, rootPath);
    const schedule = <T>(operation: () => Promise<T>) =>
      core.withPinnedRoot(rootPath, root => queueRootOperation(core, `npm:${root}`, operation));
    return Comlink.proxy({
      install: (...args: Parameters<WorkerNpmCommands['install']>) =>
        schedule(() => npm.install(...args)),
      installPackages: (...args: Parameters<WorkerNpmCommands['installPackages']>) =>
        schedule(() => npm.installPackages(...args)),
      uninstall: (...args: Parameters<WorkerNpmCommands['uninstall']>) =>
        schedule(() => npm.uninstall(...args)),
      list: (...args: Parameters<WorkerNpmCommands['list']>) => schedule(() => npm.list(...args)),
      init: (...args: Parameters<WorkerNpmCommands['init']>) => schedule(() => npm.init(...args)),
    });
  },
};

export type FsWorkerApi = typeof api;
Comlink.expose(api);
