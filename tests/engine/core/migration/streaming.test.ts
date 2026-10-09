import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsApi } from '@/engine/core/fs';
import type { MigrationState } from '@/engine/core/migration/types';
import type { ProjectFile } from '@/types';

vi.mock('@/engine/core/migration/metadata', () => ({ migrateMetadata: vi.fn(async () => {}) }));
vi.mock('@/engine/core/coreLogger', () => ({ coreError: vi.fn() }));

import { migrateLegacyStorage } from '@/engine/core/migration';
import { openExisting, openState, readValue } from '@/engine/core/migration/idb';
import { migrateMetadata } from '@/engine/core/migration/metadata';

const databaseNames = ['PyxisStorageMigration', 'PyxisProjects', 'pyxis-fs', 'pyxis-fs_lock'];

interface LegacyStat {
  type: 'dir' | 'file';
  ino: number;
}

type LegacyNode = Map<string | number, LegacyNode | LegacyStat>;

function legacyNode(
  type: 'dir' | 'file',
  ino: number,
  children: [string, LegacyNode][] = []
): LegacyNode {
  const node: LegacyNode = new Map([[0, { type, ino }]]);
  for (const [name, child] of children) node.set(name, child);
  return node;
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function seedProjects(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('PyxisProjects', 1);
    request.onupgradeneeded = () => {
      for (const store of ['projects', 'files', 'chatSpaces', 'runtimeCache']) {
        request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['projects', 'files', 'runtimeCache'], 'readwrite');
    transaction.objectStore('projects').put({ id: 'p1', name: 'streaming' }, 'p1');
    transaction
      .objectStore('files')
      .put({ id: 'f1', projectId: 'p1', path: '/first.txt', type: 'file', content: 'first' }, 'f1');
    transaction
      .objectStore('files')
      .put(
        { id: 'f2', projectId: 'p1', path: '/second.txt', type: 'file', content: 'second' },
        'f2'
      );
    transaction.objectStore('runtimeCache').put(
      {
        key: 'global:/cache/cache.bin',
        value: new Uint8Array([7, 0, 255]).buffer,
        mtime: 0,
        isDir: false,
      },
      'cache'
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function seedGit(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pyxis-fs', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pyxis-fs_files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const objects = legacyNode('dir', 5, [['history', legacyNode('file', 6)]]);
  const git = legacyNode('dir', 3, [
    ['HEAD', legacyNode('file', 4)],
    ['objects', objects],
  ]);
  const project = legacyNode('dir', 2, [['.git', git]]);
  const projects = legacyNode('dir', 1, [['streaming', project]]);
  const superblock: LegacyNode = new Map([['/', legacyNode('dir', 0, [['projects', projects]])]]);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('pyxis-fs_files', 'readwrite');
    transaction.objectStore('pyxis-fs_files').put(superblock, '!root');
    transaction.objectStore('pyxis-fs_files').put(new Uint8Array([65, 0, 255]).buffer, 4);
    transaction.objectStore('pyxis-fs_files').put(new Uint8Array([91, 0, 254]).buffer, 6);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function memoryFs(): FsApi & { bytes: Map<string, Uint8Array>; corruptPath: string } {
  const bytes = new Map<string, Uint8Array>();
  const directories = new Set<string>(['/']);
  const stat = async (path: string): Promise<ProjectFile> => {
    if (directories.has(path)) return { path, type: 'folder', size: 0, mtime: 0 };
    const value = bytes.get(path);
    if (!value) throw new Error(`Missing path: ${path}`);
    return { path, type: 'file', size: value.length, mtime: 0 };
  };
  const fs: FsApi & { bytes: Map<string, Uint8Array>; corruptPath: string } = {
    bytes,
    corruptPath: '',
    async exists(path: string) {
      return bytes.has(path) || directories.has(path);
    },
    async mkdir(path: string) {
      let current = '';
      for (const part of path.split('/').filter(Boolean)) {
        current += `/${part}`;
        directories.add(current);
      }
    },
    async writeFile(path: string, value: string | Uint8Array) {
      let content: Uint8Array;
      if (typeof value === 'string') content = new TextEncoder().encode(value);
      else content = value.slice();
      bytes.set(path, content);
    },
    async readFile(path: string) {
      const value = bytes.get(path);
      if (!value) throw new Error(`Missing file: ${path}`);
      if (path === fs.corruptPath) return new Uint8Array([0]);
      return value.slice();
    },
    async readText(path: string) {
      return new TextDecoder().decode(await fs.readFile(path));
    },
    async stat(path: string): Promise<ProjectFile> {
      return stat(path);
    },
    async lstat(path: string) {
      return stat(path);
    },
    async realpath(path: string) {
      return path;
    },
    async readlink() {
      throw new Error('Not a symlink');
    },
    async symlink() {
      throw new Error('Symlinks are not supported by this fixture');
    },
    async rm(path: string) {
      bytes.delete(path);
      directories.delete(path);
    },
    async rename(oldPath: string, newPath: string) {
      const value = bytes.get(oldPath);
      if (!value) throw new Error(`Missing file: ${oldPath}`);
      bytes.set(newPath, value);
      bytes.delete(oldPath);
    },
    async walk(root: string) {
      return [...bytes.keys()]
        .filter(path => path.startsWith(`${root}/`))
        .map(path => ({ path, type: 'file' as const, size: bytes.get(path)!.length, mtime: 0 }));
    },
    async readdir(root: string) {
      return (await fs.walk(root)).filter(file => !file.path.slice(root.length + 1).includes('/'));
    },
  };
  return fs;
}

describe('streaming legacy migration', () => {
  beforeEach(async () => {
    for (const name of databaseNames) await deleteDatabase(name);
    vi.clearAllMocks();
  });

  it('retains sources and its mapped root after a later record fails verification, then retries', async () => {
    await seedProjects();
    await seedGit();
    const fs = memoryFs();
    fs.corruptPath = '/home/pyxis/streaming/.git/objects/history';

    await expect(migrateLegacyStorage(fs)).rejects.toThrow('byte verification failed');
    expect(await fs.exists('/home/pyxis/streaming/first.txt')).toBe(true);
    expect(await fs.exists('/home/pyxis/streaming/second.txt')).toBe(true);
    expect(await fs.exists('/home/pyxis/streaming/.git/HEAD')).toBe(true);
    expect(await fs.exists('/home/pyxis/streaming/.git/objects/history')).toBe(true);
    expect(migrateMetadata).not.toHaveBeenCalled();
    const stateDb = await openState();
    expect(
      (await readValue<MigrationState>(stateDb, 'state', 'opfs-v1'))?.mappings[0].rootPath
    ).toBe('/home/pyxis/streaming');
    stateDb.close();
    const source = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('PyxisProjects');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(source.objectStoreNames.contains('files')).toBe(true);
    source.close();
    const gitSource = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pyxis-fs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(
      await new Promise<number>((resolve, reject) => {
        const request = gitSource
          .transaction('pyxis-fs_files')
          .objectStore('pyxis-fs_files')
          .count(4);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
    ).toBe(1);
    gitSource.close();
    const cacheSource = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('PyxisProjects');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(
      await new Promise<number>((resolve, reject) => {
        const request = cacheSource.transaction('runtimeCache').objectStore('runtimeCache').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
    ).toBe(1);
    cacheSource.close();

    fs.corruptPath = '';
    await migrateLegacyStorage(fs);
    expect(await fs.readText('/home/pyxis/streaming/first.txt')).toBe('first');
    expect(await fs.readText('/home/pyxis/streaming/second.txt')).toBe('second');
    expect(await fs.readFile('/home/pyxis/streaming/.git/HEAD')).toEqual(
      new Uint8Array([65, 0, 255])
    );
    expect(await fs.readFile('/home/pyxis/streaming/.git/objects/history')).toEqual(
      new Uint8Array([91, 0, 254])
    );
    expect(await fs.readFile('/home/pyxis/.cache/pyxis/legacy/global/cache.bin')).toEqual(
      new Uint8Array([7, 0, 255])
    );
    expect(migrateMetadata).toHaveBeenCalledTimes(1);
    const completedStateDb = await openState();
    expect(
      (await readValue<MigrationState>(completedStateDb, 'state', 'opfs-v1'))?.mappings[0].rootPath
    ).toBe('/home/pyxis/streaming');
    completedStateDb.close();
    expect(await openExisting('PyxisProjects')).toBeNull();
  });
});
