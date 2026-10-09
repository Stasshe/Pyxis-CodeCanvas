import { describe, expect, it, vi } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import type { PermissionStore } from '@/engine/core/fs/permissions';
import { defaultMode, IndexedDbPermissionStore } from '@/engine/core/fs/permissions';
import type { ProjectFile } from '@/types';
import { directoryTree } from '../../../_helpers/opfs';

class MemoryPermissions implements PermissionStore {
  readonly entries = new Map<string, number>();
  failMove = false;
  failRemove = false;

  async get(path: string): Promise<number | undefined> {
    return this.entries.get(path);
  }

  async set(path: string, mode: number): Promise<void> {
    this.entries.set(path, mode);
  }

  async remove(paths: string[]): Promise<void> {
    if (this.failRemove) {
      this.failRemove = false;
      throw new Error('IDB transaction aborted');
    }
    for (const path of paths) this.entries.delete(path);
  }

  async move(source: string, destination: string): Promise<void> {
    if (this.failMove) {
      this.failMove = false;
      throw new Error('IDB transaction aborted');
    }
    const moving = [...this.entries].filter(
      ([path]) => path === source || path.startsWith(`${source}/`)
    );
    for (const path of [...this.entries.keys()]) {
      if (path === destination || path.startsWith(`${destination}/`)) this.entries.delete(path);
    }
    for (const [path, mode] of moving) {
      this.entries.delete(path);
      this.entries.set(`${destination}${path.slice(source.length)}`, mode);
    }
  }
}

class AbortingMovePermissions implements PermissionStore {
  private readonly store = new IndexedDbPermissionStore();

  get(path: string): Promise<number | undefined> {
    return this.store.get(path);
  }

  set(path: string, mode: number): Promise<void> {
    return this.store.set(path, mode);
  }

  remove(paths: string[]): Promise<void> {
    return this.store.remove(paths);
  }

  async move(source: string, destination: string): Promise<void> {
    const transaction = IDBDatabase.prototype.transaction;
    const transactionSpy = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(function (name, mode, options) {
        const result = transaction.call(this, name, mode, options);
        if (this.name === 'PyxisFsMetadata' && mode === 'readwrite') {
          queueMicrotask(() => result.abort());
        }
        return result;
      });
    try {
      await this.store.move(source, destination);
    } finally {
      transactionSpy.mockRestore();
    }
  }
}

describe('filesystem permissions', () => {
  it('replaces an asymmetric destination subtree when moving stored modes', async () => {
    const permissions = new IndexedDbPermissionStore();
    const paths = [
      '/cursor-destination',
      '/cursor-destination/middle',
      '/cursor-destination/zulu-stale',
      '/cursor-destination/zulu-transferred',
      '/cursor-source',
      '/cursor-source/zulu-transferred',
      '/cursor-source/\uffff-tail',
      '/cursor-destination/\uffff-tail',
    ];
    await permissions.remove(paths);
    await permissions.set('/cursor-destination', 0o700);
    await permissions.set('/cursor-destination/middle', 0o711);
    await permissions.set('/cursor-source', 0o600);
    await permissions.set('/cursor-destination/zulu-stale', 0o777);
    await permissions.set('/cursor-source/zulu-transferred', 0o640);
    await permissions.set('/cursor-source/\uffff-tail', 0o620);

    await permissions.move('/cursor-source', '/cursor-destination');

    expect(await permissions.get('/cursor-source')).toBeUndefined();
    expect(await permissions.get('/cursor-source/zulu-transferred')).toBeUndefined();
    expect(await permissions.get('/cursor-source/\uffff-tail')).toBeUndefined();
    expect(await permissions.get('/cursor-destination')).toBe(0o600);
    expect(await permissions.get('/cursor-destination/middle')).toBeUndefined();
    expect(await permissions.get('/cursor-destination/zulu-stale')).toBeUndefined();
    expect(await permissions.get('/cursor-destination/zulu-transferred')).toBe(0o640);
    expect(await permissions.get('/cursor-destination/\uffff-tail')).toBe(0o620);
    await permissions.remove(paths);
  });

  it('persists st_mode through stat, listings, Git, and core restart', async () => {
    const root = directoryTree();
    const permissions = new IndexedDbPermissionStore();
    const paths = [
      '/mode-check',
      '/mode-check/run',
      '/mode-check/range',
      '/moved-check',
      '/moved-check/run',
      '/mode-check-sibling',
      '/mode-check-sibling/file',
    ];
    await permissions.remove(paths);
    const core = new FsCore(permissions);
    await core.init(root);
    await core.mkdir(paths[0], { mode: 0o700 });
    await core.writeFile(paths[1], 'run', { mode: 0o4750 });
    await core.writeRange(paths[2], new Uint8Array([1]), null, true, false, 0o640);
    await core.mkdir('/mode-check-sibling');
    await core.writeFile('/mode-check-sibling/file', 'sibling', { mode: 0o777 });

    expect((await core.stat(paths[0])).mode).toBe(0o040700);
    expect((await core.readdir(paths[0])).find(entry => entry.path === paths[1])?.mode).toBe(
      0o104750
    );
    expect((await core.walk(paths[0])).find(entry => entry.path === paths[1])?.mode).toBe(0o104750);
    expect((await core.stat(paths[2])).mode).toBe(0o100640);
    expect((await createGitFs(core).promises.stat(paths[1])).mode).toBe(0o104750);
    await core.rename('/mode-check', '/moved-check');
    expect((await core.stat('/moved-check/run')).mode).toBe(0o104750);
    expect((await core.stat('/mode-check-sibling/file')).mode).toBe(0o100777);

    const next = new FsCore(permissions);
    await next.init(root);
    expect((await next.stat('/moved-check/run')).mode).toBe(0o104750);
    await next.rm('/moved-check', { recursive: true });
    await next.rm('/mode-check-sibling', { recursive: true });
    await permissions.remove(paths);
  });

  it('preserves existing modes on writes and recursive mkdir, and chmod follows links', async () => {
    const core = new FsCore(new IndexedDbPermissionStore());
    await core.init(directoryTree());
    await core.mkdir('/modes/nested', { recursive: true, mode: 0o700 });
    await core.writeFile('/modes/nested/file', 'one', { mode: 0o4750 });
    await core.symlink('/modes/nested/file', '/modes/link');

    await core.mkdir('/modes/nested', { recursive: true, mode: 0o777 });
    await core.writeFile('/modes/nested/file', 'two');
    expect((await core.stat('/modes/nested')).mode).toBe(0o040700);
    expect((await core.stat('/modes/nested/file')).mode).toBe(0o104750);

    const updates: ProjectFile[] = [];
    core.setChangeListener(event => {
      if (event.type === 'update' && event.file) updates.push(event.file);
    });
    await core.chmod('/modes/link', 0o640);
    expect((await core.stat('/modes/nested/file')).mode).toBe(0o100640);
    expect((await core.lstat('/modes/link')).mode).toBe(defaultMode('symlink'));
    expect(updates.at(-1)?.path).toBe('/modes/nested/file');
  });

  it('moves directory modes and retains file data if the metadata move aborts', async () => {
    const permissions = new AbortingMovePermissions();
    const core = new FsCore(permissions);
    await core.init(directoryTree());
    await core.mkdir('/source', { mode: 0o700 });
    await core.writeFile('/source/file', 'kept', { mode: 0o600 });
    const events: Array<{ path: string; type: string }> = [];
    core.setChangeListener(event => events.push({ path: event.path, type: event.type }));
    await expect(core.rename('/source', '/destination')).rejects.toThrow();
    expect(await core.exists('/source')).toBe(false);
    expect(await core.readText('/destination/file')).toBe('kept');
    expect((await core.stat('/destination')).mode).toBe(0o040700);
    expect((await core.stat('/destination/file')).mode).toBe(0o100600);
    expect(events).toEqual([
      { type: 'delete', path: '/source' },
      { type: 'create', path: '/destination' },
      { type: 'create', path: '/destination/file' },
    ]);
  });

  it('reconciles removed modes after partial recursive deletion', async () => {
    const root = directoryTree();
    const core = new FsCore(new IndexedDbPermissionStore());
    await core.init(root);
    await core.mkdir('/remove/nested', { recursive: true, mode: 0o700 });
    await core.writeFile('/remove/nested/file', 'gone', { mode: 0o600 });
    await core.writeFile('/remove/keep', 'keep', { mode: 0o640 });
    const directory = await root.getDirectoryHandle('remove');
    vi.spyOn(root, 'removeEntry').mockImplementationOnce(async () => {
      await directory.removeEntry('nested', { recursive: true });
      throw new DOMException('Partial deletion', 'NoModificationAllowedError');
    });

    await expect(core.rm('/remove', { recursive: true })).rejects.toMatchObject({ code: 'EIO' });
    expect(await core.readText('/remove/keep')).toBe('keep');
    expect((await core.stat('/remove/keep')).mode).toBe(0o100640);
    await core.mkdir('/remove/nested');
    await core.writeFile('/remove/nested/file', 'new');
    expect((await core.stat('/remove/nested/file')).mode).toBe(defaultMode('file'));
    await core.rm('/remove', { recursive: true });
    await new IndexedDbPermissionStore().remove([
      '/remove',
      '/remove/nested',
      '/remove/nested/file',
      '/remove/keep',
    ]);
  });

  it('propagates delete metadata abort and clears stale attrs on the next create', async () => {
    const permissions = new MemoryPermissions();
    const core = new FsCore(permissions);
    await core.init(directoryTree());
    await core.writeFile('/file', 'old', { mode: 0o600 });
    permissions.failRemove = true;

    await expect(core.rm('/file')).rejects.toThrow('IDB transaction aborted');
    expect(await core.exists('/file')).toBe(false);
    await core.writeFile('/file', 'new');
    expect((await core.stat('/file')).mode).toBe(defaultMode('file'));
  });

  it('keeps /tmp FIFO permissions in memory and rejects synthetic device changes', async () => {
    const permissions = new MemoryPermissions();
    const core = new FsCore(permissions);
    await core.init(directoryTree());
    await core.mkfifo('/tmp/channel');
    await core.chmod('/tmp/channel', 0o620);
    expect((await core.stat('/tmp/channel')).mode).toBe(0o010620);
    await core.mkfifo('/persistent-channel');
    await core.chmod('/persistent-channel', 0o620);
    expect((await core.stat('/persistent-channel')).mode).toBe(0o010620);
    await permissions.set('/fresh-link', 0o600);
    await core.symlink('/target', '/fresh-link');
    expect((await core.lstat('/fresh-link')).mode).toBe(defaultMode('symlink'));
    await permissions.set('/fresh-channel', 0o600);
    await core.mkfifo('/fresh-channel');
    expect((await core.stat('/fresh-channel')).mode).toBe(defaultMode('fifo'));
    await expect(core.chmod('/dev/null', 0o600)).rejects.toMatchObject({ code: 'EPERM' });
    await expect(core.chmod('/dev/fd/99', 0o600)).rejects.toMatchObject({ code: 'EPERM' });
  });

  it('moves modes across the persistent and /tmp mounts', async () => {
    const core = new FsCore(new MemoryPermissions());
    await core.init(directoryTree());
    await core.mkdir('/cross-mount', { mode: 0o700 });
    await core.writeFile('/cross-mount/file', 'bytes', { mode: 0o600 });
    await core.rename('/cross-mount', '/tmp/cross-mount');
    expect((await core.stat('/tmp/cross-mount')).mode).toBe(0o040700);
    expect((await core.stat('/tmp/cross-mount/file')).mode).toBe(0o100600);
    await core.rename('/tmp/cross-mount', '/restored-mount');
    expect((await core.stat('/restored-mount')).mode).toBe(0o040700);
    expect((await core.stat('/restored-mount/file')).mode).toBe(0o100600);

    await core.writeFile('/tmp/mode-source', 'source', { mode: 0o600 });
    await core.writeFile('/tmp/mode-destination', 'destination', { mode: 0o777 });
    await core.rename('/tmp/mode-source', '/tmp/mode-destination');
    expect((await core.stat('/tmp/mode-destination')).mode).toBe(0o100600);

    await core.writeFile('/persistent-mode-source', 'source', { mode: 0o600 });
    await core.writeFile('/tmp/persistent-mode-destination', 'destination', { mode: 0o777 });
    await core.rename('/persistent-mode-source', '/tmp/persistent-mode-destination');
    expect((await core.stat('/tmp/persistent-mode-destination')).mode).toBe(0o100600);

    await core.mkdir('/persistent-directory-source', { mode: 0o700 });
    await core.writeFile('/persistent-directory-source/file', 'source', { mode: 0o640 });
    await core.mkdir('/tmp/persistent-directory-destination', { mode: 0o777 });
    await core.rename('/persistent-directory-source', '/tmp/persistent-directory-destination');
    expect((await core.stat('/tmp/persistent-directory-destination')).mode).toBe(0o040700);
    expect((await core.stat('/tmp/persistent-directory-destination/file')).mode).toBe(0o100640);
  });
});
