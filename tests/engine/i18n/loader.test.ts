import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/engine/i18n/storage-adapter', () => ({
  loadTranslationCache: cache.load,
  saveTranslationCache: cache.save,
}));

import { clearMemoryCache, loadTranslations } from '@/engine/i18n/loader';

describe('translation loader cache failures', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMemoryCache();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ welcome: 'Welcome' }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches the resource when reading IndexedDB fails', async () => {
    cache.load.mockRejectedValue(new Error('IndexedDB unavailable'));

    await expect(loadTranslations('ja')).resolves.toEqual({ welcome: 'Welcome' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns fetched translations when writing IndexedDB fails', async () => {
    cache.save.mockRejectedValue(new Error('IndexedDB unavailable'));

    await expect(loadTranslations('ja')).resolves.toEqual({ welcome: 'Welcome' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await expect(loadTranslations('ja')).resolves.toEqual({ welcome: 'Welcome' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back when the fetched resource is not a dictionary', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ['invalid'],
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ welcome: 'Welcome' }),
      });
    cache.load.mockResolvedValue(null);

    await expect(loadTranslations('ja')).resolves.toEqual({ welcome: 'Welcome' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
