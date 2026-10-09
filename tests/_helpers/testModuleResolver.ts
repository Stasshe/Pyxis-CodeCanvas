import { vi } from 'vitest';
import type { FsCore } from '@/engine/core/fs/core';

vi.mock('sync-message', () => ({
  makeServiceWorkerChannel: vi.fn(() => ({})),
  readMessage: vi.fn(() => null),
}));

import { RuntimeBridge } from '@/engine/system/runtime/bridge/client';
import { attachRuntimePort } from '@/engine/system/runtime/bridge/endpoint';
import type { FsStat } from '@/engine/system/runtime/bridge/protocol';
import { ModuleFileSystem } from '@/engine/system/runtime/module/moduleFileSystem';
import { ModuleResolver } from '@/engine/system/runtime/module/moduleResolver';

export function createTestModuleResolver(repo: FsCore, rootPath: string) {
  const channel = new MessageChannel();
  const bridge = new RuntimeBridge('/', channel.port2, crypto.randomUUID(), () => {
    throw new Error('Unexpected runtime cancellation.');
  });
  attachRuntimePort(
    channel.port1,
    {
      readFile: path => repo.readFile(path),
      writeFile: (path, data) => repo.writeFile(path, data),
      async readdir(path) {
        const entries = await repo.readdir(path);
        return entries.map(entry => entry.path.slice(entry.path.lastIndexOf('/') + 1));
      },
      async stat(path) {
        const entry = await repo.stat(path);
        let type: 'file' | 'directory' = 'file';
        if (entry.type === 'folder') type = 'directory';
        return { type, size: entry.size, mtime: entry.mtime };
      },
      async lstat(path) {
        const entry = await repo.lstat(path);
        let type: FsStat['type'] = 'file';
        if (entry.type === 'folder') type = 'directory';
        if (entry.type === 'symlink') type = 'symlink';
        return { type, size: entry.size, mtime: entry.mtime };
      },
      realpath: path => repo.realpath(path),
      readlink: path => repo.readlink(path),
      symlink: (target, path) => repo.symlink(target, path),
      mkdir: (path, options) => repo.mkdir(path, options),
      rm: (path, options) => repo.rm(path, options),
      rename: (path, newPath) => repo.rename(path, newPath),
    },
    async () => ({ code: '', dependencies: [] })
  );
  const resolver = new ModuleResolver(rootPath, new ModuleFileSystem(bridge));
  return {
    resolver,
    close() {
      bridge.close();
      channel.port1.close();
    },
  };
}
