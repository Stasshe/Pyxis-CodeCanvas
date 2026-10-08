import { vi } from 'vitest';
import { getTestFs } from './_helpers/testFs';

// Production owns OPFS in a worker; test projects inject a fresh byte-backed OPFS root.
vi.mock('@/engine/core/fs', async importOriginal => {
  const original = await importOriginal<typeof import('@/engine/core/fs')>();
  return {
    ...original,
    fsClient: {
      init: async () => {},
      close: () => {},
      readFile: (path: string) => getTestFs().readFile(path),
      readText: (path: string) => getTestFs().readText(path),
      writeFile: (path: string, content: string | Uint8Array) =>
        getTestFs().writeFile(path, content),
      stat: (path: string) => getTestFs().stat(path),
      lstat: (path: string) => getTestFs().lstat(path),
      realpath: (path: string) => getTestFs().realpath(path),
      readlink: (path: string) => getTestFs().readlink(path),
      symlink: (target: string, path: string) => getTestFs().symlink(target, path),
      readdir: (path: string) => getTestFs().readdir(path),
      mkdir: (path: string, options?: { recursive?: boolean }) => getTestFs().mkdir(path, options),
      rm: (path: string, options?: { recursive?: boolean; force?: boolean }) =>
        getTestFs().rm(path, options),
      rename: (oldPath: string, newPath: string) => getTestFs().rename(oldPath, newPath),
      exists: (path: string) => getTestFs().exists(path),
      walk: (root: string) => getTestFs().walk(root),
      addChangeListener: () => () => {},
    },
  };
});

vi.mock('@/engine/core/fs/client', async importOriginal => {
  const original = await importOriginal<typeof import('@/engine/core/fs/client')>();
  return {
    ...original,
    fsClient: {
      ...original.fsClient,
      init: async () => {},
      readFile: (path: string) => getTestFs().readFile(path),
      readText: (path: string) => getTestFs().readText(path),
      writeFile: (path: string, content: string | Uint8Array) =>
        getTestFs().writeFile(path, content),
      stat: (path: string) => getTestFs().stat(path),
      lstat: (path: string) => getTestFs().lstat(path),
      realpath: (path: string) => getTestFs().realpath(path),
      readlink: (path: string) => getTestFs().readlink(path),
      symlink: (target: string, path: string) => getTestFs().symlink(target, path),
      readdir: (path: string) => getTestFs().readdir(path),
      mkdir: (path: string, options?: { recursive?: boolean }) => getTestFs().mkdir(path, options),
      rm: (path: string, options?: { recursive?: boolean; force?: boolean }) =>
        getTestFs().rm(path, options),
      rename: (oldPath: string, newPath: string) => getTestFs().rename(oldPath, newPath),
      exists: (path: string) => getTestFs().exists(path),
      walk: (root: string) => getTestFs().walk(root),
      getNpm: async (rootPath: string) => {
        const { WorkerNpmCommands } = await import('@/engine/cmd/global/npmOperations/worker');
        return new WorkerNpmCommands(getTestFs(), rootPath);
      },
    },
  };
});

vi.mock('@/stores/loggerStore', () => ({
  pushLogMessage: () => {},
  loggerStore: { messages: [] },
}));
