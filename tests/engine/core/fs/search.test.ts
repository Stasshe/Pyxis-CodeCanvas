import { beforeEach, describe, expect, it } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { type SearchOptions, searchFiles } from '@/engine/core/fs/search';

const defaults: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  searchInFilenames: false,
  useIgnoreFiles: false,
};

describe('worker filesystem search', () => {
  let core: FsCore;
  beforeEach(async () => {
    core = new FsCore();
    await core.mkdir('/tmp/app/src', { recursive: true });
  });
  async function search(query: string, options: Partial<SearchOptions> = {}) {
    return searchFiles(core, '/tmp/app', { query, options: { ...defaults, ...options } });
  }

  it('treats punctuation and backslashes as literal text', async () => {
    await core.writeFile('/tmp/app/src/text.txt', 'a.b axb [ bracket \\ slash');
    expect((await search('a.b')).map(match => match.matchStart)).toEqual([0]);
    expect(await search('[')).toHaveLength(1);
    expect(await search('\\')).toHaveLength(1);
  });

  it('matches word boundaries and case independently', async () => {
    await core.writeFile('/tmp/app/src/text.txt', 'cat scatter CAT\ncat');
    expect(await search('cat', { wholeWord: true })).toHaveLength(3);
    expect(await search('cat', { wholeWord: true, caseSensitive: true })).toHaveLength(2);
    expect(await search('cat', { caseSensitive: true })).toHaveLength(3);
  });

  it('supports regular expressions and terminates zero-width matches', async () => {
    await core.writeFile('/tmp/app/src/text.txt', 'a1 b2');
    expect(await search('[ab]\\d', { useRegex: true })).toHaveLength(2);
    expect(await search('^', { useRegex: true })).toHaveLength(1);
  });

  it('excludes nested directories with globstar and filename character patterns', async () => {
    await core.mkdir('/tmp/app/node_modules/pkg', { recursive: true });
    await core.mkdir('/tmp/app/src/node_modules/pkg', { recursive: true });
    await core.writeFile('/tmp/app/node_modules/pkg/a.txt', 'needle');
    await core.writeFile('/tmp/app/src/node_modules/pkg/b.txt', 'needle');
    await core.writeFile('/tmp/app/src/a.txt', 'needle');
    await core.writeFile('/tmp/app/src/b.txt', 'needle');
    const matches = await search('needle', { excludeGlobs: ['**/node_modules/**', '**/[a].txt'] });
    expect(matches.map(match => match.file.path)).toEqual(['/tmp/app/src/b.txt']);
  });

  it('treats an excluded directory pattern as excluding its descendants', async () => {
    await core.mkdir('/tmp/app/node_modules/pkg', { recursive: true });
    await core.writeFile('/tmp/app/node_modules/pkg/index.js', 'needle');
    await core.writeFile('/tmp/app/src/keep.js', 'needle');

    const matches = await search('needle', { excludeGlobs: ['**/node_modules'] });

    expect(matches.map(match => match.file.path)).toEqual(['/tmp/app/src/keep.js']);
  });

  it('honors the configured .gitignore toggle', async () => {
    await core.writeFile('/tmp/app/.gitignore', 'ignored.txt\nignored-dir/');
    await core.mkdir('/tmp/app/ignored-dir', { recursive: true });
    await core.writeFile('/tmp/app/ignored.txt', 'needle');
    await core.writeFile('/tmp/app/ignored-dir/nested.txt', 'needle');
    await core.writeFile('/tmp/app/kept.txt', 'needle');

    const ignored = await search('needle', { useIgnoreFiles: true });
    const included = await search('needle');

    expect(ignored.map(match => match.file.path)).toEqual(['/tmp/app/kept.txt']);
    expect(included).toHaveLength(3);
  });

  it('skips a FIFO .gitignore without waiting for a writer', async () => {
    await core.mkfifo('/tmp/app/.gitignore');
    await core.writeFile('/tmp/app/src/text.txt', 'needle');

    const matches = await search('needle', { useIgnoreFiles: true });

    expect(matches.map(match => match.file.path)).toEqual(['/tmp/app/src/text.txt']);
    expect(await core.stat('/tmp/app/.gitignore')).toMatchObject({ type: 'fifo', size: 0 });
  });

  it('skips FIFO entries when searching contents and filenames', async () => {
    await core.mkfifo('/tmp/app/src/needle-pipe');
    await core.openFifo('/tmp/app/src/needle-pipe', 'readwrite', 'pipe', 'search-owner');
    await core.writeFifo('pipe', new Uint8Array([7]));
    await core.writeFile('/tmp/app/src/text.txt', 'needle');
    try {
      const matches = await search('needle', { searchInFilenames: true });

      expect(matches.map(match => match.file.path)).toEqual(['/tmp/app/src/text.txt']);
      expect(await core.readFifo('pipe', 1)).toEqual(new Uint8Array([7]));
    } finally {
      await core.closeFifo('pipe');
    }
  });

  it('scopes nested ignores and preserves unrestricted searches', async () => {
    await core.writeFile('/tmp/app/.gitignore', '*.txt\n');
    await core.writeFile('/tmp/app/src/.gitignore', '!keep.txt\nignored/\n');
    await core.writeFile('/tmp/app/src/keep.txt', 'needle');
    await core.writeFile('/tmp/app/src/drop.txt', 'needle');
    await core.writeFile('/tmp/app/src/ignored', 'needle');
    await core.mkdir('/tmp/app/.git');
    await core.writeFile('/tmp/app/.git/config', 'needle');
    await core.mkdir('/tmp/app/node_modules');
    await core.writeFile('/tmp/app/node_modules/package.js', 'needle');
    expect(
      (await search('needle', { useIgnoreFiles: true })).map(match => match.file.path)
    ).toEqual([
      '/tmp/app/.git/config',
      '/tmp/app/node_modules/package.js',
      '/tmp/app/src/ignored',
      '/tmp/app/src/keep.txt',
    ]);
    expect(await search('needle')).toHaveLength(5);
  });

  it('scopes nested globstar ignores to their .gitignore directory', async () => {
    await core.mkdir('/tmp/app/src/deep', { recursive: true });
    await core.mkdir('/tmp/app/other', { recursive: true });
    await core.writeFile('/tmp/app/src/.gitignore', '**/generated.txt\n');
    await core.writeFile('/tmp/app/src/generated.txt', 'needle');
    await core.writeFile('/tmp/app/src/deep/generated.txt', 'needle');
    await core.writeFile('/tmp/app/other/generated.txt', 'needle');

    const matches = await search('needle', { useIgnoreFiles: true });

    expect(matches.map(match => match.file.path)).toEqual(['/tmp/app/other/generated.txt']);
  });

  it('returns filename matches as line zero and ignores binary contents', async () => {
    await core.writeFile('/tmp/app/src/needle.txt', 'needle\nsecond needle');
    await core.writeFile('/tmp/app/src/image.png', new TextEncoder().encode('needle'));
    const matches = await search('needle', { searchInFilenames: true });
    expect(matches.map(match => match.line)).toEqual([0, 1, 2]);
    expect(matches.every(match => match.file.path.endsWith('needle.txt'))).toBe(true);
    expect(matches[2]).toMatchObject({ column: 8, matchStart: 7, matchEnd: 13 });
  });

  it('classifies invalid UTF-8 and binary signatures before scanning contents', async () => {
    await core.writeFile('/tmp/app/src/needle-invalid.txt', new Uint8Array([0xff, 0xfe]));
    await core.writeFile('/tmp/app/src/needle-nul.txt', new Uint8Array([0x6e, 0x00, 0x65]));
    await core.writeFile(
      '/tmp/app/src/needle-document.dat',
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65])
    );

    const matches = await search('needle', { searchInFilenames: true });

    expect(matches.map(match => match.file.path)).toEqual([
      '/tmp/app/src/needle-document.dat',
      '/tmp/app/src/needle-invalid.txt',
      '/tmp/app/src/needle-nul.txt',
    ]);
    expect(matches.map(match => match.line)).toEqual([0, 0, 0]);
  });
});
