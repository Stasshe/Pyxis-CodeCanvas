import { beforeEach, describe, expect, it } from 'vitest';
import { FSError, FsCore } from '@/engine/core/fs/core';
import type { FsChangeEvent } from '@/engine/core/fs/types';

// /tmp exercises the same path API without requiring browser-only OPFS handles.
describe('filesystem memory mount', () => {
  let core: FsCore;
  let events: FsChangeEvent[];

  beforeEach(() => {
    core = new FsCore();
    events = [];
    core.setChangeListener(event => events.push(event));
  });

  it('stores bytes without aliasing callers or exposing content in metadata', async () => {
    const source = new Uint8Array([0, 255, 20]);
    await core.writeFile('/tmp/data', source);
    source[0] = 3;
    const first = await core.readFile('/tmp/data');
    first[1] = 0;
    expect(await core.readFile('/tmp/data')).toEqual(new Uint8Array([0, 255, 20]));
    expect(await core.stat('/tmp/data')).toMatchObject({
      path: '/tmp/data',
      type: 'file',
      size: 3,
    });
    expect(Object.keys(await core.stat('/tmp/data')).sort()).toEqual([
      'mtime',
      'path',
      'size',
      'type',
    ]);
  });

  it('lists immediate children while walking all descendants', async () => {
    await core.mkdir('/tmp/app/src', { recursive: true });
    await core.writeFile('/tmp/app/src/main.ts', 'hello');
    await core.writeFile('/tmp/app/package.json', '{}');
    expect((await core.readdir('/tmp/app')).map(entry => entry.path)).toEqual([
      '/tmp/app/package.json',
      '/tmp/app/src',
    ]);
    expect((await core.walk('/tmp/app')).map(entry => entry.path)).toEqual([
      '/tmp/app/package.json',
      '/tmp/app/src',
      '/tmp/app/src/main.ts',
    ]);
  });

  it('requires directories and respects recursive removal', async () => {
    await expect(core.writeFile('/tmp/missing/file', 'x')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await core.mkdir('/tmp/dir');
    await core.writeFile('/tmp/dir/file', 'x');
    await expect(core.rm('/tmp/dir')).rejects.toMatchObject({ code: 'EISDIR' });
    await core.rm('/tmp/dir', { recursive: true });
    expect(await core.exists('/tmp/dir/file')).toBe(false);
    await expect(core.rm('/tmp/missing', { force: true })).resolves.toBeUndefined();
    await expect(core.rm('/tmp', { recursive: true })).rejects.toBeInstanceOf(FSError);
  });

  it('renames entire folders and rejects moves into their descendants', async () => {
    await core.mkdir('/tmp/old/sub', { recursive: true });
    await core.writeFile('/tmp/old/sub/file', 'value');
    await expect(core.rename('/tmp/old', '/tmp/old/sub/new')).rejects.toMatchObject({
      code: 'EINVAL',
    });
    events.length = 0;
    await core.rename('/tmp/old', '/tmp/new');
    expect(events).toHaveLength(1);
    expect(await core.readText('/tmp/new/sub/file')).toBe('value');
    expect(await core.exists('/tmp/old')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'rename', oldPath: '/tmp/old', path: '/tmp/new' });
  });
});
