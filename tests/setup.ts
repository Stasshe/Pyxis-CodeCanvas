import 'fake-indexeddb/auto';
import { vi } from 'vitest';
import { scopedFs } from '@/engine/core/fs/scoped';
import { getTestFs } from './_helpers/testFs';

function createTestFsClient() {
  const source = {
    readFile: (path: string, ownerId?: string, _signal?: AbortSignal) =>
      getTestFs().readFile(path, ownerId),
    readText: (path: string, ownerId?: string, _signal?: AbortSignal) =>
      getTestFs().readText(path, ownerId),
    writeFile: (
      path: string,
      data: string | Uint8Array,
      options?: { mode?: number },
      ownerId?: string,
      _signal?: AbortSignal
    ) => getTestFs().writeFile(path, data, options, true, ownerId),
    writeRange: (
      path: string,
      data: Uint8Array,
      position: number | null,
      create = false,
      exclusive = false,
      mode?: number
    ) => getTestFs().writeRange(path, data, position, create, exclusive, mode),
    readdir: (path: string) => getTestFs().readdir(path),
    stat: (path: string) => getTestFs().stat(path),
    lstat: (path: string) => getTestFs().lstat(path),
    chmod: (path: string, mode: number) => getTestFs().chmod(path, mode),
    realpath: (path: string) => getTestFs().realpath(path),
    readlink: (path: string) => getTestFs().readlink(path),
    symlink: (target: string, path: string) => getTestFs().symlink(target, path),
    mkdir: (path: string, options?: { recursive?: boolean }) => getTestFs().mkdir(path, options),
    rm: (path: string, options?: { recursive?: boolean; force?: boolean }) =>
      getTestFs().rm(path, options),
    rename: (oldPath: string, path: string) => getTestFs().rename(oldPath, path),
    walk: (path: string) => getTestFs().walk(path),
    exists: (path: string) => getTestFs().exists(path),
    createPipe: (readOwnerId: string, writeOwnerId: string) =>
      getTestFs().createPipe(readOwnerId, writeOwnerId),
    getDescriptorPath: (endpointId: string) => getTestFs().getDescriptorPath(endpointId),
    mkfifo: (path: string) => getTestFs().mkfifo(path),
    openFifo: (
      path: string,
      mode: 'read' | 'write' | 'readwrite',
      endpointId: string,
      ownerId: string,
      options?: { nonblocking?: boolean },
      _signal?: AbortSignal
    ) => getTestFs().openFifo(path, mode, endpointId, ownerId, options),
    readFifo: (endpointId: string, maxBytes: number) => getTestFs().readFifo(endpointId, maxBytes),
    writeFifo: (endpointId: string, bytes: Uint8Array) => getTestFs().writeFifo(endpointId, bytes),
    closeFifo: (endpointId: string) => getTestFs().closeFifo(endpointId),
    closeFifos: (ownerId: string) => getTestFs().closeFifos(ownerId),
  };

  return {
    ...source,
    init: async () => {},
    close: () => {},
    scoped: (ownerId: string) => scopedFs(source, ownerId),
    addChangeListener: () => () => {},
    getNpm: async (rootPath: string) => {
      const { WorkerNpmCommands } = await import('@/engine/cmd/global/npmOperations/worker');
      return new WorkerNpmCommands(getTestFs(), rootPath);
    },
  };
}

// Production owns OPFS in a worker; test projects inject a fresh byte-backed OPFS root.
vi.mock('@/engine/core/fs', async importOriginal => {
  const original = await importOriginal<typeof import('@/engine/core/fs')>();
  return { ...original, fsClient: createTestFsClient() };
});

vi.mock('@/engine/core/fs/client', async importOriginal => {
  const original = await importOriginal<typeof import('@/engine/core/fs/client')>();
  return {
    ...original,
    fsClient: { ...original.fsClient, ...createTestFsClient() },
  };
});

vi.mock('@/stores/loggerStore', () => ({
  pushLogMessage: () => {},
  loggerStore: { messages: [] },
}));
