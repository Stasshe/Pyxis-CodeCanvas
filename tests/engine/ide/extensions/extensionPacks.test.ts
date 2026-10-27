import { describe, expect, it } from 'vitest';
import { processAvailableExtensions } from '@/engine/ide/extensions/extensionPacks';
import { type ExtensionManifest, ExtensionType } from '@/engine/ide/extensions/types';

function manifest(
  id: string,
  name: string,
  packGroup?: ExtensionManifest['packGroup']
): ExtensionManifest {
  return {
    id,
    name,
    version: '1.0.0',
    type: ExtensionType.UI,
    description: `${name} extension`,
    author: 'Pyxis',
    entry: 'index.ts',
    packGroup,
  };
}

describe('ExtensionsPanel data helpers', () => {
  it('filters group members and returns matching packs for automatic expansion', () => {
    const results = processAvailableExtensions(
      [
        manifest('pyxis.lang.en', 'English', { id: 'languages', name: 'Languages' }),
        manifest('pyxis.lang.ja', 'Japanese', { id: 'languages', name: 'Languages' }),
        manifest('pyxis.tool', 'Tool'),
      ],
      'Japanese'
    );

    expect(results.packs).toHaveLength(1);
    expect(results.packs[0]?.extensions.map(extension => extension.id)).toEqual(['pyxis.lang.ja']);
    expect(results.others).toEqual([]);
    expect(results.packsToExpand).toEqual(['languages-available']);
  });

  it('keeps complete pack members so the panel can render a localized count', () => {
    const results = processAvailableExtensions(
      [
        manifest('pyxis.lang.en', 'English', { id: 'languages', name: 'Languages' }),
        manifest('pyxis.lang.ja', 'Japanese', { id: 'languages', name: 'Languages' }),
      ],
      ''
    );
    const [pack] = results.packs;

    expect(pack?.extensions.map(extension => extension.id)).toEqual([
      'pyxis.lang.en',
      'pyxis.lang.ja',
    ]);
    expect(pack?.extensions).toHaveLength(2);
    expect(results.others).toEqual([]);
    expect(results.packsToExpand).toEqual([]);
  });
});
