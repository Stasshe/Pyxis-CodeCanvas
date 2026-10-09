import { describe, expect, it } from 'vitest';
import { createTranslator, mergeTranslations } from '@/engine/i18n/translator';

describe('createTranslator', () => {
  it('preserves an explicitly empty fallback or default value', () => {
    const t = createTranslator({});

    expect(t('missing', { fallback: '' })).toBe('');
    expect(t('missing', { defaultValue: '' })).toBe('');
    expect(t('missing', { fallback: '', defaultValue: 'default' })).toBe('');
  });

  it('does not treat inherited object properties as translation keys', () => {
    const t = createTranslator({});

    expect(t('constructor.name')).toBe('constructor.name');
  });
});

describe('mergeTranslations', () => {
  it('preserves nested keys when namespaces define the same parent object', () => {
    const merged = mergeTranslations(
      { welcome: { devServer: { warning: 'Development' }, title: 'Welcome' } },
      { welcome: { devServer: { stableVersion: 'Stable' } } }
    );

    expect(merged).toEqual({
      welcome: {
        devServer: { warning: 'Development', stableVersion: 'Stable' },
        title: 'Welcome',
      },
    });
  });

  it('lets later namespaces replace conflicting leaf values', () => {
    const merged = mergeTranslations(
      { welcome: { title: 'First' } },
      { welcome: { title: 'Last' } }
    );

    expect(merged).toEqual({ welcome: { title: 'Last' } });
  });
});
