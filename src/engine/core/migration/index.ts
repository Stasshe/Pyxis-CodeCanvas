import { coreError } from '@/engine/core/coreLogger';
import type { FsApi } from '@/engine/core/fs';
import { RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
import { getParentPath, HOME_DIR, isPathWithin, normalizePath } from '@/engine/core/pathUtils';
import { deleteDatabase, openExisting, openState, readAll, readValue, writeValue } from './idb';
import { gitProjectNames, readGitEntries } from './lightning';
import { migrateMetadata } from './metadata';
import type {
  LegacyCache,
  LegacyChatSpace,
  LegacyFile,
  LegacyProject,
  MigrationState,
} from './types';

interface CopyEntry {
  path: string;
  directory: boolean;
  bytes?: Uint8Array;
}

function fileBytes(file: LegacyFile): Uint8Array {
  if (file.isBufferArray) {
    if (!file.bufferContent) throw new Error(`Missing legacy binary bytes: ${file.path}`);
    return new Uint8Array(file.bufferContent);
  }
  if (file.content === undefined) throw new Error(`Missing legacy text bytes: ${file.path}`);
  return new TextEncoder().encode(file.content);
}

async function assignRoots(
  fs: FsApi,
  projects: LegacyProject[],
  state: MigrationState,
  db: IDBDatabase
): Promise<void> {
  for (const project of projects) {
    if (state.mappings.some(mapping => mapping.id === project.id)) continue;
    if (
      !project.name ||
      project.name.includes('/') ||
      project.name.includes('\\') ||
      project.name === '.' ||
      project.name === '..'
    ) {
      throw new Error(`Invalid legacy project name: ${project.name}`);
    }
    const rootPath = normalizePath(`${HOME_DIR}/${project.name}`);
    if (
      (await fs.exists(rootPath)) ||
      state.mappings.some(mapping => mapping.rootPath === rootPath)
    ) {
      throw new Error(`Legacy project destination already exists: ${rootPath}`);
    }
    state.mappings.push({ ...project, rootPath });
    // Persist the destination before creating it, so retries reuse their own root.
    await writeValue(db, 'state', state);
  }
}

function destination(root: string, path: string): string {
  const normalized = normalizePath(`${root}/${path}`);
  if (!isPathWithin(normalized, root)) {
    throw new Error(`Legacy path escapes project root: ${path}`);
  }
  return normalized;
}

async function copy(fs: FsApi, entries: CopyEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.directory) {
      await fs.mkdir(entry.path, { recursive: true });
      continue;
    }
    if (!entry.bytes) throw new Error(`Missing migration bytes: ${entry.path}`);
    const parent = getParentPath(entry.path);
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(entry.path, entry.bytes);
  }
}

async function verify(fs: FsApi, entries: CopyEntry[], root?: string): Promise<void> {
  for (const entry of entries) {
    if (entry.directory) {
      const stat = await fs.stat(entry.path);
      if (stat.type !== 'folder') throw new Error(`Migration directory mismatch: ${entry.path}`);
      continue;
    }
    const expected = entry.bytes;
    if (!expected) throw new Error(`Missing migration verification bytes: ${entry.path}`);
    const actual = await fs.readFile(entry.path);
    if (
      actual.length !== expected.length ||
      actual.some((byte, index) => byte !== expected[index])
    ) {
      throw new Error(`Migration byte verification failed: ${entry.path}`);
    }
  }
  if (root) {
    const actual = (await fs.walk(root)).filter(entry => entry.type === 'file').length;
    const expected = entries.filter(entry => !entry.directory).length;
    if (actual !== expected) throw new Error(`Migration file count mismatch: ${root}`);
  }
}

function cacheEntries(records: LegacyCache[]): CopyEntry[] {
  return records.map(record => {
    const separator = record.key.indexOf(':');
    if (separator < 1) throw new Error(`Invalid legacy cache key: ${record.key}`);
    const namespace = encodeURIComponent(record.key.slice(0, separator)).replaceAll('.', '%2E');
    const oldPath = record.key.slice(separator + 1);
    if (oldPath !== '/cache' && !oldPath.startsWith('/cache/'))
      throw new Error(`Invalid legacy cache path: ${oldPath}`);
    const path = destination(
      `${RUNTIME_CACHE_PATH}/legacy/${namespace}`,
      oldPath.slice('/cache'.length)
    );
    let bytes: Uint8Array | undefined;
    if (!record.isDir) {
      if (typeof record.value === 'string') bytes = new TextEncoder().encode(record.value);
      else bytes = new Uint8Array(record.value);
    }
    return { path, directory: record.isDir, bytes };
  });
}

async function cleanup(state: MigrationState, stateDb: IDBDatabase): Promise<void> {
  await deleteDatabase('PyxisProjects');
  await deleteDatabase('pyxis-fs');
  await deleteDatabase('pyxis-fs_lock');
  state.phase = 'complete';
  await writeValue(stateDb, 'state', state);
}

/** Temporary legacy import. Remove after the migration window ending April 2027. */
export async function migrateLegacyStorage(fs: FsApi): Promise<void> {
  const stateDb = await openState();
  let projectsDb: IDBDatabase | null = null;
  let gitDb: IDBDatabase | null = null;
  try {
    let state = await readValue<MigrationState>(stateDb, 'state', 'opfs-v1');
    if (state?.phase === 'complete') return;
    if (state?.phase === 'cleanup') {
      await cleanup(state, stateDb);
      return;
    }
    if (!state) state = { id: 'opfs-v1', phase: 'copying', mappings: [] };
    projectsDb = await openExisting('PyxisProjects');
    gitDb = await openExisting('pyxis-fs');
    const projects = await readAll<LegacyProject>(projectsDb, 'projects');
    const files = await readAll<LegacyFile>(projectsDb, 'files');
    const chats = await readAll<LegacyChatSpace>(projectsDb, 'chatSpaces');
    const caches = await readAll<LegacyCache>(projectsDb, 'runtimeCache');
    for (const name of await gitProjectNames(gitDb)) {
      if (!projects.some(project => project.name === name)) {
        throw new Error(`Legacy Git history has no project: ${name}`);
      }
    }
    await assignRoots(fs, projects, state, stateDb);
    for (const file of files) {
      if (!state.mappings.some(mapping => mapping.id === file.projectId)) {
        throw new Error(`Legacy file has no project: ${file.path}`);
      }
    }
    for (const mapping of state.mappings) {
      const entries = new Map<string, CopyEntry>();
      for (const file of files.filter(file => file.projectId === mapping.id)) {
        if (file.type !== 'file' && file.type !== 'folder') {
          throw new Error(`Invalid legacy file type: ${file.path}`);
        }
        const path = destination(mapping.rootPath, file.path);
        const entry: CopyEntry = { path, directory: file.type === 'folder' };
        if (!entry.directory) entry.bytes = fileBytes(file);
        if (entries.has(path)) throw new Error(`Duplicate legacy file path: ${path}`);
        entries.set(path, entry);
      }
      for (const entry of await readGitEntries(gitDb, mapping.name)) {
        const path = destination(mapping.rootPath, entry.path);
        entries.set(path, { ...entry, path });
      }
      await fs.mkdir(mapping.rootPath, { recursive: true });
      const manifest = [...entries.values()];
      await copy(fs, manifest);
      await verify(fs, manifest, mapping.rootPath);
    }
    if (caches.length > 0) {
      const cacheManifest = cacheEntries(caches);
      const paths = new Set(cacheManifest.map(entry => entry.path));
      if (paths.size !== cacheManifest.length) throw new Error('Duplicate legacy cache paths');
      const existing: CopyEntry[] = [];
      for (const entry of cacheManifest) {
        if (await fs.exists(entry.path)) existing.push(entry);
      }
      await verify(fs, existing);
      await copy(fs, cacheManifest);
      await verify(fs, cacheManifest, `${RUNTIME_CACHE_PATH}/legacy`);
    }
    await migrateMetadata(state.mappings, files, chats);
    state.phase = 'cleanup';
    await writeValue(stateDb, 'state', state);
    projectsDb?.close();
    gitDb?.close();
    projectsDb = null;
    gitDb = null;
    await cleanup(state, stateDb);
  } catch (error) {
    coreError('[Storage migration] Legacy storage import failed', error);
    throw error;
  } finally {
    projectsDb?.close();
    gitDb?.close();
    stateDb.close();
  }
}
