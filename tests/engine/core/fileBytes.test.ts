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

  it.each([
    ['document.xml', '<?xml version="1.0"?><root/>'],
    ['image.svg', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['document.rtf', '{\\rtf1\\ansi Hello}'],
    ['document.ps', '%!PS-Adobe-3.0\nshowpage'],
  ])('keeps detected textual %s formats editable', async (path, content) => {
    expect(await detectFileContent(path, new TextEncoder().encode(content))).toEqual({
      kind: 'text',
      content,
    });
  });

  it('still rejects invalid UTF-8 and NUL in textual MIME formats', () => {
    for (const bytes of [new Uint8Array([0xff]), new Uint8Array([65, 0])]) {
      expect(classifyFileContent('document.xml', bytes, 'application/xml').kind).toBe('binary');
    }
  });
});
