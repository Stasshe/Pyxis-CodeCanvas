export function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let absent = false;
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) {
        absent = true;
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (absent) {
        resolve(null);
        return;
      }
      reject(request.error);
    };
    request.onblocked = () => reject(new Error(`Legacy database is blocked: ${name}`));
  });
}

export function readAll<T>(db: IDBDatabase | null, storeName: string): Promise<T[]> {
  if (!db || !db.objectStoreNames.contains(storeName)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

/** Reads one record per transaction and waits for the caller before opening the next. */
export async function* iterateAll<T>(db: IDBDatabase | null, storeName: string): AsyncGenerator<T> {
  for await (const record of iterateAllKeyed<T>(db, storeName)) yield record.value;
}

export async function* iterateAllKeyed<T>(
  db: IDBDatabase | null,
  storeName: string
): AsyncGenerator<{ key: IDBValidKey; value: T }> {
  if (!db || !db.objectStoreNames.contains(storeName)) return;
  let lastKey: IDBValidKey | undefined;
  while (true) {
    const record = await new Promise<{ key: IDBValidKey; value: T } | undefined>(
      (resolve, reject) => {
        const transaction = db.transaction(storeName);
        const store = transaction.objectStore(storeName);
        let range: IDBKeyRange | undefined;
        if (lastKey !== undefined) range = IDBKeyRange.lowerBound(lastKey, true);
        const request = store.openCursor(range);
        let result: { key: IDBValidKey; value: T } | undefined;
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) result = { key: cursor.primaryKey, value: cursor.value as T };
        };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }
    );
    if (!record) return;
    lastKey = record.key;
    yield record;
  }
}

export function readValue<T>(
  db: IDBDatabase,
  storeName: string,
  key: IDBValidKey
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export function writeValue<T>(db: IDBDatabase, storeName: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function openState(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PyxisStorageMigration', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error(`Close other tabs before removing legacy database: ${name}`));
  });
}
