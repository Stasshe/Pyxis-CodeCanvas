import { describe, expect, it, vi } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { directoryTree, storage } from '../../../_helpers/opfs';

describe.each(['/tmp', '/home'])('owner range writes in %s', directory => {
  async function setup(): Promise<FsCore> {
    const core = new FsCore();
    await core.init(directoryTree());
    return core;
  }

  it('preserves untouched bytes and fills sparse gaps with zeros', async () => {
    const core = await setup();
    const path = `${directory}/data`;
    await core.writeFile(path, new Uint8Array([1, 2, 3, 4]));
    expect(await core.writeRange(path, new Uint8Array([8]), 1)).toBe(2);
    expect(await core.readFile(path)).toEqual(new Uint8Array([1, 8, 3, 4]));
    expect(await core.writeRange(path, new Uint8Array([9]), 6)).toBe(7);
    expect(await core.readFile(path)).toEqual(new Uint8Array([1, 8, 3, 4, 0, 0, 9]));
    expect(await core.writeRange(path, new Uint8Array(), 20)).toBe(20);
    expect((await core.stat(path)).size).toBe(7);
  });

  it('serializes competing append requests without losing bytes', async () => {
    const core = await setup();
    const path = `${directory}/data`;
    const ends = await Promise.all([
      core.writeRange(path, new Uint8Array([1, 2]), null, true),
      core.writeRange(path, new Uint8Array([3]), null, true),
      core.writeRange(path, new Uint8Array([4, 5]), null, true),
    ]);
    expect(ends).toEqual([2, 3, 5]);
    expect(await core.readFile(path)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('allows only one competing exclusive creation and preserves its bytes', async () => {
    const core = await setup();
    const path = `${directory}/exclusive`;
    const outcomes = await Promise.allSettled([
      core.writeRange(path, new Uint8Array([1]), 0, true, true),
      core.writeRange(path, new Uint8Array([2]), null, true, true),
    ]);
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: 1 });
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'EEXIST' } });
    expect(await core.readFile(path)).toEqual(new Uint8Array([1]));
    expect(await core.writeRange(path, new Uint8Array([3]), null, true)).toBe(2);
    expect(await core.readFile(path)).toEqual(new Uint8Array([1, 3]));
  });

  it('rejects exclusive creation through existing or dangling symlinks', async () => {
    const core = await setup();
    const path = `${directory}/target`;
    const alias = `${directory}/alias`;
    await core.symlink(path, alias);
    await expect(core.writeRange(alias, new Uint8Array([1]), 0, true, true)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await core.exists(path)).toBe(false);
    await core.writeFile(path, new Uint8Array([2]));
    await expect(
      core.writeRange(alias, new Uint8Array([1]), null, true, true)
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await core.readFile(path)).toEqual(new Uint8Array([2]));
  });

  it('requires existing descriptor targets and validates positions before writing', async () => {
    const core = await setup();
    const path = `${directory}/missing`;
    await expect(core.writeRange(path, new Uint8Array([1]), null)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    for (const position of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(
        core.writeRange(path, new Uint8Array([1]), position, true)
      ).rejects.toMatchObject({ code: 'EINVAL' });
    }
    expect(await core.exists(path)).toBe(false);
    await expect(core.writeRange(directory, new Uint8Array([1]), null, true)).rejects.toMatchObject(
      { code: 'EISDIR' }
    );
    await expect(
      core.writeRange(`${directory}/missing/child`, new Uint8Array([1]), null, true)
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('owner write ordering', () => {
  it.each([
    ['write', 1],
    ['close', 1],
    ['write', null],
    ['close', null],
  ] as const)('preserves bytes after failed range %s at %s', async (phase, position) => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const backing = storage(original);
    const core = new FsCore();
    await core.init(backing.root);
    if (phase === 'write') {
      const stage = backing.writable.write.getMockImplementation();
      if (!stage) throw new Error('Missing writable staging implementation');
      backing.writable.write.mockImplementationOnce(async bytes => {
        await stage(bytes);
        expect(backing.bytes()).toEqual(original);
        throw new DOMException('Quota exceeded after staging', 'QuotaExceededError');
      });
    } else {
      backing.writable.close.mockRejectedValueOnce(
        new DOMException('Quota exceeded during commit', 'QuotaExceededError')
      );
    }
    await expect(core.writeRange('/file', new Uint8Array([9, 8]), position)).rejects.toMatchObject({
      code: 'ENOSPC',
    });
    expect(backing.bytes()).toEqual(original);
    expect(backing.writable.abort).toHaveBeenCalledOnce();
    expect(backing.access.read).not.toHaveBeenCalled();
    expect(await core.writeRange('/file', new Uint8Array([6]), null)).toBe(6);
    expect(backing.bytes()).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('stages positional writes without rereading stored bytes into memory', async () => {
    const backing = storage(new Uint8Array([1, 2, 3]));
    const core = new FsCore();
    await core.init(backing.root);
    expect(await core.writeRange('/file', new Uint8Array([4, 5, 6]), 1)).toBe(4);
    expect(backing.bytes()).toEqual(new Uint8Array([1, 4, 5, 6]));
    expect(backing.access.read).not.toHaveBeenCalled();
    expect(backing.file.createWritable).toHaveBeenCalledWith({ keepExistingData: true });
    expect(backing.writable.seek).toHaveBeenCalledWith(1);
    expect(backing.writable.close).toHaveBeenCalledOnce();
    expect(backing.file.createSyncAccessHandle).not.toHaveBeenCalled();
  });

  it('waits for ordinary writes before reading an aliased append target', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.writeFile('/data', 'old');
    await core.symlink('/data', '/alias');
    const handle = await root.getFileHandle('data');
    const writer = await handle.createWritable();
    const commit = writer.close.bind(writer);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.spyOn(writer, 'close').mockImplementationOnce(async () => {
      started();
      await waiting;
      await commit();
    });
    const replacing = core.writeFile('/data', 'new');
    await entered;
    const appending = core.writeRange('/alias', new TextEncoder().encode('!'), null);
    release();
    await replacing;
    expect(await appending).toBe(4);
    expect(await core.readText('/data')).toBe('new!');
  });
});
