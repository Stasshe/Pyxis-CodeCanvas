import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('startup metadata connections', () => {
  it.each(['application', 'recent folders'])(
    'rejects a blocked %s upgrade and closes late connections',
    async kind => {
      vi.resetModules();
      const close = vi.fn();
      const request = {
        result: { close },
        onblocked: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
      };
      vi.stubGlobal('indexedDB', { open: () => request });
      let pending: Promise<unknown>;
      if (kind === 'application') {
        const { storageService } = await import('@/engine/core/metadata/index');
        pending = storageService.initialize();
      } else {
        const { listRecentFolders } = await import(
          '@/engine/core/metadata/recentFolderStorageAdapter'
        );
        pending = listRecentFolders();
      }
      const rejected = expect(pending).rejects.toThrow('blocked');
      request.onblocked?.();
      await rejected;
      request.onsuccess?.();
      expect(close).toHaveBeenCalledTimes(1);
    }
  );
});
