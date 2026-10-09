import { describe, expect, it, vi } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { NPM_CACHE_PATH, RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
import type { FsChangeEvent } from '@/engine/core/fs/types';
import { HOME_DIR } from '@/engine/core/pathUtils';
import { directoryTree, storage } from '../../../_helpers/opfs';

interface MovableFileHandle extends FileSystemFileHandle {
  move(destination: FileSystemDirectoryHandle | string, newName?: string): Promise<void>;
}

function movable(handle: FileSystemFileHandle): MovableFileHandle {
  return handle as MovableFileHandle;
}

describe('Linux filesystem layout', () => {
  it('initializes HOME and caches idempotently without replacing existing data', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    for (const path of [HOME_DIR, RUNTIME_CACHE_PATH, NPM_CACHE_PATH]) {
      expect(await core.stat(path)).toMatchObject({ path, type: 'folder' });
    }
    expect(await core.exists('/cache')).toBe(false);
    await core.writeFile(`${RUNTIME_CACHE_PATH}/entry`, 'cached');
    await core.mkdir('/cache');
    await core.writeFile('/cache/legacy', 'preserved');
    await core.init(root);
    expect(await core.readText(`${RUNTIME_CACHE_PATH}/entry`)).toBe('cached');
    expect(await core.readText('/cache/legacy')).toBe('preserved');
    expect((await core.readdir('/')).map(entry => entry.path)).toEqual([
      '/cache',
      '/dev',
      '/home',
      '/tmp',
    ]);
  });

  it('persists ordinary HOME tmp and cache folders while /tmp stays volatile', async () => {
    const root = directoryTree();
    const first = new FsCore();
    await first.init(root);
    for (const path of [`${HOME_DIR}/tmp`, `${HOME_DIR}/cache`]) {
      await first.mkdir(path);
      await first.writeFile(`${path}/entry`, path);
    }
    await first.writeFile('/tmp/entry', 'volatile');
    const next = new FsCore();
    await next.init(root);
    expect(await next.exists('/tmp/entry')).toBe(false);
    for (const path of [`${HOME_DIR}/tmp`, `${HOME_DIR}/cache`]) {
      expect(await next.readText(`${path}/entry`)).toBe(path);
    }
  });

  it('allows removing and renaming cache and HOME directories but protects mounts', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/cache');
    await core.rename('/cache', '/old-cache');
    await core.rename('/old-cache', '/cache');
    await core.rm('/cache', { recursive: true });
    await core.rm(HOME_DIR, { recursive: true });
    expect(await core.exists('/cache')).toBe(false);
    expect(await core.exists(HOME_DIR)).toBe(false);
    for (const path of ['/', '/tmp']) {
      await expect(core.rm(path, { recursive: true })).rejects.toMatchObject({ code: 'EBUSY' });
      await expect(core.rename(path, '/moved')).rejects.toMatchObject({ code: 'EBUSY' });
    }
  });
});

describe('OPFS directory handle reuse', () => {
  it('removes only a newly created destination after a failed directory copy', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/source');
    await core.mkdir('/source/0-nested');
    await core.writeFile('/source/a', 'first');
    await core.writeFile('/source/0-nested/file', 'nested');
    await core.writeFile('/source/b', 'second');
    const lookup = root.getDirectoryHandle.bind(root);
    const configured = new WeakSet<FileSystemDirectoryHandle>();
    vi.spyOn(root, 'getDirectoryHandle').mockImplementation(async (name, options) => {
      const directory = await lookup(name, options);
      if (name === 'destination' && !configured.has(directory)) {
        configured.add(directory);
        const fileLookup = directory.getFileHandle.bind(directory);
        vi.spyOn(directory, 'getFileHandle').mockImplementation(async (child, fileOptions) => {
          const handle = await fileLookup(child, fileOptions);
          if (child === 'b') {
            vi.spyOn(handle, 'createWritable').mockRejectedValue(new Error('copy failed'));
          }
          return handle;
        });
      }
      return directory;
    });
    await expect(core.rename('/source', '/destination')).rejects.toThrow('copy failed');
    expect(await core.exists('/destination')).toBe(false);
    expect(await core.readText('/source/a')).toBe('first');
    expect(await core.readText('/source/b')).toBe('second');
    await core.mkdir('/destination');
    await expect(core.rename('/source', '/destination')).rejects.toThrow('copy failed');
    expect((await core.stat('/destination')).type).toBe('folder');
    expect(await core.readdir('/destination')).toEqual([]);
  });
  it('reuses ancestors for sibling reads and alternating child directories', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/parent/left', { recursive: true });
    await core.mkdir('/parent/right');
    await core.writeFile('/parent/left/first', 'left');
    await core.writeFile('/parent/left/second', 'sibling');
    await core.writeFile('/parent/right/first', 'right');
    const parent = await root.getDirectoryHandle('parent');
    const rootLookup = vi.spyOn(root, 'getDirectoryHandle');
    const childLookup = vi.spyOn(parent, 'getDirectoryHandle');
    await core.readText('/parent/left/first');
    rootLookup.mockClear();
    childLookup.mockClear();
    expect(await core.readText('/parent/left/second')).toBe('sibling');
    expect(rootLookup).not.toHaveBeenCalled();
    expect(childLookup).not.toHaveBeenCalled();
    expect(await core.readText('/parent/right/first')).toBe('right');
    expect(await core.readText('/parent/left/first')).toBe('left');
    expect(rootLookup).not.toHaveBeenCalled();
    expect(childLookup.mock.calls.map(call => call[0])).toEqual(['right', 'left']);
  });

  it('drops removed and renamed directory handles before path recreation', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/parent/child', { recursive: true });
    await core.writeFile('/parent/child/file', 'original');
    await core.readText('/parent/child/file');
    await core.rename('/parent', '/moved');
    await core.mkdir('/parent/child', { recursive: true });
    await core.writeFile('/parent/child/file', 'replacement');
    expect(await core.readText('/parent/child/file')).toBe('replacement');
    expect(await core.readText('/moved/child/file')).toBe('original');
    await core.rm('/parent', { recursive: true });
    await core.mkdir('/parent/child', { recursive: true });
    await core.writeFile('/parent/child/file', 'recreated');
    expect(await core.readText('/parent/child/file')).toBe('recreated');
  });

  it('drops directory handles when initialized with a different root', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/parent');
    await core.writeFile('/parent/file', 'old');
    await core.readText('/parent/file');
    await core.init(directoryTree());
    await expect(core.readText('/parent/file')).rejects.toMatchObject({ code: 'ENOENT' });
    await core.mkdir('/parent');
    await core.writeFile('/parent/file', 'new');
    expect(await core.readText('/parent/file')).toBe('new');
  });

  it('does not publish an in-flight lookup after its directory is removed', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/parent/child', { recursive: true });
    await core.writeFile('/parent/child/file', 'old');
    const parent = await root.getDirectoryHandle('parent');
    const child = await parent.getDirectoryHandle('child');
    await expect(core.stat('/parent/missing')).rejects.toMatchObject({ code: 'ENOENT' });
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.spyOn(parent, 'getDirectoryHandle').mockImplementationOnce(async () => {
      started();
      await waiting;
      return child;
    });
    const pending = core.readText('/parent/child/file');
    await entered;
    const removal = core.rm('/parent', { recursive: true });
    release();
    await pending;
    await removal;
    await core.mkdir('/parent/child', { recursive: true });
    await expect(core.stat('/parent/child/file')).rejects.toMatchObject({ code: 'ENOENT' });
    await core.writeFile('/parent/child/file', 'new');
    expect(await core.readText('/parent/child/file')).toBe('new');
  });
});

describe('OPFS native file moves', () => {
  it('moves a persistent file across directories', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/case/source-dir', { recursive: true });
    await core.mkdir('/case/destination-dir');
    await core.writeFile('/case/source-dir/source', 'source bytes');

    await core.rename('/case/source-dir/source', '/case/destination-dir/destination');

    expect(await core.exists('/case/source-dir/source')).toBe(false);
    expect(await core.readText('/case/destination-dir/destination')).toBe('source bytes');
    expect((await core.readdir('/case/destination-dir')).map(entry => entry.path)).toEqual([
      '/case/destination-dir/destination',
    ]);
  });

  it.each([false, true])('moves a persistent file with destination present=%s', async existing => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/case');
    await core.writeFile('/case/source', 'source bytes');
    if (existing) await core.writeFile('/case/destination', 'old bytes');
    const directory = await root.getDirectoryHandle('case');
    const source = movable(await directory.getFileHandle('source'));
    vi.spyOn(source, 'getFile').mockResolvedValue(
      new File(['source bytes'], 'source', { lastModified: 1234 })
    );
    const sourceMtime = (await core.stat('/case/source')).mtime;
    const move = vi.spyOn(source, 'move');
    const removeEntry = vi.spyOn(directory, 'removeEntry');
    const events: FsChangeEvent[] = [];
    core.setChangeListener(event => events.push(event));

    await core.rename('/case/source', '/case/destination');

    expect(move).toHaveBeenCalled();
    expect(removeEntry).not.toHaveBeenCalled();
    expect(await core.exists('/case/source')).toBe(false);
    expect(await core.readText('/case/destination')).toBe('source bytes');
    expect((await core.stat('/case/destination')).mtime).toBe(sourceMtime);
    expect(events.at(-1)).toMatchObject({
      type: 'rename',
      oldPath: '/case/source',
      path: '/case/destination',
      file: { path: '/case/destination', type: 'file', size: 12 },
    });
    expect(await core.readdir('/case')).toEqual([
      expect.objectContaining({ path: '/case/destination', type: 'file' }),
    ]);
  });

  it.each([false, true])(
    'preserves the source and existing destination when native move fails (destination present=%s)',
    async existing => {
      const root = directoryTree();
      const core = new FsCore();
      await core.init(root);
      await core.mkdir('/case');
      await core.writeFile('/case/source', 'source bytes');
      if (existing) await core.writeFile('/case/destination', 'old bytes');
      const directory = await root.getDirectoryHandle('case');
      const source = movable(await directory.getFileHandle('source'));
      vi.spyOn(source, 'move').mockRejectedValue(
        new DOMException('Move failed', 'NoModificationAllowedError')
      );

      await expect(core.rename('/case/source', '/case/destination')).rejects.toMatchObject({
        code: 'EIO',
        path: '/case/destination',
      });

      expect(await core.readText('/case/source')).toBe('source bytes');
      if (existing) expect(await core.readText('/case/destination')).toBe('old bytes');
      else expect(await core.exists('/case/destination')).toBe(false);
      expect((await core.readdir('/case')).map(entry => entry.path).sort()).toEqual(
        existing ? ['/case/destination', '/case/source'] : ['/case/source']
      );
    }
  );

  it('fails explicitly when the OPFS file handle does not support move', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.mkdir('/case');
    await core.writeFile('/case/source', 'source bytes');
    const directory = await root.getDirectoryHandle('case');
    const source = await directory.getFileHandle('source');
    Reflect.deleteProperty(source, 'move');

    await expect(core.rename('/case/source', '/case/destination')).rejects.toMatchObject({
      code: 'ENOTSUP',
      path: '/case/source',
    });

    expect(await core.readText('/case/source')).toBe('source bytes');
    expect(await core.exists('/case/destination')).toBe(false);
  });

  it('restores an existing /tmp destination when removing the persistent source fails', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.writeFile('/source', 'source bytes');
    await core.writeFile('/tmp/destination', 'old bytes');
    vi.spyOn(root, 'removeEntry').mockRejectedValueOnce(new Error('source removal failed'));

    await expect(core.rename('/source', '/tmp/destination')).rejects.toThrow(
      'source removal failed'
    );

    expect(await core.readText('/source')).toBe('source bytes');
    expect(await core.readText('/tmp/destination')).toBe('old bytes');
  });

  it.each([false, true])(
    'keeps the /tmp copy when source removal and source restoration fail (destination present=%s)',
    async existing => {
      const root = directoryTree();
      const core = new FsCore();
      await core.init(root);
      await core.writeFile('/source', 'source bytes');
      if (existing) await core.writeFile('/tmp/destination', 'old bytes');
      const removeEntry = root.removeEntry.bind(root);
      vi.spyOn(root, 'removeEntry').mockImplementationOnce(async (name, options) => {
        await removeEntry(name, options);
        throw new Error('source removed, then cleanup failed');
      });
      const getFileHandle = root.getFileHandle.bind(root);
      vi.spyOn(root, 'getFileHandle').mockImplementation(async (name, options) => {
        const handle = await getFileHandle(name, options);
        if (name === 'source' && options?.create) {
          vi.spyOn(handle, 'createWritable').mockRejectedValueOnce(
            new Error('source restore failed')
          );
        }
        return handle;
      });

      await expect(core.rename('/source', '/tmp/destination')).rejects.toThrow(
        'Failed to restore /source'
      );

      expect(await core.exists('/source')).toBe(false);
      expect(await core.readText('/tmp/destination')).toBe('source bytes');
    }
  );
});

describe('OPFS access handle lifecycle', () => {
  it.each(['remove', 'rename'])('waits for an active writer before %s', async operation => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.writeFile('/file', 'original');
    const handle = await root.getFileHandle('file');
    const writer = await handle.createWritable();
    const commit = writer.close.bind(writer);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    vi.spyOn(writer, 'close').mockImplementationOnce(async () => {
      entered();
      await waiting;
      await commit();
    });
    const writing = core.writeFile('/file', 'replacement');
    await started;
    let finished = false;
    let mutation: Promise<void>;
    if (operation === 'remove') mutation = core.rm('/file');
    else mutation = core.rename('/file', '/moved');
    const tracked = mutation.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await writing;
    await tracked;
    expect(await core.exists('/file')).toBe(false);
    if (operation === 'rename') expect(await core.readText('/moved')).toBe('replacement');
    await core.writeFile('/unrelated', 'ready');
    expect(await core.readText('/unrelated')).toBe('ready');
  });

  it('serializes alias writes while unrelated paths continue', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    await core.writeFile('/file', 'original');
    await core.symlink('/file', '/alias');
    const handle = await root.getFileHandle('file');
    const writer = await handle.createWritable();
    const commit = writer.close.bind(writer);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    vi.spyOn(writer, 'close').mockImplementationOnce(async () => {
      entered();
      await waiting;
      await commit();
    });
    const first = core.writeFile('/alias', 'first');
    await started;
    const second = core.writeFile('/file', 'second');
    await core.writeFile('/unrelated', 'independent');
    expect(await core.readText('/unrelated')).toBe('independent');
    release();
    await Promise.all([first, second]);
    expect(await core.readText('/alias')).toBe('second');
  });
  it('keeps committed bytes when a staged write fails after accepting data', async () => {
    const original = new TextEncoder().encode('original complete content');
    const backing = storage(original);
    const core = new FsCore();
    await core.init(backing.root);
    const events: FsChangeEvent[] = [];
    core.setChangeListener(event => events.push(event));
    const stage = backing.writable.write.getMockImplementation();
    if (!stage) throw new Error('Missing writable staging implementation');
    backing.writable.write.mockImplementationOnce(async bytes => {
      await stage(bytes);
      expect(backing.bytes()).toEqual(original);
      throw new DOMException('Quota exceeded after partial staging', 'QuotaExceededError');
    });
    await expect(core.writeFile('/file', 'replacement')).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(backing.bytes()).toEqual(original);
    expect(backing.writable.abort).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
    await core.writeFile('/file', 'next');
    expect(await core.readText('/file')).toBe('next');
  });

  it('removes a newly created file if staging cannot be committed', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    const lookup = root.getFileHandle.bind(root);
    vi.spyOn(root, 'getFileHandle').mockImplementation(async (name, options) => {
      const handle = await lookup(name, options);
      if (name === 'new-file') {
        vi.spyOn(handle, 'createWritable').mockRejectedValueOnce(
          new DOMException('Quota exceeded', 'QuotaExceededError')
        );
      }
      return handle;
    });
    await expect(core.writeFile('/new-file', 'payload')).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await core.exists('/new-file')).toBe(false);
  });

  it('serializes creation, replacement and committed event metadata for the same path', async () => {
    const root = directoryTree();
    const core = new FsCore();
    await core.init(root);
    const events: FsChangeEvent[] = [];
    core.setChangeListener(event => events.push(event));
    const lookup = root.getFileHandle.bind(root);
    let configured = false;
    vi.spyOn(root, 'getFileHandle').mockImplementation(async (name, options) => {
      const handle = await lookup(name, options);
      if (name === 'file' && !configured) {
        configured = true;
        const read = handle.getFile.bind(handle);
        let mtime = 1234;
        vi.spyOn(handle, 'getFile').mockImplementation(async () => {
          const file = await read();
          const result = new File([await file.arrayBuffer()], 'file', { lastModified: mtime });
          mtime = 5678;
          return result;
        });
      }
      return handle;
    });

    await Promise.all([core.writeFile('/file', 'first'), core.writeFile('/file', 'x')]);

    expect(events).toEqual([
      {
        type: 'create',
        path: '/file',
        file: { path: '/file', type: 'file', size: 5, mtime: 1234 },
      },
      {
        type: 'update',
        path: '/file',
        file: { path: '/file', type: 'file', size: 1, mtime: 5678 },
      },
    ]);
    expect(await core.readText('/file')).toBe('x');
  });

  it('writes through a dangling link and preserves directory path errors', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    await core.mkdir('/directory');
    await core.symlink('/directory/file', '/link');
    const events: FsChangeEvent[] = [];
    core.setChangeListener(event => events.push(event));

    await core.writeFile('/link', 'payload');
    expect(await core.readText('/directory/file')).toBe('payload');
    expect(await core.readlink('/link')).toBe('/directory/file');
    expect(events).toEqual([
      {
        type: 'create',
        path: '/directory/file',
        file: expect.objectContaining({ path: '/directory/file', type: 'file', size: 7 }),
      },
    ]);
    events.length = 0;
    await expect(core.writeFile('/link/', 'x')).rejects.toMatchObject({ code: 'ENOTDIR' });
    await expect(core.writeFile('/directory', 'x')).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(core.writeFile('/missing/file', 'x')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events).toEqual([]);
    expect(await core.readText('/directory/file')).toBe('payload');
  });

  it('closes before event metadata and releases the queue after metadata failure', async () => {
    const backing = storage(new Uint8Array([1]));
    const core = new FsCore();
    await core.init(backing.root);
    const events: FsChangeEvent[] = [];
    core.setChangeListener(event => events.push(event));
    const metadata = backing.file.getFile.bind(backing.file);
    vi.spyOn(backing.file, 'getFile').mockImplementationOnce(async () => {
      expect(backing.writable.close).toHaveBeenCalledOnce();
      throw new Error('metadata failed');
    });

    await expect(core.writeFile('/file', 'first')).rejects.toThrow('metadata failed');
    expect(events).toEqual([]);
    await core.writeFile('/file', 'next');
    const file = await metadata();
    expect(events).toEqual([
      {
        type: 'update',
        path: '/file',
        file: expect.objectContaining({ path: '/file', type: 'file', size: file.size }),
      },
    ]);
    expect(await core.readText('/file')).toBe('next');
  });

  it('closes reads and atomically commits shorter replacements', async () => {
    const backing = storage(new Uint8Array([1, 2, 3, 4]));
    const core = new FsCore();
    await core.init(backing.root);
    expect(await core.readFile('/file')).toEqual(new Uint8Array([1, 2, 3, 4]));
    await core.writeFile('/file', new Uint8Array([9]));
    expect(backing.bytes()).toEqual(new Uint8Array([9]));
    expect(backing.writable.close).toHaveBeenCalledOnce();
    expect(backing.access.write).not.toHaveBeenCalled();
    expect(backing.access.close).toHaveBeenCalledOnce();
  });

  it('preserves subviews and loops over partial access-handle reads', async () => {
    const backing = storage(new Uint8Array());
    const core = new FsCore();
    await core.init(backing.root);

    const source = new Uint8Array([99, 1, 2, 3, 88]);
    await core.writeFile('/file', source.subarray(1, 4));
    expect(backing.bytes()).toEqual(new Uint8Array([1, 2, 3]));

    const replacement = new Uint8Array([9, 8, 7, 6, 5]);
    await core.writeFile('/file', replacement);
    expect(backing.bytes()).toEqual(replacement);

    const stored = backing.bytes();
    backing.access.read.mockImplementation((target, { at }) => {
      const chunk = stored.subarray(at, at + Math.min(target.length, 2));
      target.set(chunk);
      return chunk.length;
    });
    expect(await core.readFile('/file')).toEqual(replacement);
  });

  it('closes the handle after read or write failure and allows later operations', async () => {
    const backing = storage(new Uint8Array([1]));
    const core = new FsCore();
    await core.init(backing.root);
    backing.access.read.mockImplementationOnce(() => {
      throw new Error('read failed');
    });
    await expect(core.readFile('/file')).rejects.toThrow('read failed');
    backing.writable.write.mockRejectedValueOnce(new Error('write failed'));
    await expect(core.writeFile('/file', 'x')).rejects.toThrow('write failed');
    expect(backing.access.close).toHaveBeenCalledOnce();
    expect(backing.writable.abort).toHaveBeenCalledOnce();
    expect(await core.readFile('/file')).toEqual(new Uint8Array([1]));
  });

  it('translates staging quota failures and closes acquired read handles', async () => {
    const backing = storage(new Uint8Array([1]));
    const core = new FsCore();
    await core.init(backing.root);
    backing.writable.close.mockRejectedValueOnce(
      new DOMException('Storage quota exceeded', 'QuotaExceededError')
    );
    await expect(core.writeFile('/file', 'x')).rejects.toMatchObject({
      code: 'ENOSPC',
      path: '/file',
    });
    expect(backing.access.close).not.toHaveBeenCalled();
    expect(backing.writable.abort).toHaveBeenCalledOnce();
    expect(backing.bytes()).toEqual(new Uint8Array([1]));
    backing.file.createSyncAccessHandle.mockRejectedValueOnce(
      new DOMException('Storage quota exceeded', 'QuotaExceededError')
    );
    await expect(core.readFile('/file')).rejects.toMatchObject({
      code: 'ENOSPC',
      path: '/file',
    });
    expect(backing.access.close).not.toHaveBeenCalled();
  });
});
