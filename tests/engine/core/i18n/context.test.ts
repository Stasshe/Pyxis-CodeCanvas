import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider, useI18n } from '@/context/I18nContext';

describe('I18nProvider translation loading', () => {
  it('returns an explicitly empty fallback while translations are loading', () => {
    function Probe() {
      const { t } = useI18n();
      return createElement('span', null, t('missing', { fallback: '' }));
    }

    const html = renderToString(createElement(I18nProvider, null, createElement(Probe)));

    expect(html).toBe('<span></span>');
  });
});
