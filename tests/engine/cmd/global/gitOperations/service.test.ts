import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueuedGitCommands } from '@/engine/cmd/global/gitOperations/service';
import { WorkerGitCommands } from '@/engine/cmd/global/gitOperations/worker';
import { FsCore } from '@/engine/core/fs/core';
import { directoryTree } from '../../../../_helpers/opfs';

afterEach(() => vi.restoreAllMocks());

describe('repository transaction scheduling', () => {
  it.each(['rename', 'remove', 'alias'])(
    'pins repository ancestors during %s while Git writes continue',
    async action => {
      const core = new FsCore();
      await core.init(directoryTree());
      await core.mkdir('/parent/repository', { recursive: true });
      await core.symlink('/parent', '/bridge');
      await core.symlink('/bridge/repository', '/alias');
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => {
        release = resolve;
      });
      const started = new Promise<void>(resolve => {
        entered = resolve;
      });
      vi.spyOn(WorkerGitCommands.prototype, 'tree').mockImplementationOnce(async () => {
        entered();
        await waiting;
        await core.mkdir('/alias/.git/refs', { recursive: true });
        await core.writeFile('/alias/.git/refs/deferred', 'completed');
        return 'done';
      });
      const transaction = new QueuedGitCommands(core, '/alias').tree();
      await started;
      let mutation: Promise<void>;
      if (action === 'rename') mutation = core.rename('/parent', '/moved');
      else if (action === 'remove') mutation = core.rm('/parent', { recursive: true });
      else mutation = core.rename('/bridge', '/moved-bridge');
      let mutated = false;
      const tracked = mutation.then(() => {
        mutated = true;
      });
      await core.mkdir('/unrelated');
      await core.writeFile('/parent/repository/editor.txt', 'saved');
      expect(mutated).toBe(false);
      release();
      expect(await transaction).toBe('done');
      await tracked;
      if (action === 'rename') {
        expect(await core.readText('/moved/repository/.git/refs/deferred')).toBe('completed');
        expect(await core.exists('/parent')).toBe(false);
      } else if (action === 'remove') expect(await core.exists('/parent')).toBe(false);
      else expect(await core.readText('/parent/repository/.git/refs/deferred')).toBe('completed');
    }
  );

  it('releases a root pin after a failed network transaction', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/parent/repository', { recursive: true });
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    vi.spyOn(WorkerGitCommands.prototype, 'tree').mockImplementationOnce(async () => {
      entered();
      await waiting;
      throw new Error('network failed');
    });
    const transaction = new QueuedGitCommands(core, '/parent/repository').tree();
    const rejected = expect(transaction).rejects.toThrow('network failed');
    await started;
    const removal = core.rm('/parent', { recursive: true });
    await core.writeFile('/parent/repository/editor', 'allowed');
    release();
    await rejected;
    await removal;
    expect(await core.exists('/parent')).toBe(false);
  });

  it('shares alias repository queues while other repositories and editor writes continue', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/repository');
    await core.mkdir('/other');
    await core.symlink('/repository', '/alias');
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const tree = vi.spyOn(WorkerGitCommands.prototype, 'tree').mockResolvedValue('done');
    tree.mockImplementationOnce(async () => {
      entered();
      await waiting;
      return 'first';
    });
    const first = new QueuedGitCommands(core, '/repository').tree();
    await started;
    const alias = new QueuedGitCommands(core, '/alias').tree();
    const other = new QueuedGitCommands(core, '/other').tree();
    expect(await other).toBe('done');
    expect(tree).toHaveBeenCalledTimes(2);
    await core.writeFile('/repository/editor.txt', 'saved during network wait');
    expect(await core.readText('/repository/editor.txt')).toBe('saved during network wait');
    release();
    expect(await first).toBe('first');
    expect(await alias).toBe('done');
    expect(tree).toHaveBeenCalledTimes(3);
  });

  it('releases a repository queue after an operation fails', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/repository');
    vi.spyOn(WorkerGitCommands.prototype, 'tree')
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValue('recovered');
    const commands = new QueuedGitCommands(core, '/repository');
    await expect(commands.tree()).rejects.toThrow('network failed');
    expect(await commands.tree()).toBe('recovered');
  });
});
