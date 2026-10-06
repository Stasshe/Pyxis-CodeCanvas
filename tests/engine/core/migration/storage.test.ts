import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsApi } from '@/engine/core/fs';
import type {
  LegacyCache,
  LegacyFile,
  LegacyProject,
  MigrationState,
} from '@/engine/core/migration/types';
import type { ProjectFile } from '@/types';

const fixture = vi.hoisted(() => ({
  projects: [] as LegacyProject[],
  files: [] as LegacyFile[],
  caches: [] as LegacyCache[],
  state: undefined as MigrationState | undefined,
  deleted: [] as string[],
  failDelete: '',
  close: vi.fn(),
}));

vi.mock('@/engine/core/migration/idb', () => ({
  openState: async () => ({ close: fixture.close }),
  openExisting: async () => ({ close: fixture.close }),
  readValue: async () => structuredClone(fixture.state),
  writeValue: async (_db: IDBDatabase, _store: string, state: MigrationState) => {
    fixture.state = structuredClone(state);
  },
  readAll: async (_db: IDBDatabase, store: string) => {
    if (store === 'projects') return fixture.projects;
    if (store === 'files') return fixture.files;
    if (store === 'runtimeCache') return fixture.caches;
    return [];
  },
  deleteDatabase: async (name: string) => {
    if (fixture.failDelete === name) throw new Error('blocked');
    fixture.deleted.push(name);
  },
}));

vi.mock('@/engine/core/migration/metadata', () => ({ migrateMetadata: vi.fn(async () => {}) }));
vi.mock('@/engine/core/coreLogger', () => ({ coreError: vi.fn() }));
vi.mock('@/engine/core/migration/lightning', () => ({
  gitProjectNames: vi.fn(async () => ['tmp']),
  readGitEntries: vi.fn(async () => [
    { path: '/.git', directory: true },
    { path: '/.git/objects', directory: true },
    { path: '/.git/objects/history', directory: false, bytes: new Uint8Array([0, 255, 3]) },
  ]),
}));

import { migrateLegacyStorage } from '@/engine/core/migration';
import { migrateMetadata } from '@/engine/core/migration/metadata';

function memoryFs(): FsApi & { entries: Map<string, Uint8Array | null>; corrupt: boolean } {
  const entries = new Map<string, Uint8Array | null>([['/', null]]);
  const fs = {
    entries,
    corrupt: false,
    async exists(path: string) {
      return entries.has(path);
    },
    async mkdir(path: string) {
      const parts = path.split('/').filter(Boolean);
      let parent = '';
      for (const part of parts) {
        parent += `/${part}`;
        if (!entries.has(parent)) entries.set(parent, null);
      }
    },
    async writeFile(path: string, data: string | Uint8Array) {
      let bytes: Uint8Array;
      if (typeof data === 'string') bytes = new TextEncoder().encode(data);
      else bytes = data.slice();
      entries.set(path, bytes);
    },
    async readFile(path: string) {
      const bytes = entries.get(path);
      if (!bytes) throw new Error(`Missing file: ${path}`);
      if (fs.corrupt) return new Uint8Array([123]);
      return bytes.slice();
    },
    async readText(path: string) {
      return new TextDecoder().decode(await fs.readFile(path));
    },
    async stat(path: string): Promise<ProjectFile> {
      const entry = entries.get(path);
      if (entry === undefined) throw new Error(`Missing path: ${path}`);
      if (entry === null) return { path, type: 'folder', size: 0, mtime: 0 };
      return { path, type: 'file', size: entry.length, mtime: 0 };
    },
    async walk(root: string) {
      const children = [...entries.keys()].filter(path => path.startsWith(`${root}/`));
      return Promise.all(children.map(path => fs.stat(path)));
    },
    async readdir(root: string) {
      return (await fs.walk(root)).filter(
        entry => !entry.path.slice(root.length + 1).includes('/')
      );
    },
    async rm(path: string) {
      entries.delete(path);
    },
    async rename(oldPath: string, newPath: string) {
      const entry = entries.get(oldPath);
      if (entry === undefined) throw new Error('Missing rename source');
      entries.set(newPath, entry);
      entries.delete(oldPath);
    },
  };
  return fs;
}

describe('legacy storage import', () => {
  beforeEach(() => {
    fixture.projects = [{ id: 'p1', name: 'tmp' }];
    fixture.files = [
      { id: 'f1', projectId: 'p1', path: '/src/index.ts', type: 'file', content: 'hello' },
    ];
    fixture.state = undefined;
    fixture.caches = [];
    fixture.deleted = [];
    fixture.failDelete = '';
    vi.clearAllMocks();
  });

  it('imports tmp as a normal home workspace with worktree and binary Git history', async () => {
    const fs = memoryFs();
    await fs.mkdir('/tmp');
    await migrateLegacyStorage(fs);
    expect(await fs.readText('/home/pyxis/tmp/src/index.ts')).toBe('hello');
    expect(await fs.readFile('/home/pyxis/tmp/.git/objects/history')).toEqual(
      new Uint8Array([0, 255, 3])
    );
    expect(fixture.state?.phase).toBe('complete');
    expect(fixture.deleted).toEqual(['PyxisProjects', 'pyxis-fs', 'pyxis-fs_lock']);
    expect(migrateMetadata).toHaveBeenCalledWith(fixture.state?.mappings, fixture.files, []);
  });

  it('rejects an existing home destination before writes without renaming it', async () => {
    const fs = memoryFs();
    await fs.mkdir('/home/pyxis/tmp');
    await fs.writeFile('/home/pyxis/tmp/existing.txt', 'preserved');
    const before = [...fs.entries.keys()];
    await expect(migrateLegacyStorage(fs)).rejects.toThrow(
      'Legacy project destination already exists: /home/pyxis/tmp'
    );
    expect([...fs.entries.keys()]).toEqual(before);
    expect(await fs.readText('/home/pyxis/tmp/existing.txt')).toBe('preserved');
    expect(fixture.deleted).toEqual([]);
    expect(migrateMetadata).not.toHaveBeenCalled();
  });

  it('imports cache as a normal project name under home', async () => {
    const fs = memoryFs();
    fixture.projects[0].name = 'cache';
    const { gitProjectNames } = await import('@/engine/core/migration/lightning');
    vi.mocked(gitProjectNames).mockResolvedValueOnce(['cache']);
    await migrateLegacyStorage(fs);
    expect(await fs.readText('/home/pyxis/cache/src/index.ts')).toBe('hello');
  });

  it('preserves sources on quota failure and resumes its persisted destination', async () => {
    const fs = memoryFs();
    const writeFile = fs.writeFile;
    fs.writeFile = vi.fn().mockRejectedValueOnce(new Error('QuotaExceededError'));
    await expect(migrateLegacyStorage(fs)).rejects.toThrow('QuotaExceededError');
    expect(fixture.deleted).toEqual([]);
    expect(fixture.state?.mappings[0].rootPath).toBe('/home/pyxis/tmp');
    fs.writeFile = writeFile;
    await migrateLegacyStorage(fs);
    expect(await fs.readText('/home/pyxis/tmp/src/index.ts')).toBe('hello');
    expect(fixture.state?.phase).toBe('complete');
  });

  it('retains old databases on byte verification failure and resumes the same root', async () => {
    const fs = memoryFs();
    fs.corrupt = true;
    await expect(migrateLegacyStorage(fs)).rejects.toThrow('byte verification failed');
    expect(fixture.deleted).toEqual([]);
    expect(migrateMetadata).not.toHaveBeenCalled();
    expect(fixture.state?.mappings[0].rootPath).toBe('/home/pyxis/tmp');
    fs.corrupt = false;
    await migrateLegacyStorage(fs);
    expect(fixture.state?.mappings[0].rootPath).toBe('/home/pyxis/tmp');
    expect(await fs.exists('/home/pyxis/tmp-migrated-2')).toBe(false);
  });

  it('resumes cleanup after a deletion failure without reimporting already verified data', async () => {
    const fs = memoryFs();
    fixture.failDelete = 'pyxis-fs';
    await expect(migrateLegacyStorage(fs)).rejects.toThrow('blocked');
    expect(fixture.state?.phase).toBe('cleanup');
    fixture.failDelete = '';
    fixture.files = [];
    await migrateLegacyStorage(fs);
    expect(fixture.state?.phase).toBe('complete');
    expect(migrateMetadata).toHaveBeenCalledTimes(1);
    expect(await fs.readText('/home/pyxis/tmp/src/index.ts')).toBe('hello');
  });

  it('does no work after the committed completion flag', async () => {
    const fs = memoryFs();
    await migrateLegacyStorage(fs);
    fixture.deleted = [];
    await migrateLegacyStorage(fs);
    expect(fixture.deleted).toEqual([]);
    expect(migrateMetadata).toHaveBeenCalledTimes(1);
  });

  it('retains legacy databases if metadata migration fails after the file copy', async () => {
    const fs = memoryFs();
    vi.mocked(migrateMetadata).mockRejectedValueOnce(new Error('metadata transaction failed'));
    await expect(migrateLegacyStorage(fs)).rejects.toThrow('metadata transaction failed');
    expect(fixture.deleted).toEqual([]);
    expect(fixture.state?.phase).toBe('copying');
  });

  it('archives cache namespaces and refuses to overwrite different archived bytes', async () => {
    const fs = memoryFs();
    fixture.caches = [
      { key: 'global:/cache/module.js', value: 'compiled', mtime: 0, isDir: false },
    ];
    await fs.mkdir('/home/pyxis/.cache/pyxis/legacy/global');
    await fs.writeFile('/home/pyxis/.cache/pyxis/legacy/global/module.js', 'different');
    await expect(migrateLegacyStorage(fs)).rejects.toThrow('byte verification failed');
    expect(fixture.deleted).toEqual([]);
    expect(await fs.readText('/home/pyxis/.cache/pyxis/legacy/global/module.js')).toBe('different');
    await fs.writeFile('/home/pyxis/.cache/pyxis/legacy/global/module.js', 'compiled');
    await migrateLegacyStorage(fs);
    expect(await fs.readText('/home/pyxis/.cache/pyxis/legacy/global/module.js')).toBe('compiled');
    expect(fixture.state?.phase).toBe('complete');
  });

  it('keeps dot cache namespaces inside their archive', async () => {
    const fs = memoryFs();
    fixture.caches = [{ key: '..:/cache/module.js', value: 'compiled', mtime: 0, isDir: false }];
    await migrateLegacyStorage(fs);
    expect(await fs.readText('/home/pyxis/.cache/pyxis/legacy/%2E%2E/module.js')).toBe('compiled');
    expect(await fs.exists('/home/pyxis/.cache/pyxis/module.js')).toBe(false);
  });

  it('preserves sources when a legacy cache path escapes its namespace', async () => {
    const fs = memoryFs();
    fixture.caches = [
      { key: 'global:/cache/../outside', value: 'compiled', mtime: 0, isDir: false },
    ];
    await expect(migrateLegacyStorage(fs)).rejects.toThrow('escapes project root');
    expect(fixture.deleted).toEqual([]);
    expect(await fs.exists('/home/pyxis/.cache/pyxis/legacy/outside')).toBe(false);
  });

  it('retains old data if destination has extra files or a legacy path escapes its root', async () => {
    const fs = memoryFs();
    fixture.files[0].path = '/../outside';
    await expect(migrateLegacyStorage(fs)).rejects.toThrow('escapes project root');
    expect(fixture.deleted).toEqual([]);
    fixture.files[0].path = '/src/index.ts';
    await fs.mkdir('/home/pyxis/tmp');
    await fs.writeFile('/home/pyxis/tmp/extra', 'extra');
    await expect(migrateLegacyStorage(fs)).rejects.toThrow('file count mismatch');
    expect(fixture.deleted).toEqual([]);
  });
});
