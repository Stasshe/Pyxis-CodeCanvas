import { describe, expect, it, vi } from 'vitest';
import { IndexedDbPermissionStore } from '@/engine/core/fs/permissions';

describe('IndexedDB permission connections', () => {
  it('closes a late connection after a blocked open and keeps the retry connection', async () => {
    await new IndexedDbPermissionStore().set('/permission-connection-seed', 0o600);
    const originalOpen = indexedDB.open.bind(indexedDB);
    const open = vi.spyOn(indexedDB, 'open');
    const close = vi.spyOn(IDBDatabase.prototype, 'close');
    let firstRequest: IDBOpenDBRequest | undefined;
    let lateDatabase: IDBDatabase | undefined;
    let retryDatabase: IDBDatabase | undefined;
    let resolveFirstSuccess: () => void = () => {};
    let resolveRetrySuccess: () => void = () => {};
    const retrySuccess = new Promise<void>(resolve => {
      resolveRetrySuccess = resolve;
    });
    let openCount = 0;

    open.mockImplementation((name, version) => {
      const request = originalOpen(name, version);
      openCount += 1;
      if (openCount === 1) {
        firstRequest = request;
        return request;
      }
      if (openCount === 2) {
        request.addEventListener(
          'success',
          () => {
            retryDatabase = request.result;
            resolveRetrySuccess();
          },
          { once: true }
        );
      }
      return request;
    });

    try {
      const permissions = new IndexedDbPermissionStore();
      const blockedRead = permissions.get('/blocked');
      if (!firstRequest) throw new Error('First open request was not captured');
      const request = firstRequest;
      const firstSuccess = new Promise<void>(resolve => {
        resolveFirstSuccess = resolve;
      });
      request.addEventListener(
        'success',
        () => {
          lateDatabase = request.result;
          resolveFirstSuccess();
        },
        { once: true }
      );
      firstRequest.onblocked?.(new Event('blocked'));

      await expect(blockedRead).rejects.toThrow('Filesystem metadata upgrade is blocked');
      await permissions.set('/retry', 0o640);
      await firstSuccess;
      await retrySuccess;

      expect(lateDatabase).toBeDefined();
      expect(close.mock.contexts).toContain(lateDatabase);
      expect(retryDatabase).toBeDefined();
      expect(await permissions.get('/retry')).toBe(0o640);
      expect(open).toHaveBeenCalledTimes(2);
      retryDatabase?.onversionchange?.(new Event('versionchange'));
      expect(await permissions.get('/retry')).toBe(0o640);
      expect(open).toHaveBeenCalledTimes(3);
    } finally {
      open.mockRestore();
      close.mockRestore();
    }
  });
});
