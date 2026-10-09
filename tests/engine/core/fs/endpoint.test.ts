import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerNpmCommands } from '@/engine/cmd/global/npmOperations/worker';
import type { FsWorkerApi } from '@/engine/core/fs/endpoint';
import { directoryTree } from '../../../_helpers/opfs';

const exposed = vi.hoisted(() => ({ api: null as FsWorkerApi | null }));
vi.mock('comlink', async importOriginal => {
  const original = await importOriginal<typeof import('comlink')>();
  return {
    ...original,
    expose: (api: FsWorkerApi) => {
      exposed.api = api;
    },
    proxy: <T>(value: T) => value,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('npm endpoint transaction scheduling', () => {
  it('serializes alias install and uninstall without blocking another root or editor saves', async () => {
    const root = directoryTree();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
    await import('@/engine/core/fs/endpoint');
    const api = exposed.api;
    if (!api) throw new Error('The filesystem endpoint was not exposed');
    await api.init(() => {});
    await api.mkdir('/repository');
    await api.mkdir('/other');
    await api.symlink('/repository', '/alias');
    await api.writeFile('/repository/package.json', '0');
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const install = vi.spyOn(WorkerNpmCommands.prototype, 'install').mockResolvedValue('other');
    install.mockImplementationOnce(async () => {
      entered();
      await waiting;
      await api.writeFile('/repository/package.json', '1');
      return 'installed';
    });
    const uninstall = vi
      .spyOn(WorkerNpmCommands.prototype, 'uninstall')
      .mockImplementationOnce(async () => {
        expect(await api.readText('/repository/package.json')).toBe('1');
        await api.writeFile('/repository/package.json', '2');
        return 'uninstalled';
      });
    const first = api.getNpm('/repository').install();
    await started;
    const second = api.getNpm('/alias').uninstall('package');
    expect(await api.getNpm('/other').install()).toBe('other');
    await api.writeFile('/repository/editor.txt', 'saved');
    expect(uninstall).not.toHaveBeenCalled();
    release();
    expect(await first).toBe('installed');
    expect(await second).toBe('uninstalled');
    expect(await api.readText('/repository/package.json')).toBe('2');
    expect(await api.readText('/repository/editor.txt')).toBe('saved');
  });
});
