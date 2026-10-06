import { beforeEach, describe, expect, it } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { type SearchOptions, searchFiles } from '@/engine/core/fs/search';

const defaults: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  searchInFilenames: false,
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

  it('returns filename matches as line zero and ignores binary contents', async () => {
    await core.writeFile('/tmp/app/src/needle.txt', 'needle\nsecond needle');
    await core.writeFile('/tmp/app/src/image.png', new TextEncoder().encode('needle'));
    const matches = await search('needle', { searchInFilenames: true });
    expect(matches.map(match => match.line)).toEqual([0, 1, 2]);
    expect(matches.every(match => match.file.path.endsWith('needle.txt'))).toBe(true);
    expect(matches[2]).toMatchObject({ column: 8, matchStart: 7, matchEnd: 13 });
  });
});
