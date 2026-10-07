import { describe, expect, it } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { NPM_CACHE_PATH, RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
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

describe('OPFS access handle lifecycle', () => {
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
