import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDB } from '@/constants/idb';
import { STORES, storageService } from '@/engine/core/metadata';

let indexedDbFactory: IDBFactory;

beforeEach(async () => {
  storageService.close();
  indexedDbFactory = new IDBFactory();
  vi.stubGlobal('indexedDB', indexedDbFactory);
  await storageService.clearAll();
});

afterEach(() => {
  storageService.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('IndexedDB storage service', () => {
  it('rejects a write when the transaction aborts after request success', async () => {
    let requestSucceeded = false;
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof originalPut>
    ) {
      const request = originalPut.apply(this, args);
      request.addEventListener(
        'success',
        () => {
          requestSucceeded = true;
          this.transaction.abort();
        },
        { once: true }
      );
      return request;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      storageService.set(STORES.USER_PREFERENCES, 'aborted', 'value')
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestSucceeded).toBe(true);

    vi.restoreAllMocks();
    await expect(storageService.get(STORES.USER_PREFERENCES, 'aborted')).resolves.toBeNull();
  });

  it('rejects failed reads instead of reporting missing data', async () => {
    await storageService.set(STORES.USER_PREFERENCES, 'entry', 'value', { cache: false });
    const originalGet = IDBObjectStore.prototype.get;
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      key: IDBValidKey | IDBKeyRange
    ) {
      const request = originalGet.call(this, key);
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(storageService.get(STORES.USER_PREFERENCES, 'entry')).rejects.toMatchObject({
      name: 'AbortError',
    });

    vi.restoreAllMocks();
    const originalGetAll = IDBObjectStore.prototype.getAll;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof originalGetAll>
    ) {
      const request = originalGetAll.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(storageService.getAll(STORES.USER_PREFERENCES)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('retries initialization after an open failure', async () => {
    storageService.close();
    const openDatabase = indexedDbFactory.open.bind(indexedDbFactory);
    let shouldFail = true;
    vi.spyOn(indexedDbFactory, 'open').mockImplementation((name, version) => {
      if (shouldFail) {
        shouldFail = false;
        throw new DOMException('temporary open failure', 'UnknownError');
      }
      return openDatabase(name, version);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(storageService.set(STORES.USER_PREFERENCES, 'retry', 'value')).rejects.toThrow(
      'temporary open failure'
    );
    await expect(
      storageService.set(STORES.USER_PREFERENCES, 'retry', 'value')
    ).resolves.toBeUndefined();
    await expect(storageService.get(STORES.USER_PREFERENCES, 'retry')).resolves.toBe('value');
  });

  it('isolates cached data from caller mutations', async () => {
    const input = { nested: { value: 'committed' } };
    await storageService.set(STORES.USER_PREFERENCES, 'clone', input);
    input.nested.value = 'mutated input';

    const firstRead = await storageService.get<typeof input>(STORES.USER_PREFERENCES, 'clone');
    expect(firstRead?.nested.value).toBe('committed');
    if (!firstRead) throw new Error('expected cached record');
    firstRead.nested.value = 'mutated read';

    const secondRead = await storageService.get<typeof input>(STORES.USER_PREFERENCES, 'clone');
    expect(secondRead?.nested.value).toBe('committed');
  });

  it('does not return cached data after closing and recreating the database', async () => {
    await storageService.set(STORES.USER_PREFERENCES, 'removed', 'stale');
    storageService.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDbFactory.deleteDatabase(IDB.GLOBAL.NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    await expect(storageService.get(STORES.USER_PREFERENCES, 'removed')).resolves.toBeNull();
  });

  it('accepts circular records supported by structured cloning', async () => {
    interface CircularRecord {
      value: string;
      reference?: CircularRecord;
    }

    const record: CircularRecord = { value: 'cycle' };
    record.reference = record;
    await storageService.set(STORES.USER_PREFERENCES, 'circular', record);

    const loaded = await storageService.get<CircularRecord>(STORES.USER_PREFERENCES, 'circular');
    expect(loaded?.reference).toBe(loaded);
  });

  it('caches the same input snapshot that IndexedDB commits', async () => {
    const input = { nested: { value: 'committed' } };
    const originalPut = IDBObjectStore.prototype.put;
    let requestQueued = () => {};
    const queued = new Promise<void>(resolve => {
      requestQueued = resolve;
    });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof originalPut>
    ) {
      const request = originalPut.apply(this, args);
      requestQueued();
      return request;
    });

    const write = storageService.set(STORES.USER_PREFERENCES, 'snapshot', input);
    await queued;
    input.nested.value = 'changed while transaction was pending';
    await write;
    vi.restoreAllMocks();

    const cached = await storageService.get<typeof input>(STORES.USER_PREFERENCES, 'snapshot');
    expect(cached?.nested.value).toBe('committed');
    const stored = await readStoredData<typeof input>(STORES.USER_PREFERENCES, 'snapshot');
    expect(stored?.nested.value).toBe('committed');
  });

  it('removes expired records from both IndexedDB and cache', async () => {
    const id = 'expiring-entry';
    await storageService.set(STORES.USER_PREFERENCES, id, 'cached value');
    await writeExpiredRecord(id);

    await storageService.cleanExpired();
    await expect(storageService.get(STORES.USER_PREFERENCES, id)).resolves.toBeNull();
  });

  it('keeps a replacement written while expired entries are cleaned', async () => {
    const id = 'replaced-entry';
    await storageService.set(STORES.USER_PREFERENCES, id, 'old cached value');
    await writeExpiredRecord(id);

    const cleanup = storageService.cleanExpired();
    const replacement = storageService.set(STORES.USER_PREFERENCES, id, 'replacement');
    await Promise.all([cleanup, replacement]);

    await expect(storageService.get(STORES.USER_PREFERENCES, id)).resolves.toBe('replacement');
  });

  it('does not delete a replacement committed after an expired get snapshot', async () => {
    const id = 'expired-get-race';
    await storageService.set(STORES.USER_PREFERENCES, id, 'expired', { ttl: -1 });
    const originalGet = IDBObjectStore.prototype.get;
    let replacementScheduled = true;
    const scheduled = { write: null as Promise<void> | null };
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      key: IDBValidKey | IDBKeyRange
    ) {
      const request = originalGet.call(this, key);
      request.addEventListener(
        'success',
        () => {
          if (!replacementScheduled) return;
          replacementScheduled = false;
          scheduled.write = storageService.set(STORES.USER_PREFERENCES, id, 'replacement');
        },
        { once: true }
      );
      return request;
    });

    const result = await storageService.get(STORES.USER_PREFERENCES, id);
    const replacementWrite = scheduled.write;
    if (!replacementWrite) throw new Error('replacement write was not scheduled');
    await replacementWrite;

    expect(result).toBe('replacement');
    await expect(storageService.get(STORES.USER_PREFERENCES, id)).resolves.toBe('replacement');
  });

  it('does not delete a replacement committed after an expired getAll snapshot', async () => {
    const id = 'expired-get-all-race';
    await storageService.set(STORES.USER_PREFERENCES, id, 'expired', { ttl: -1 });
    const originalGetAll = IDBObjectStore.prototype.getAll;
    let replacementScheduled = true;
    const scheduled = { write: null as Promise<void> | null };
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof originalGetAll>
    ) {
      const request = originalGetAll.apply(this, args);
      request.addEventListener(
        'success',
        () => {
          if (!replacementScheduled) return;
          replacementScheduled = false;
          scheduled.write = storageService.set(STORES.USER_PREFERENCES, id, 'replacement');
        },
        { once: true }
      );
      return request;
    });

    await storageService.getAll(STORES.USER_PREFERENCES);
    const replacementWrite = scheduled.write;
    if (!replacementWrite) throw new Error('replacement write was not scheduled');
    await replacementWrite;
    vi.restoreAllMocks();

    await expect(storageService.get(STORES.USER_PREFERENCES, id)).resolves.toBe('replacement');
  });
});

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(IDB.GLOBAL.NAME, IDB.GLOBAL.VERSION);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function writeExpiredRecord(id: string): Promise<void> {
  const database = await openDatabase(indexedDbFactory);
  const transaction = database.transaction(STORES.USER_PREFERENCES, 'readwrite');
  const committed = transactionCompletion(transaction);
  transaction.objectStore(STORES.USER_PREFERENCES).put({
    id,
    data: 'expired value',
    timestamp: 0,
    expiresAt: 1,
  });
  await committed;
  database.close();
}

async function readStoredData<T>(storeName: string, id: string): Promise<T | null> {
  const database = await openDatabase(indexedDbFactory);
  const transaction = database.transaction(storeName, 'readonly');
  const request = transaction.objectStore(storeName).get(id);
  const stored = await new Promise<T | null>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result?.data ?? null);
    request.onerror = () => reject(request.error);
  });
  await transactionCompletion(transaction);
  database.close();
  return stored;
}
