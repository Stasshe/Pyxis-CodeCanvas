import { describe, expect, it, vi } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { FIFO_STORAGE } from '@/engine/core/fs/fifo';
import { createGitFs } from '@/engine/core/fs/git';
import { LINK_STORAGE, Links } from '@/engine/core/fs/links';
import type { FsChangeEvent } from '@/engine/core/fs/types';
import { ProjectTree } from '@/engine/core/workspace/projectTree';
import { directoryTree } from '../../../_helpers/opfs';

describe('filesystem symbolic links', () => {
  it.each(['symlink', 'regular file'])(
    'leaves the source and %s destination unchanged when source metadata removal fails',
    async destinationType => {
      const root = directoryTree();
      const core = new FsCore();
      await core.init(root);
      await core.symlink('/source-target', '/source');
      if (destinationType === 'symlink') await core.symlink('/destination-target', '/destination');
      else await core.writeFile('/destination', 'destination bytes');

      const records = await root.getDirectoryHandle(LINK_STORAGE);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('/source'));
      const sourceRecord = Array.from(new Uint8Array(digest), byte =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const removeEntry = records.removeEntry.bind(records);
      vi.spyOn(records, 'removeEntry').mockImplementation(async (name, options) => {
        if (name === sourceRecord) throw new Error('source record removal failed');
        return removeEntry(name, options);
      });

      await expect(core.rename('/source', '/destination')).rejects.toThrow(
        'source record removal failed'
      );
      expect(await core.readlink('/source')).toBe('/source-target');
      if (destinationType === 'symlink') {
        expect(await core.readlink('/destination')).toBe('/destination-target');
      } else {
        expect(await core.readText('/destination')).toBe('destination bytes');
      }
      const next = new FsCore();
      await next.init(root);
      expect(await next.readlink('/source')).toBe('/source-target');
      if (destinationType === 'symlink') {
        expect(await next.readlink('/destination')).toBe('/destination-target');
      } else {
        expect(await next.readText('/destination')).toBe('destination bytes');
      }
    }
  );

  it('restores an existing destination link if replacing it with a file fails', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.writeFile('/source', 'source bytes');
    await core.writeFile('/referent', 'referent bytes');
    await core.symlink('/referent', '/destination');
    const source = await root.getFileHandle('source');
    vi.spyOn(source, 'move').mockRejectedValueOnce(new Error('write failed'));
    await expect(core.rename('/source', '/destination')).rejects.toThrow('write failed');
    expect(await core.readlink('/destination')).toBe('/referent');
    expect(await core.readText('/referent')).toBe('referent bytes');
    expect(await core.readText('/source')).toBe('source bytes');
    const next = new FsCore();
    await next.init(root);
    expect(await next.readlink('/destination')).toBe('/referent');
  });

  it('preserves a regular destination when replacing it with a link cannot delete the payload', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.writeFile('/destination', 'existing bytes');
    await core.symlink('/referent', '/source');
    vi.spyOn(root, 'removeEntry').mockRejectedValueOnce(new Error('removal failed'));
    await expect(core.rename('/source', '/destination')).rejects.toThrow('removal failed');
    expect((await core.lstat('/destination')).type).toBe('file');
    expect(await core.readText('/destination')).toBe('existing bytes');
    expect(await core.readlink('/source')).toBe('/referent');
  });

  it('preserves a committed link record after an aborted replacement', async () => {
    const root = directoryTree();
    const links = new Links();
    await links.init(root);
    await links.create('/link', '/original');
    const records = await root.getDirectoryHandle('.pyxis-fs-links');
    for await (const [name] of records.entries()) {
      const handle = await records.getFileHandle(name);
      const stream = await handle.createWritable();
      vi.spyOn(stream, 'close').mockRejectedValueOnce(new Error('commit failed'));
    }
    await expect(links.create('/link', '/replacement')).rejects.toThrow('commit failed');
    expect(links.entries.get('/link')?.target).toBe('/original');
    const next = new Links();
    await next.init(root);
    expect(next.entries.get('/link')?.target).toBe('/original');
  });
  it('denies reserved records through link targets and dot-dot traversal', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/directory');
    await core.symlink('/.pyxis-fs-links', '/reserved');
    await core.symlink('/directory', '/alias');
    for (const path of ['/reserved/record', '/alias/../.pyxis-fs-links/record']) {
      for (const operation of [
        () => core.readFile(path),
        () => core.writeFile(path, 'payload'),
        () => core.stat(path),
        () => core.lstat(path),
        () => core.readdir(path),
        () => core.realpath(path),
        () => core.readlink(path),
        () => core.mkdir(path, { recursive: true }),
        () => core.rm(path, { recursive: true, force: true }),
        () => core.symlink('/directory', path),
        () => core.rename('/directory', path),
        () => core.rename(path, '/destination'),
      ]) {
        await expect(operation()).rejects.toMatchObject({ code: 'EACCES' });
      }
    }
  });
  it('preserves descendant links when deleting their directory fails', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/tree');
    await core.symlink('/missing', '/tree/link');
    await core.mkfifo('/tree/pipe');
    vi.spyOn(root, 'removeEntry').mockRejectedValueOnce(
      new DOMException('Directory is busy', 'NoModificationAllowedError')
    );
    await expect(core.rm('/tree', { recursive: true })).rejects.toMatchObject({ code: 'EIO' });
    expect(await core.readlink('/tree/link')).toBe('/missing');
    expect(await core.stat('/tree/pipe')).toMatchObject({ type: 'fifo' });
    const next = new FsCore();
    await next.init(root);
    expect(await next.readlink('/tree/link')).toBe('/missing');
    expect(await next.stat('/tree/pipe')).toMatchObject({ type: 'fifo' });
  });

  it('restores earlier sidecars when a descendant FIFO record cannot be removed', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/tree');
    await core.symlink('/missing', '/tree/link');
    await core.mkfifo('/tree/pipe');
    const records = await root.getDirectoryHandle(FIFO_STORAGE);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('/tree/pipe'));
    const fifoRecord = Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const removeEntry = records.removeEntry.bind(records);
    vi.spyOn(records, 'removeEntry').mockImplementation(async (name, options) => {
      if (name === fifoRecord) throw new Error('FIFO record removal failed');
      return removeEntry(name, options);
    });

    await expect(core.rm('/tree', { recursive: true })).rejects.toThrow(
      'FIFO record removal failed'
    );
    expect(await core.readlink('/tree/link')).toBe('/missing');
    expect(await core.stat('/tree/pipe')).toMatchObject({ type: 'fifo' });
    const next = new FsCore();
    await next.init(root);
    expect(await next.readlink('/tree/link')).toBe('/missing');
    expect(await next.stat('/tree/pipe')).toMatchObject({ type: 'fifo' });
  });

  it('preserves nested sidecar cleanup causes when rm translates the failure', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/tree');
    await core.symlink('/missing', '/tree/link');
    await core.mkfifo('/tree/pipe');
    const linkRecords = await root.getDirectoryHandle(LINK_STORAGE);
    const linkDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('/tree/link')
    );
    const linkRecord = Array.from(new Uint8Array(linkDigest), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const lookup = linkRecords.getFileHandle.bind(linkRecords);
    vi.spyOn(linkRecords, 'getFileHandle').mockImplementation(async (name, options) => {
      const handle = await lookup(name, options);
      if (name === linkRecord && options?.create) {
        vi.spyOn(handle, 'createWritable').mockRejectedValueOnce(new Error('link restore failed'));
      }
      return handle;
    });
    const fifoRecords = await root.getDirectoryHandle(FIFO_STORAGE);
    const fifoDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('/tree/pipe')
    );
    const fifoRecord = Array.from(new Uint8Array(fifoDigest), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const removeEntry = fifoRecords.removeEntry.bind(fifoRecords);
    vi.spyOn(fifoRecords, 'removeEntry').mockImplementation(async (name, options) => {
      if (name === fifoRecord) throw new Error('FIFO removal failed');
      return removeEntry(name, options);
    });

    await expect(core.rm('/tree', { recursive: true })).rejects.toMatchObject({
      name: 'FSError',
      message:
        'EIO: /tree: Failed to remove sidecars under /tree [FIFO removal failed; Failed to restore sidecars under /tree [link restore failed]]',
      code: 'EIO',
      path: '/tree',
      cause: {
        name: 'AggregateError',
        errors: [
          { message: 'FIFO removal failed' },
          {
            name: 'AggregateError',
            errors: [{ message: 'link restore failed' }],
          },
        ],
      },
    });
  });

  it('keeps the copied directory and source sidecars when source deletion fails', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/tree');
    await core.mkdir('/tree/nested', { recursive: true });
    await core.writeFile('/tree/nested/file', 'payload');
    await core.symlink('/missing', '/tree/link');
    await core.symlink('/missing-nested', '/tree/nested/link');
    const tree = new ProjectTree({ walk: path => core.walk(path) });
    await tree.load('/');
    const events = [] as FsChangeEvent[];
    core.setChangeListener(event => events.push(event));
    const removeEntry = root.removeEntry.bind(root);
    vi.spyOn(root, 'removeEntry').mockImplementation(async (name, options) => {
      if (name === 'tree')
        throw new DOMException('Directory is busy', 'NoModificationAllowedError');
      return removeEntry(name, options);
    });

    await expect(core.rename('/tree', '/tmp/moved')).rejects.toMatchObject({ code: 'EIO' });
    expect(await core.readlink('/tree/link')).toBe('/missing');
    expect(await core.readlink('/tree/nested/link')).toBe('/missing-nested');
    expect(await core.readText('/tmp/moved/nested/file')).toBe('payload');
    expect(await core.readlink('/tmp/moved/link')).toBe('/missing');
    expect(await core.readlink('/tmp/moved/nested/link')).toBe('/missing-nested');
    expect(events.map(({ type, path, file }) => ({ type, path, fileType: file?.type }))).toEqual([
      { type: 'update', path: '/tree', fileType: 'folder' },
      { type: 'update', path: '/tree/link', fileType: 'symlink' },
      { type: 'update', path: '/tree/nested', fileType: 'folder' },
      { type: 'update', path: '/tree/nested/file', fileType: 'file' },
      { type: 'update', path: '/tree/nested/link', fileType: 'symlink' },
      { type: 'create', path: '/tmp/moved', fileType: 'folder' },
      { type: 'create', path: '/tmp/moved/link', fileType: 'symlink' },
      { type: 'create', path: '/tmp/moved/nested', fileType: 'folder' },
      { type: 'create', path: '/tmp/moved/nested/file', fileType: 'file' },
      { type: 'create', path: '/tmp/moved/nested/link', fileType: 'symlink' },
    ]);
    for (const event of events) await tree.change(event);
    const summarize = (entries: Awaited<ReturnType<FsCore['walk']>>) =>
      entries
        .map(({ path, type, size }) => ({ path, type, size }))
        .sort((left, right) => left.path.localeCompare(right.path));
    expect(summarize(tree.snapshot())).toEqual(summarize(await core.walk('/')));
    const next = new FsCore();
    await next.init(root);
    expect(await next.readlink('/tree/link')).toBe('/missing');
    expect(await next.readlink('/tree/nested/link')).toBe('/missing-nested');
  });

  it('deletes stale source subtree entries after partial directory removal fails', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/tree');
    await core.mkdir('/tree/nested');
    await core.writeFile('/tree/nested/file', 'payload');
    const tree = new ProjectTree({ walk: path => core.walk(path) });
    await tree.load('/');
    const events = [] as FsChangeEvent[];
    core.setChangeListener(event => events.push(event));
    const source = await root.getDirectoryHandle('tree');
    vi.spyOn(root, 'removeEntry').mockImplementationOnce(async () => {
      await source.removeEntry('nested', { recursive: true });
      throw new DOMException('Child removed before failure', 'NoModificationAllowedError');
    });

    await expect(core.rename('/tree', '/tmp/moved')).rejects.toMatchObject({ code: 'EIO' });

    expect(events.map(({ type, path }) => ({ type, path }))).toEqual([
      { type: 'update', path: '/tree' },
      { type: 'delete', path: '/tree/nested' },
      { type: 'create', path: '/tmp/moved' },
      { type: 'create', path: '/tmp/moved/nested' },
      { type: 'create', path: '/tmp/moved/nested/file' },
    ]);
    for (const event of events) await tree.change(event);
    const summarize = (entries: Awaited<ReturnType<FsCore['walk']>>) =>
      entries
        .map(({ path, type, size }) => ({ path, type, size }))
        .sort((left, right) => left.path.localeCompare(right.path));
    expect(summarize(tree.snapshot())).toEqual(summarize(await core.walk('/')));
  });

  it('restores only sidecars whose parent directory survives a partial removal', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/tree/nested', { recursive: true });
    await core.symlink('/root-target', '/tree/root-link');
    await core.mkfifo('/tree/root-pipe');
    await core.symlink('/nested-target', '/tree/nested/link');
    await core.mkfifo('/tree/nested/pipe');
    const tree = await root.getDirectoryHandle('tree');
    vi.spyOn(root, 'removeEntry').mockImplementationOnce(async () => {
      await tree.removeEntry('nested', { recursive: true });
      throw new DOMException('Child removed before failure', 'NoModificationAllowedError');
    });

    await expect(core.rm('/tree', { recursive: true })).rejects.toMatchObject({ code: 'EIO' });

    expect(await core.readlink('/tree/root-link')).toBe('/root-target');
    expect(await core.stat('/tree/root-pipe')).toMatchObject({ type: 'fifo' });
    expect(await core.exists('/tree/nested')).toBe(false);
    const next = new FsCore();
    await next.init(root);
    expect(await next.readlink('/tree/root-link')).toBe('/root-target');
    expect(await next.stat('/tree/root-pipe')).toMatchObject({ type: 'fifo' });
    await expect(next.lstat('/tree/nested/link')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(next.lstat('/tree/nested/pipe')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('notifies only removed descendants when recursive removal partially fails', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/tree/nested', { recursive: true });
    await core.writeFile('/tree/nested/removed', 'gone');
    await core.writeFile('/tree/nested/kept', 'kept');
    await core.writeFile('/tree/root-kept', 'kept');
    const tree = new ProjectTree({ walk: path => core.walk(path) });
    await tree.load('/');
    const events: FsChangeEvent[] = [];
    core.setChangeListener(event => events.push(event));
    const nested = await root
      .getDirectoryHandle('tree')
      .then(dir => dir.getDirectoryHandle('nested'));
    vi.spyOn(root, 'removeEntry').mockImplementationOnce(async () => {
      await nested.removeEntry('removed');
      throw new DOMException('Entry removed before failure', 'NoModificationAllowedError');
    });

    await expect(core.rm('/tree', { recursive: true })).rejects.toMatchObject({ code: 'EIO' });

    expect(events.map(({ type, path }) => ({ type, path }))).toEqual([
      { type: 'delete', path: '/tree/nested/removed' },
    ]);
    for (const event of events) await tree.change(event);
    const summarize = (entries: Awaited<ReturnType<FsCore['walk']>>) =>
      entries
        .map(({ path, type, size }) => ({ path, type, size }))
        .sort((left, right) => left.path.localeCompare(right.path));
    expect(summarize(tree.snapshot())).toEqual(summarize(await core.walk('/')));
  });

  it('does not restore source sidecars when directory removal commits then rejects', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/tree');
    await core.writeFile('/tree/file', 'payload');
    await core.symlink('/missing', '/tree/link');
    await core.mkfifo('/tree/pipe');
    const tree = new ProjectTree({ walk: path => core.walk(path) });
    await tree.load('/');
    const events = [] as FsChangeEvent[];
    core.setChangeListener(event => events.push(event));
    const removeEntry = root.removeEntry.bind(root);
    vi.spyOn(root, 'removeEntry').mockImplementationOnce(async (name, options) => {
      await removeEntry(name, options);
      throw new DOMException(
        'Directory was removed before rejection',
        'NoModificationAllowedError'
      );
    });

    await expect(core.rename('/tree', '/moved')).rejects.toMatchObject({ code: 'EIO' });

    expect(events.map(({ type, path, file }) => ({ type, path, fileType: file?.type }))).toEqual([
      { type: 'delete', path: '/tree', fileType: undefined },
      { type: 'create', path: '/moved', fileType: 'folder' },
      { type: 'create', path: '/moved/file', fileType: 'file' },
      { type: 'create', path: '/moved/link', fileType: 'symlink' },
      { type: 'create', path: '/moved/pipe', fileType: 'fifo' },
    ]);
    for (const event of events) await tree.change(event);
    const summarize = (entries: Awaited<ReturnType<FsCore['walk']>>) =>
      entries
        .map(({ path, type, size }) => ({ path, type, size }))
        .sort((left, right) => left.path.localeCompare(right.path));
    expect(summarize(tree.snapshot())).toEqual(summarize(await core.walk('/')));

    expect(await core.exists('/tree')).toBe(false);
    expect(await core.readText('/moved/file')).toBe('payload');
    expect(await core.readlink('/moved/link')).toBe('/missing');
    expect(await core.stat('/moved/pipe')).toMatchObject({ type: 'fifo' });
    const links = await root.getDirectoryHandle(LINK_STORAGE);
    const sourceLinkName = await sidecarName('/tree/link');
    const movedLinkName = await sidecarName('/moved/link');
    await expect(links.getFileHandle(sourceLinkName)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    await expect(links.getFileHandle(movedLinkName)).resolves.toBeDefined();
    const fifos = await root.getDirectoryHandle(FIFO_STORAGE);
    const sourceFifoName = await sidecarName('/tree/pipe');
    const movedFifoName = await sidecarName('/moved/pipe');
    await expect(fifos.getFileHandle(sourceFifoName)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    await expect(fifos.getFileHandle(movedFifoName)).resolves.toBeDefined();

    const next = new FsCore();
    await next.init(root);
    expect(await next.readText('/moved/file')).toBe('payload');
    expect(await next.readlink('/moved/link')).toBe('/missing');
    expect(await next.stat('/moved/pipe')).toMatchObject({ type: 'fifo' });
  });
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
      '/dev',
      '/home',
      '/tmp',
    ]);
    await expect(next.readlink('/home')).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('preserves volatile tmp links when the same core is initialized again', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.writeFile('/tmp/target', 'target');
    await core.symlink('/tmp/target', '/tmp/link');

    await core.init(root);

    expect(await core.readlink('/tmp/link')).toBe('/tmp/target');
    expect((await core.stat('/tmp/link')).path).toBe('/tmp/target');
    expect((await core.lstat('/tmp/link')).type).toBe('symlink');
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

async function sidecarName(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
