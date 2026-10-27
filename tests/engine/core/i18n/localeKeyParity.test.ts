import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const localeDirectory = fileURLToPath(new URL('../../../../locales/', import.meta.url));
const extensionsPanelSource = fileURLToPath(
  new URL('../../../../src/components/extensions/ExtensionsPanel.tsx', import.meta.url)
);

function flattenStrings(value: unknown, prefix = ''): Map<string, string> {
  if (typeof value === 'string') return new Map([[prefix, value]]);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected a translation object at ${prefix || '<root>'}`);
  }

  const entries = Object.entries(value).flatMap(([key, child]) => [
    ...flattenStrings(child, prefix ? `${prefix}.${key}` : key),
  ]);
  return new Map(entries);
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
}

describe('locale common dictionaries', () => {
  it('keeps every locale aligned with the extensions panel translation keys', () => {
    const english = flattenStrings(
      JSON.parse(readFileSync(`${localeDirectory}/en/common.json`, 'utf8'))
    );
    const englishPanel = new Map(
      [...english].filter(([key]) => key.startsWith('extensionsPanel.'))
    );
    const sourceKeys = new Set(
      [
        ...readFileSync(extensionsPanelSource, 'utf8').matchAll(
          /['"](extensionsPanel(?:\.[A-Za-z]+)+)['"]/g
        ),
      ].map(match => match[1])
    );
    for (const key of sourceKeys) expect(englishPanel.has(key), key).toBe(true);
    const localeDirectories = readdirSync(localeDirectory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'en')
      .map(entry => entry.name);

    for (const locale of localeDirectories) {
      const translations = flattenStrings(
        JSON.parse(readFileSync(`${localeDirectory}/${locale}/common.json`, 'utf8'))
      );
      const panelTranslations = new Map(
        [...translations].filter(([key]) => key.startsWith('extensionsPanel.'))
      );
      expect([...panelTranslations.keys()].sort(), locale).toEqual([...englishPanel.keys()].sort());
      for (const key of sourceKeys)
        expect(panelTranslations.has(key), `${locale}:${key}`).toBe(true);
      expect(panelTranslations.get('extensionsPanel.loading'), locale).not.toBe(
        englishPanel.get('extensionsPanel.loading')
      );
      for (const [key, englishText] of englishPanel) {
        expect(placeholders(panelTranslations.get(key) ?? ''), `${locale}:${key}`).toEqual(
          placeholders(englishText)
        );
      }
    }
  });
});
