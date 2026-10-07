import { describe, expect, it } from 'vitest';
import { classifyFileContent, detectFileContent } from '@/engine/core/fileBytes';

describe('file byte classification', () => {
  it('preserves UTF-8 BOM and valid empty text', async () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 65]);
    expect(await detectFileContent('source.txt', bytes)).toEqual({
      kind: 'text',
      content: '\ufeffA',
    });
    expect(await detectFileContent('empty.txt', new Uint8Array())).toEqual({
      kind: 'text',
      content: '',
    });
  });

  it('preserves only the supplied subview of misleading text bytes', async () => {
    const full = Uint8Array.from([9, 0xff, 0, 8]);
    const file = await detectFileContent('source.txt', full.subarray(1, 3));
    expect(file.kind).toBe('binary');
    if (file.kind !== 'binary') throw new Error('Expected binary content');
    expect(new Uint8Array(file.bufferContent)).toEqual(Uint8Array.from([0xff, 0]));
  });

  it('recognizes image signatures under unrelated extensions', async () => {
    const bytes = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const file = await detectFileContent('image.dat', bytes);
    expect(file.kind).toBe('binary');
    if (file.kind !== 'binary') throw new Error('Expected binary content');
    expect(new Uint8Array(file.bufferContent)).toEqual(bytes);
  });

  it.each(['avif', 'woff2', 'docx', 'sqlite'])('keeps known %s formats binary', extension => {
    expect(classifyFileContent(`file.${extension}`, new Uint8Array()).kind).toBe('binary');
  });
});
