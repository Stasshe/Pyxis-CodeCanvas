import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/engine/core/metadata', () => ({
  STORES: { TRANSLATIONS: 'translations' },
  storageService: storage,
}));

import { loadTranslationCache, saveTranslationCache } from '@/engine/core/i18n/storage-adapter';
import { pyxisEnv } from '@/env';

describe('translation cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the build version while retaining the seven day expiry', async () => {
    const translations = { welcome: 'Welcome' };

    await saveTranslationCache('en', 'common', translations);

    expect(storage.set).toHaveBeenCalledWith(
      'translations',
      'en-common',
      { version: pyxisEnv.version, data: translations },
      { ttl: 7 * 24 * 60 * 60 * 1000 }
    );
  });

  it('discards cache entries written by a different build version', async () => {
    storage.get.mockResolvedValue({ version: '0.9.0', data: { welcome: 'Old' } });

    await expect(loadTranslationCache('en', 'common')).resolves.toBeNull();

    expect(storage.delete).toHaveBeenCalledWith('translations', 'en-common');
  });

  it('returns entries written by the current build version', async () => {
    const translations = { welcome: 'Current' };
    storage.get.mockResolvedValue({ version: pyxisEnv.version, data: translations });

    await expect(loadTranslationCache('en', 'common')).resolves.toBe(translations);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('discards cache entries with an invalid translation dictionary', async () => {
    storage.get.mockResolvedValue({ version: pyxisEnv.version, data: ['invalid'] });

    await expect(loadTranslationCache('en', 'common')).resolves.toBeNull();

    expect(storage.delete).toHaveBeenCalledWith('translations', 'en-common');
  });
});
