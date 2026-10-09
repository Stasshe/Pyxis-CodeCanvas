import { describe, expect, it } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { directoryTree } from '../../../_helpers/opfs';

const mutations = [
  {
    name: 'remove the pinned root',
    run: (core: FsCore) => core.rm('/parent/workspace', { recursive: true }),
    removedPath: '/parent/workspace',
    movedPath: null,
  },
  {
    name: 'remove an ancestor of the pinned root',
    run: (core: FsCore) => core.rm('/parent', { recursive: true }),
    removedPath: '/parent',
    movedPath: null,
  },
  {
    name: 'rename the pinned root',
    run: (core: FsCore) => core.rename('/parent/workspace', '/moved'),
    removedPath: '/parent/workspace',
    movedPath: '/moved',
  },
  {
    name: 'rename an ancestor of the pinned root',
    run: (core: FsCore) => core.rename('/parent', '/moved'),
    removedPath: '/parent',
    movedPath: '/moved',
  },
] as const;

const scenarios = mutations.flatMap(mutation =>
  (['success', 'failure'] as const).map(result => ({ ...mutation, result }))
);

describe('filesystem root pins', () => {
  it.each(scenarios)('$name waits until the pinned operation reports $result', async scenario => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/parent');
    await core.mkdir('/parent/workspace');
    await core.mkdir('/other');

    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const pinned = core.withPinnedRoot('/parent/workspace', async () => {
      entered();
      await waiting;
      if (scenario.result === 'failure') throw new Error('operation failed');
    });
    await started;

    let mutationSettled = false;
    const pendingMutation = scenario.run(core).finally(() => {
      mutationSettled = true;
    });
    await core.writeFile('/other/progress', 'available');
    expect(mutationSettled).toBe(false);

    release();
    if (scenario.result === 'failure') {
      await expect(pinned).rejects.toThrow('operation failed');
    } else {
      await pinned;
    }
    await pendingMutation;

    await expect(core.stat(scenario.removedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    if (scenario.movedPath) {
      await expect(core.stat(scenario.movedPath)).resolves.toMatchObject({ type: 'folder' });
    }
    await expect(core.readText('/other/progress')).resolves.toBe('available');
  });
});
