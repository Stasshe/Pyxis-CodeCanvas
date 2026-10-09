import type { ProjectFile } from '@/types';
import { FSError } from './errors';
import type { FifoEntry } from './fifo';

const DATABASE = 'PyxisFsMetadata';
const STORE = 'permissions';
const VERSION = 1;
const PERMISSION_MASK = 0o7777;

const TYPE_BITS: Record<ProjectFile['type'], number> = {
  file: 0o100000,
  folder: 0o040000,
  symlink: 0o120000,
  fifo: 0o010000,
  characterDevice: 0o020000,
};

const DEFAULT_PERMISSIONS: Record<ProjectFile['type'], number> = {
  file: 0o644,
  folder: 0o755,
  symlink: 0o777,
  fifo: 0o644,
  characterDevice: 0o666,
};

export interface PermissionRecord {
  path: string;
  mode: number;
}

export interface PermissionStore {
  get(path: string): Promise<number | undefined>;
  set(path: string, mode: number): Promise<void>;
  remove(paths: string[]): Promise<void>;
  move(source: string, destination: string): Promise<void>;
}

export function permissionBits(mode: number): number {
  if (!Number.isSafeInteger(mode) || mode < 0) throw new TypeError('Invalid file mode');
  return mode & PERMISSION_MASK;
}

export function defaultMode(type: ProjectFile['type']): number {
  return TYPE_BITS[type] | DEFAULT_PERMISSIONS[type];
}

export function withPermissionBits(type: ProjectFile['type'], permissions: number): number {
  return TYPE_BITS[type] | (permissions & PERMISSION_MASK);
}

export function setMemoryMode(
  path: string,
  type: ProjectFile['type'],
  permissions: number,
  memory: Map<string, { metadata: ProjectFile }>,
  fifos: Map<string, FifoEntry>
): void {
  const metadata = memory.get(path)?.metadata;
  if (metadata) metadata.mode = withPermissionBits(type, permissions);
  else {
    const fifo = fifos.get(path);
    if (!fifo) throw new FSError('ENOENT', path);
    fifo.mode = withPermissionBits(type, permissions);
  }
}

export async function applyStoredMode(
  store: PermissionStore,
  entry: ProjectFile,
  memory: boolean
): Promise<ProjectFile> {
  if (memory) return entry;
  const stored = await store.get(entry.path);
  return { ...entry, mode: withPermissionBits(entry.type, stored ?? defaultMode(entry.type)) };
}

export async function initializeMode(
  store: PermissionStore,
  path: string,
  mode: number | undefined
): Promise<void> {
  await store.remove([path]);
  if (mode === undefined) return;
  await store.set(path, permissionBits(mode));
}

export async function createWithMode(
  store: PermissionStore,
  path: string,
  mode: number | undefined,
  create: () => Promise<void>,
  memory = false
): Promise<void> {
  if (!memory) await initializeMode(store, path, mode);
  try {
    await create();
  } catch (error) {
    if (!memory) {
      try {
        await store.remove([path]);
      } catch (cleanupError) {
        throw new AggregateError(
          [asError(error), asError(cleanupError)],
          `Failed to create ${path}`
        );
      }
    }
    throw error;
  }
}

export async function removePermissions(
  store: PermissionStore,
  paths: string[],
  onComplete: () => void
): Promise<void> {
  try {
    await store.remove(paths);
  } catch (error) {
    onComplete();
    throw error;
  }
  onComplete();
}

export function emitRemovedPaths(
  entries: ProjectFile[],
  missing: Set<string>,
  emit: (path: string) => void
): void {
  for (const entry of entries) {
    if (missing.has(entry.path) && !missing.has(parent(entry.path))) emit(entry.path);
  }
}

export function removeTreePermissions(
  store: PermissionStore,
  path: string,
  descendants: ProjectFile[],
  emit: (path: string) => void
): Promise<void> {
  return removePermissions(store, [path, ...descendants.map(entry => entry.path)], () =>
    emit(path)
  );
}

function parent(path: string): string {
  const separator = path.lastIndexOf('/');
  if (separator <= 0) return '/';
  return path.slice(0, separator);
}

export async function chmodPath(
  store: PermissionStore,
  input: string,
  mode: number,
  fs: {
    resolve(path: string): Promise<string>;
    stat(path: string): Promise<ProjectFile>;
    isMemory(path: string): boolean;
    assertMutable(path: string): void;
    setMemory(path: string, type: ProjectFile['type'], permissions: number): void;
    emit(event: { type: 'update'; path: string; file: ProjectFile }): void;
  }
): Promise<void> {
  fs.assertMutable(input);
  const path = await fs.resolve(input);
  const entry = await fs.stat(path);
  fs.assertMutable(path);
  const permissions = permissionBits(mode);
  if (fs.isMemory(path)) {
    fs.setMemory(path, entry.type, permissions);
  } else await store.set(path, permissions);
  fs.emit({ type: 'update', path, file: await fs.stat(path) });
}

export async function movePermissions(
  store: PermissionStore,
  source: string,
  destination: string,
  entries: ProjectFile[],
  sourceMemory: boolean,
  destinationMemory: boolean
): Promise<void> {
  if (sourceMemory && destinationMemory) return;
  const paths = entries.map(entry => entry.path);
  try {
    if (!sourceMemory && !destinationMemory) {
      await store.move(source, destination);
      return;
    }
    const destinationPaths = paths.map(path => `${destination}${path.slice(source.length)}`);
    const pathsToRemove = [...destinationPaths];
    if (!sourceMemory) pathsToRemove.push(...paths);
    await store.remove(pathsToRemove);
    if (!destinationMemory) {
      for (const entry of entries) {
        await store.set(
          `${destination}${entry.path.slice(source.length)}`,
          permissionBits(entry.mode)
        );
      }
    }
  } catch (error) {
    try {
      const destinationPaths = paths.map(path => `${destination}${path.slice(source.length)}`);
      await store.remove([...paths, ...destinationPaths]);
      if (!destinationMemory) {
        for (const entry of entries) {
          await store.set(
            `${destination}${entry.path.slice(source.length)}`,
            permissionBits(entry.mode)
          );
        }
      }
    } catch (reconcileError) {
      throw new AggregateError(
        [asError(error), asError(reconcileError)],
        'Failed to move file modes'
      );
    }
    throw error;
  }
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

/** Path-keyed attributes remain separate from OPFS payloads and open lazily. */
export class IndexedDbPermissionStore implements PermissionStore {
  private database: Promise<IDBDatabase> | null = null;

  get(path: string): Promise<number | undefined> {
    return this.read(path);
  }

  async set(path: string, mode: number): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    const completed = transactionDone(transaction);
    transaction
      .objectStore(STORE)
      .put({ path, mode: permissionBits(mode) } satisfies PermissionRecord);
    await completed;
  }

  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    for (const path of paths) store.delete(path);
    await completed;
  }

  async move(source: string, destination: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const completed = transactionDone(transaction);
    visitSubtree(
      store,
      destination,
      cursor => cursor.delete(),
      () =>
        visitSubtree(store, source, cursor => {
          const record = cursor.value as PermissionRecord;
          cursor.delete();
          store.put({
            path: `${destination}${record.path.slice(source.length)}`,
            mode: record.mode,
          } satisfies PermissionRecord);
        })
    );
    await completed;
  }

  private async read(path: string): Promise<number | undefined> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readonly');
    const completed = transactionDone(transaction);
    const record = (await requestResult(transaction.objectStore(STORE).get(path))) as
      | PermissionRecord
      | undefined;
    await completed;
    return record?.mode;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    const request = indexedDB.open(DATABASE, VERSION);
    let opening: Promise<IDBDatabase> | null = null;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        if (this.database === opening) this.database = null;
        reject(error);
      };

      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'path' });
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        resolve(request.result);
      };
      request.onerror = () =>
        fail(request.error ?? new Error('Failed to open filesystem metadata'));
      request.onblocked = () => fail(new Error('Filesystem metadata upgrade is blocked'));
    });
    opening = pending;
    this.database = pending;
    void pending
      .then(database => {
        database.onversionchange = () => {
          database.close();
          if (this.database === pending) this.database = null;
        };
      })
      .catch(() => {
        if (this.database === pending) this.database = null;
      });
    return pending;
  }
}

function visitSubtree(
  store: IDBObjectStore,
  path: string,
  visit: (cursor: IDBCursorWithValue) => void,
  complete: () => void = () => undefined
): void {
  let exactComplete = false;
  let descendantsComplete = false;
  const finish = (): void => {
    if (exactComplete && descendantsComplete) complete();
  };
  const exact = store.openCursor(IDBKeyRange.only(path));
  exact.onsuccess = () => {
    const cursor = exact.result;
    if (cursor) visit(cursor);
    exactComplete = true;
    finish();
  };
  const descendants = store.openCursor(IDBKeyRange.bound(`${path}/`, `${path}0`, false, true));
  descendants.onsuccess = () => {
    const cursor = descendants.result;
    if (cursor) {
      visit(cursor);
      cursor.continue();
    } else {
      descendantsComplete = true;
      finish();
    }
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Filesystem metadata request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Filesystem metadata transaction aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Filesystem metadata transaction failed'));
  });
}
