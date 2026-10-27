import { describe, expect, it, vi } from 'vitest';

import { activateEnglishPackOrLoadTranslations } from '@/engine/core/i18n/englishPackFallback';

describe('activateEnglishPackOrLoadTranslations', () => {
  it('loads English translations when installation returns null', async () => {
    const loadEnglish = vi.fn(async () => {});

    await activateEnglishPackOrLoadTranslations(
      async () => false,
      async () => true,
      loadEnglish
    );

    expect(loadEnglish).toHaveBeenCalledOnce();
  });

  it('loads English translations when enabling returns false', async () => {
    const loadEnglish = vi.fn(async () => {});

    await activateEnglishPackOrLoadTranslations(
      async () => true,
      async () => false,
      loadEnglish
    );

    expect(loadEnglish).toHaveBeenCalledOnce();
  });

  it('loads English translations when pack installation rejects', async () => {
    const loadEnglish = vi.fn(async () => {});

    await activateEnglishPackOrLoadTranslations(
      async () => {
        throw new Error('offline');
      },
      async () => true,
      loadEnglish
    );

    expect(loadEnglish).toHaveBeenCalledOnce();
  });

  it('does not load translations after the pack is enabled', async () => {
    const loadEnglish = vi.fn(async () => {});

    await activateEnglishPackOrLoadTranslations(
      async () => true,
      async () => true,
      loadEnglish
    );

    expect(loadEnglish).not.toHaveBeenCalled();
  });
});
