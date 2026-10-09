import { coreError } from '@/engine/core/coreLogger';
import type { FsApi } from '@/engine/core/fs';
import { RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
import { getParentPath, HOME_DIR, isPathWithin, normalizePath } from '@/engine/core/pathUtils';
import {
  deleteDatabase,
  iterateAll,
  iterateAllKeyed,
  openExisting,
  openState,
  readAll,
  readValue,
  writeValue,
} from './idb';
import { gitProjectNames, readGitEntries } from './lightning';
import { migrateMetadata } from './metadata';
import type {
  LegacyCache,
  LegacyFile,
  LegacyFileReference,
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

async function copyAndVerify(fs: FsApi, entry: CopyEntry): Promise<void> {
  if (entry.directory) {
    await fs.mkdir(entry.path, { recursive: true });
    const stat = await fs.stat(entry.path);
    if (stat.type !== 'folder') throw new Error(`Migration directory mismatch: ${entry.path}`);
    return;
  }
  if (!entry.bytes) throw new Error(`Missing migration bytes: ${entry.path}`);
  await fs.mkdir(getParentPath(entry.path), { recursive: true });
  await fs.writeFile(entry.path, entry.bytes);
  await verifyExisting(fs, entry);
}

async function verifyExisting(fs: FsApi, entry: CopyEntry): Promise<void> {
  const expected = entry.bytes;
  if (!expected) throw new Error(`Missing migration verification bytes: ${entry.path}`);
  const actual = await fs.readFile(entry.path);
  if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) {
    throw new Error(`Migration byte verification failed: ${entry.path}`);
  }
}

async function verifyFileCount(fs: FsApi, root: string, expected: Set<string>): Promise<void> {
  const actual = (await fs.walk(root)).filter(entry => entry.type === 'file').length;
  if (actual !== expected.size) throw new Error(`Migration file count mismatch: ${root}`);
}

function cacheEntry(record: LegacyCache): CopyEntry {
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
    const files: LegacyFileReference[] = [];
    const gitNames = await gitProjectNames(gitDb);
    for (const name of gitNames) {
      if (!projects.some(project => project.name === name)) {
        throw new Error(`Legacy Git history has no project: ${name}`);
      }
    }
    await assignRoots(fs, projects, state, stateDb);
    const expectedFiles = new Map<string, Set<string>>();
    const worktreePaths = new Map<string, Set<string>>();
    for (const mapping of state.mappings) {
      expectedFiles.set(mapping.id, new Set());
      worktreePaths.set(mapping.id, new Set());
      await fs.mkdir(mapping.rootPath, { recursive: true });
    }
    const mappingById = new Map(state.mappings.map(mapping => [mapping.id, mapping]));
    for await (const { key, value: file } of iterateAllKeyed<LegacyFile>(projectsDb, 'files')) {
      const mapping = mappingById.get(file.projectId);
      if (!mapping) throw new Error(`Legacy file has no project: ${file.path}`);
      if (file.type !== 'file' && file.type !== 'folder') {
        throw new Error(`Invalid legacy file type: ${file.path}`);
      }
      files.push({
        key,
        id: file.id,
        projectId: file.projectId,
        path: file.path,
        type: file.type,
        hasReview:
          file.aiAgentSuggestedContent !== undefined ||
          (file.isAiAgentReview === true && file.aiAgentCode !== undefined),
      });
      const path = destination(mapping.rootPath, file.path);
      const paths = worktreePaths.get(mapping.id)!;
      if (paths.has(path)) throw new Error(`Duplicate legacy file path: ${path}`);
      paths.add(path);
      const directory = file.type === 'folder';
      let bytes: Uint8Array | undefined;
      if (!directory) bytes = fileBytes(file);
      await copyAndVerify(fs, {
        path,
        directory,
        bytes,
      });
      if (!directory) expectedFiles.get(mapping.id)!.add(path);
    }
    for (const mapping of state.mappings) {
      if (gitNames.includes(mapping.name)) {
        for await (const entry of readGitEntries(gitDb, mapping.name)) {
          const path = destination(mapping.rootPath, entry.path);
          await copyAndVerify(fs, { ...entry, path });
          if (!entry.directory) expectedFiles.get(mapping.id)!.add(path);
        }
      }
      await verifyFileCount(fs, mapping.rootPath, expectedFiles.get(mapping.id)!);
    }
    const cachePaths = new Set<string>();
    const cacheFiles = new Set<string>();
    for await (const record of iterateAll<LegacyCache>(projectsDb, 'runtimeCache')) {
      const entry = cacheEntry(record);
      if (cachePaths.has(entry.path)) throw new Error('Duplicate legacy cache paths');
      cachePaths.add(entry.path);
      if ((await fs.exists(entry.path)) && !entry.directory) {
        await verifyExisting(fs, entry);
      }
      await copyAndVerify(fs, entry);
      if (!entry.directory) cacheFiles.add(entry.path);
    }
    if (cachePaths.size > 0) await verifyFileCount(fs, `${RUNTIME_CACHE_PATH}/legacy`, cacheFiles);
    await migrateMetadata(state.mappings, files, projectsDb);
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
