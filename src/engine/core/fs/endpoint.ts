import * as Comlink from 'comlink';
import { QueuedGitCommands } from '@/engine/cmd/global/gitOperations/service';
import { WorkerNpmCommands } from '@/engine/cmd/global/npmOperations/worker';
import { attachRuntimePort } from '@/engine/runtime/bridge/endpoint';
import type { FsBenchmark, FsStat } from '@/engine/runtime/bridge/protocol';
import type { TranspilerDescriptor } from '@/engine/runtime/core/RuntimeProvider';
import { TranspileManager } from '@/engine/runtime/transpiler/transpileManager';
import { FsCore } from './core';
import { registerFsErrors } from './errors';
import { type SearchRequest, searchFiles } from './search';
import type { FsChangeEvent, MkdirOptions, RmOptions } from './types';
import { createWorkspace, ensureDemoWorkspace } from './workspace';

registerFsErrors();

const core = new FsCore();
const transpileManager = new TranspileManager(core);
let queue: Promise<void> = Promise.resolve();

/** Client endpoints share a queue; direct services use Core access-handle locks. */
function run<T>(operation: () => Promise<T>, benchmark?: FsBenchmark): Promise<T> {
  let queuedOperation = operation;
  if (benchmark) {
    const enteredAt = performance.now();
    queuedOperation = async () => {
      const startedAt = performance.now();
      benchmark.queueMs += startedAt - enteredAt;
      try {
        return await operation();
      } finally {
        benchmark.coreMs += performance.now() - startedAt;
      }
    };
  }
  const result = queue.then(queuedOperation);
  queue = result.then(
    () => {},
    () => {}
  );
  return result;
}

const api = {
  async init(onChange: (event: FsChangeEvent) => void): Promise<void> {
    core.setChangeListener(onChange);
    await run(() => core.init());
  },
  readFile: (path: string, benchmark?: FsBenchmark) => run(() => core.readFile(path), benchmark),
  readText: (path: string) => run(() => core.readText(path)),
  writeFile: (path: string, data: string | Uint8Array, benchmark?: FsBenchmark) =>
    run(() => core.writeFile(path, data), benchmark),
  readdir: (path: string, benchmark?: FsBenchmark) => run(() => core.readdir(path), benchmark),
  stat: (path: string, benchmark?: FsBenchmark) => run(() => core.stat(path), benchmark),
  mkdir: (path: string, options?: MkdirOptions, benchmark?: FsBenchmark) =>
    run(() => core.mkdir(path, options), benchmark),
  rm: (path: string, options?: RmOptions, benchmark?: FsBenchmark) =>
    run(() => core.rm(path, options), benchmark),
  rename: (oldPath: string, newPath: string, benchmark?: FsBenchmark) =>
    run(() => core.rename(oldPath, newPath), benchmark),
  walk: (root: string) => run(() => core.walk(root)),
  exists: (path: string) => run(() => core.exists(path)),
  createWorkspace: (name: string) => run(() => createWorkspace(core, name)),
  ensureDemoWorkspace: () => run(() => ensureDemoWorkspace(core)),
  configureTranspilers(descriptors: TranspilerDescriptor[]): void {
    transpileManager.configureTranspilers(descriptors);
  },
  search: (root: string, request: SearchRequest) => run(() => searchFiles(core, root, request)),
  createPort(): MessagePort {
    const channel = new MessageChannel();
    Comlink.expose(api, channel.port1);
    return Comlink.transfer(channel.port2, [channel.port2]);
  },
  createRuntimePort(): MessagePort {
    const channel = new MessageChannel();
    attachRuntimePort(
      channel.port1,
      {
        readFile: api.readFile,
        writeFile: api.writeFile,
        mkdir: api.mkdir,
        rm: api.rm,
        rename: api.rename,
        async readdir(path, benchmark) {
          return (await api.readdir(path, benchmark)).map(entry =>
            entry.path.slice(entry.path.lastIndexOf('/') + 1)
          );
        },
        async stat(path, benchmark): Promise<FsStat> {
          const entry = await api.stat(path, benchmark);
          let type: FsStat['type'] = 'file';
          if (entry.type === 'folder') type = 'directory';
          return { type, size: entry.size, mtime: entry.mtime };
        },
      },
      request => transpileManager.transpile(request)
    );
    return Comlink.transfer(channel.port2, [channel.port2]);
  },
  getGit(root: string) {
    return Comlink.proxy(new QueuedGitCommands(core, root, run));
  },
  getNpm(rootPath: string) {
    const npm = new WorkerNpmCommands(core, rootPath);
    return Comlink.proxy({
      install: (...args: Parameters<WorkerNpmCommands['install']>) =>
        run(() => npm.install(...args)),
      uninstall: (...args: Parameters<WorkerNpmCommands['uninstall']>) =>
        run(() => npm.uninstall(...args)),
      list: (...args: Parameters<WorkerNpmCommands['list']>) => run(() => npm.list(...args)),
      init: (...args: Parameters<WorkerNpmCommands['init']>) => run(() => npm.init(...args)),
    });
  },
};

export type FsWorkerApi = typeof api;
Comlink.expose(api);
