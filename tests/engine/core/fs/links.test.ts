import { describe, expect, it, vi } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../_helpers/opfs';

describe('filesystem symbolic links', () => {
  it('follows intermediate and final links, preserving relative targets and dot-dot order', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/actual/deep', { recursive: true });
    await core.mkdir('/alias');
    await core.writeFile('/actual/file', 'payload');
    await core.symlink('../actual/deep', '/alias/link');
    expect(await core.readlink('/alias/link')).toBe('../actual/deep');
    expect(await core.realpath('/alias/link/../file')).toBe('/actual/file');
    expect(await core.readText('/alias/link/../file')).toBe('payload');
    await core.symlink('/actual/file', '/file-link');
    expect((await core.stat('/file-link')).type).toBe('file');
    expect((await core.lstat('/file-link')).type).toBe('symlink');
    await core.writeFile('/file-link', 'new');
    expect(await core.readText('/actual/file')).toBe('new');
    await expect(core.stat('/file-link/')).rejects.toMatchObject({ code: 'ENOTDIR' });
    await expect(core.stat('/file-link/.')).rejects.toMatchObject({ code: 'ENOTDIR' });
    await expect(core.stat('/file-link/..')).rejects.toMatchObject({ code: 'ENOTDIR' });
    expect((await core.lstat('/alias/link/')).type).toBe('folder');
    expect((await core.stat('/')).type).toBe('folder');
    await core.mkdir('/created/');
  });

  it('persists OPFS links across initialization, hides implementation storage, and keeps tmp volatile', async () => {
    const root = directoryTree();
    const first = new FsCore();
    await first.init(root);
    await first.symlink('missing', '/dangling');
    await first.symlink('/dangling', '/tmp/volatile');
    const next = new FsCore();
    await next.init(root);
    expect(await next.readlink('/dangling')).toBe('missing');
    expect((await next.lstat('/dangling')).type).toBe('symlink');
    expect(await next.exists('/dangling')).toBe(false);
    await expect(next.lstat('/tmp/volatile')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await next.readdir('/')).map(entry => entry.path)).toEqual([
      '/dangling',
      '/home',
      '/tmp',
    ]);
    await expect(next.readlink('/home')).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('moves and deletes link entries without touching their referents, including descendants', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/tree');
    await core.writeFile('/referent', 'kept');
    await core.symlink('/referent', '/tree/link');
    await core.symlink('missing', '/tree/broken');
    await core.rename('/tree', '/moved');
    expect(await core.readlink('/moved/link')).toBe('/referent');
    expect(await core.readlink('/moved/broken')).toBe('missing');
    await core.rename('/moved/broken', '/renamed');
    await core.rm('/renamed');
    await core.rm('/moved', { recursive: true });
    expect(await core.readText('/referent')).toBe('kept');
    expect(await core.exists('/tree')).toBe(false);
    await expect(core.lstat('/moved/link')).rejects.toMatchObject({ code: 'ENOENT' });
    await core.writeFile('/source', 'replacement');
    await core.symlink('/referent', '/destination');
    await core.rename('/source', '/destination');
    expect((await core.lstat('/destination')).type).toBe('file');
    expect(await core.readText('/destination')).toBe('replacement');
    expect(await core.readText('/referent')).toBe('kept');
  });

  it('detects cycles, rejects link collisions, and exposes symlinks through Git stats', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.symlink('b', '/a');
    await core.symlink('a', '/b');
    await expect(core.stat('/a')).rejects.toMatchObject({ code: 'ELOOP' });
    await expect(core.realpath('/a')).rejects.toMatchObject({ code: 'ELOOP' });
    await expect(core.symlink('other', '/a')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await core.readlink('/a')).toBe('b');
    await core.mkdir('/directory');
    await core.symlink('/directory', '/directory-link');
    await core.mkdir('/directory-link', { recursive: true });
    await expect(core.mkdir('/directory-link')).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(core.rm('/directory-link/', { recursive: true })).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
    expect((await core.stat('/directory')).type).toBe('folder');
    await core.writeFile('/ordinary', 'file');
    await core.symlink('/ordinary/', '/invalid-directory-target');
    await expect(core.stat('/invalid-directory-target')).rejects.toMatchObject({ code: 'ENOTDIR' });
    const git = createGitFs(core).promises;
    expect((await git.lstat('/a')).isSymbolicLink()).toBe(true);
    expect((await git.lstat('/a')).mode).toBe(0o120777);
    await git.unlink('/a');
    expect(await git.readlink('/b')).toBe('a');
  });

  it('allows forty links and rejects a forty-first traversal', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.writeFile('/last', 'target');
    let target = '/last';
    for (let index = 0; index < 41; index += 1) {
      const path = `/link-${index}`;
      await core.symlink(target, path);
      target = path;
    }
    expect(await core.realpath('/link-39')).toBe('/last');
    await expect(core.realpath('/link-40')).rejects.toMatchObject({ code: 'ELOOP' });
  });

  it('reports corrupt persisted link records instead of silently losing links', async () => {
    const root = directoryTree();
    const first = new FsCore();
    await first.init(root);
    await first.symlink('missing', '/link');
    const records = await root.getDirectoryHandle('.pyxis-fs-links');
    for await (const [name] of records.entries()) {
      const record = await records.getFileHandle(name);
      vi.spyOn(record, 'getFile').mockResolvedValue(new File(['{"path":42}'], name));
    }
    await expect(new FsCore().init(root)).rejects.toThrow('Invalid symbolic link record');
  });
});
