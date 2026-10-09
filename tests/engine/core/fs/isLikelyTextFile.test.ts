import { describe, expect, it } from 'vitest';

import { isLikelyTextFile } from '@/engine/core/fs/isLikelyTextFile';

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

  it('classifies SVG files from their bytes', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    expect(await isLikelyTextFile('image.svg', svg)).toBe(true);
    expect(await isLikelyTextFile('nul.svg', new Uint8Array([0x3c, 0x00, 0x3e]))).toBe(false);
    expect(await isLikelyTextFile('invalid.svg', new Uint8Array([0xff, 0xfe]))).toBe(false);
  });

  it('detects unknown binary and text files from their content', async () => {
    expect(await isLikelyTextFile('data.unknown', new Uint8Array([0, 255]))).toBe(false);
    expect(await isLikelyTextFile('notes.unknown', new TextEncoder().encode('hello'))).toBe(true);
  });
});
