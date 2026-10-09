import { beforeEach, describe, expect, it } from 'vitest';
import { FSError, FsCore } from '@/engine/core/fs/core';
import type { FsChangeEvent } from '@/engine/core/fs/types';
import { directoryTree } from '../../../_helpers/opfs';

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
      mode: 0o100644,
      size: 3,
    });
    expect(Object.keys(await core.stat('/tmp/data')).sort()).toEqual([
      'mode',
      'mtime',
      'path',
      'size',
      'type',
    ]);
  });

  it('allows only one concurrent no-overwrite rename to claim a destination', async () => {
    await core.init(directoryTree());
    await core.mkdir('/case');
    await core.writeFile('/case/first', 'first');
    await core.writeFile('/case/second', 'second');

    const results = await Promise.allSettled([
      core.rename('/case/first', '/case/destination', { overwrite: false }),
      core.rename('/case/second', '/case/destination', { overwrite: false }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const winner = await core.readText('/case/destination');
    expect(['first', 'second']).toContain(winner);
    expect(await core.exists(`/case/${winner === 'first' ? 'first' : 'second'}`)).toBe(false);
    expect(await core.readText(`/case/${winner === 'first' ? 'second' : 'first'}`)).toBe(
      winner === 'first' ? 'second' : 'first'
    );
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'EEXIST', path: '/case/destination' },
    });
  });

  it('decodes text as UTF-8 with the standard replacement and BOM behavior', async () => {
    await core.writeFile('/tmp/bom.txt', new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]));
    await core.writeFile('/tmp/invalid.txt', new Uint8Array([0xc3, 0x28]));

    expect(await core.readText('/tmp/bom.txt')).toBe('hi');
    expect(await core.readText('/tmp/invalid.txt')).toBe('\ufffd(');
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

  it('reports mount sources only on mount roots', async () => {
    await core.init(directoryTree());
    await core.writeFile('/tmp/ordinary-file', 'value');

    const rootEntries = await core.readdir('/');
    expect(rootEntries.find(entry => entry.path === '/tmp')).toMatchObject({ mount: 'memory' });
    expect(rootEntries.find(entry => entry.path === '/dev')).toMatchObject({ mount: 'devices' });
    expect(await core.stat('/tmp')).toMatchObject({ mount: 'memory' });
    expect(await core.lstat('/tmp')).toMatchObject({ mount: 'memory' });
    expect(await core.stat('/dev')).toMatchObject({ mount: 'devices' });
    expect(await core.lstat('/dev')).toMatchObject({ mount: 'devices' });
    expect(await core.stat('/tmp/ordinary-file')).not.toHaveProperty('mount');
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
