import { describe, expect, it, vi } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { NPM_CACHE_PATH, RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
import type { FsChangeEvent } from '@/engine/core/fs/types';
import { HOME_DIR } from '@/engine/core/pathUtils';
import { directoryTree, storage } from '../../../_helpers/opfs';

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
    expect((await core.readdir('/')).map(entry => entry.path)).toEqual(['/cache', '/home', '/tmp']);
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
    await core.rm('/parent', { recursive: true });
    await core.mkdir('/parent/child', { recursive: true });
    release();
    await pending;
    await expect(core.stat('/parent/child/file')).rejects.toMatchObject({ code: 'ENOENT' });
    await core.writeFile('/parent/child/file', 'new');
    expect(await core.readText('/parent/child/file')).toBe('new');
  });
});

describe('OPFS access handle lifecycle', () => {
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
      expect(backing.access.close).toHaveBeenCalledOnce();
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

  it('closes reads and writes and truncates shorter replacements', async () => {
    const backing = storage(new Uint8Array([1, 2, 3, 4]));
    const core = new FsCore();
    await core.init(backing.root);
    expect(await core.readFile('/file')).toEqual(new Uint8Array([1, 2, 3, 4]));
    await core.writeFile('/file', new Uint8Array([9]));
    expect(backing.bytes()).toEqual(new Uint8Array([9]));
    expect(backing.access.truncate).toHaveBeenCalledWith(1);
    expect(backing.access.flush).toHaveBeenCalledOnce();
    expect(backing.access.close).toHaveBeenCalledTimes(2);
  });

  it('preserves subviews and loops over partial access-handle reads and writes', async () => {
    const backing = storage(new Uint8Array());
    const core = new FsCore();
    await core.init(backing.root);

    const source = new Uint8Array([99, 1, 2, 3, 88]);
    await core.writeFile('/file', source.subarray(1, 4));
    expect(backing.bytes()).toEqual(new Uint8Array([1, 2, 3]));

    const fullWrite = backing.access.write.getMockImplementation();
    if (!fullWrite) throw new Error('The OPFS write mock has no implementation.');
    backing.access.write.mockImplementation((bytes, { at }) =>
      fullWrite(bytes.subarray(0, 2), { at })
    );
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
    backing.access.write.mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    await expect(core.writeFile('/file', 'x')).rejects.toThrow('write failed');
    expect(backing.access.close).toHaveBeenCalledTimes(2);
    expect(await core.readFile('/file')).toEqual(new Uint8Array([1]));
  });

  it('translates access handle quota failures and closes acquired handles', async () => {
    const backing = storage(new Uint8Array([1]));
    const core = new FsCore();
    await core.init(backing.root);
    backing.access.flush.mockImplementationOnce(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    });
    await expect(core.writeFile('/file', 'x')).rejects.toMatchObject({
      code: 'ENOSPC',
      path: '/file',
    });
    expect(backing.access.close).toHaveBeenCalledOnce();
    backing.file.createSyncAccessHandle.mockRejectedValueOnce(
      new DOMException('Storage quota exceeded', 'QuotaExceededError')
    );
    await expect(core.readFile('/file')).rejects.toMatchObject({
      code: 'ENOSPC',
      path: '/file',
    });
    expect(backing.access.close).toHaveBeenCalledOnce();
  });
});
