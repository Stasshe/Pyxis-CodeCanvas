import { describe, expect, it } from 'vitest';

import { isLikelyTextFile } from '@/engine/helper/isLikelyTextFile';

describe('isLikelyTextFile', () => {
  it.each([
    'doc',
    'docx',
    'docm',
    'dotx',
    'xls',
    'xlsx',
    'xlsm',
    'xlsb',
    'ppt',
    'pptx',
    'pptm',
    'ppsx',
    'odt',
    'ods',
    'odp',
    'odg',
  ])('treats .%s files as binary regardless of content', async extension => {
    expect(await isLikelyTextFile(`document.${extension}`, new Uint8Array())).toBe(false);
    expect(
      await isLikelyTextFile(`DOCUMENT.${extension.toUpperCase()}`, new Uint8Array([65]))
    ).toBe(false);
  });

  it('always treats SVG files as text', async () => {
    const binaryLookingContent = new Uint8Array([0, 1, 2]);

    expect(await isLikelyTextFile('image.svg', binaryLookingContent)).toBe(true);
    expect(await isLikelyTextFile('IMAGE.SVG', new Uint8Array())).toBe(true);
  });

  it('detects unknown binary and text files from their content', async () => {
    expect(await isLikelyTextFile('data.unknown', new Uint8Array([0, 255]))).toBe(false);
    expect(await isLikelyTextFile('notes.unknown', new TextEncoder().encode('hello'))).toBe(true);
  });
});
