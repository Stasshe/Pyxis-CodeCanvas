import { describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from '@/engine/runtime/nodejs/modules/urlModule';

describe('POSIX file URL conversion', () => {
  it('round-trips reserved characters and literal backslashes in a filename', () => {
    const path = '/work/a?b#c%d\\e:f';
    const url = pathToFileURL(path);

    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(fileURLToPath(url)).toBe(path);
  });

  it('rejects file URLs with a remote host', () => {
    expect(() => fileURLToPath('file://example.com/work/file')).toThrow(TypeError);
  });
});
