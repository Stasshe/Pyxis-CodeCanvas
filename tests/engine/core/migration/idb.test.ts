import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { countRecords, iterateAll, openExisting, openState } from '@/engine/core/migration/idb';

describe('migration record iterator', () => {
  it.each(['state', 'legacy'])(
    'rejects blocked %s opens and closes a late successful connection',
    async kind => {
      const close = vi.fn();
      const request = {
        result: { close },
        onblocked: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
      };
      vi.stubGlobal('indexedDB', { open: () => request });
      try {
        let pending: Promise<IDBDatabase | null>;
        if (kind === 'state') pending = openState();
        else pending = openExisting('PyxisProjects');
        const rejected = expect(pending).rejects.toThrow('blocked');
        request.onblocked?.();
        await rejected;
        request.onsuccess?.();
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  );

  it('opens the next record transaction only after the yielded value is processed', async () => {
    const name = `migration-iterator-${crypto.randomUUID()}`;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').put('first', 1);
      transaction.objectStore('records').put('second', 2);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const records = iterateAll<string>(db, 'records');
    expect(await countRecords(db, 'records')).toBe(2);
    expect(await countRecords(db, 'missing')).toBe(0);
    const transactions = vi.spyOn(db, 'transaction');
    const first = await records.next();
    expect(first).toEqual({ value: 'first', done: false });
    expect(transactions).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(transactions).toHaveBeenCalledTimes(1);
    const second = await records.next();
    expect(second).toEqual({ value: 'second', done: false });
    expect(transactions).toHaveBeenCalledTimes(2);
    expect(await records.next()).toEqual({ value: undefined, done: true });
    db.close();
    await new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
    });
  });
});
