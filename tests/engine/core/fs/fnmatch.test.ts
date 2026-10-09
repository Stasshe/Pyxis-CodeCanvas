import { describe, expect, it } from 'vitest';
import {
  FNM_NOESCAPE,
  FNM_NOMATCH,
  FNM_PATHNAME,
  FNM_PERIOD,
  fnmatch,
  fnmatchToRegExp,
} from '@/engine/core/fs/fnmatch';

describe('fnmatch Unicode characters', () => {
  it('matches astral code points with ? and character classes', () => {
    expect(fnmatch('?', '😀')).toBe(0);
    expect(fnmatch('[😀]', '😀')).toBe(0);
    expect(fnmatch('??', '😀')).toBe(FNM_NOMATCH);
    expect(fnmatchToRegExp('?').test('😀')).toBe(true);
    expect(fnmatchToRegExp('[😀]').test('😀')).toBe(true);
  });

  it('preserves pathname, period, and escaping rules', () => {
    expect(fnmatch('?', '/', FNM_PATHNAME)).toBe(FNM_NOMATCH);
    expect(fnmatch('[/]', '/', FNM_PATHNAME)).toBe(FNM_NOMATCH);
    expect(fnmatch('*', '.hidden', FNM_PERIOD)).toBe(FNM_NOMATCH);
    expect(fnmatch('\\.hidden', '.hidden', FNM_PERIOD)).toBe(0);
    expect(fnmatch('[.]hidden', '.hidden', FNM_PERIOD)).toBe(FNM_NOMATCH);
    expect(fnmatch('?.hidden', '.hidden', FNM_PERIOD)).toBe(FNM_NOMATCH);
    expect(fnmatch('\\?', '?')).toBe(0);
    expect(fnmatch('\\?', '?', FNM_NOESCAPE)).toBe(FNM_NOMATCH);
    expect(fnmatch('😀/x', '😀/x', FNM_PATHNAME)).toBe(0);
  });

  it('matches Unicode Alphabetic characters in the POSIX alpha class', () => {
    for (const letter of ['é', 'Ａ', '中']) {
      expect(fnmatch('[[:alpha:]]', letter)).toBe(0);
      expect(fnmatchToRegExp('[[:alpha:]]').test(letter)).toBe(true);
    }

    for (const nonLetter of ['7', '😀']) {
      expect(fnmatch('[[:alpha:]]', nonLetter)).toBe(FNM_NOMATCH);
      expect(fnmatchToRegExp('[[:alpha:]]').test(nonLetter)).toBe(false);
    }
  });

  it('treats an unclosed character class as literal text', () => {
    expect(fnmatch('[a', 'a')).toBe(FNM_NOMATCH);
    expect(fnmatch('[a', '[a')).toBe(0);
    expect(fnmatchToRegExp('[a').test('a')).toBe(false);
    expect(fnmatchToRegExp('[a').test('[a')).toBe(true);
    expect(fnmatch('[a-z]', 'm')).toBe(0);
    expect(fnmatch('[]a]', ']')).toBe(0);
    expect(fnmatchToRegExp('[]a]').test(']')).toBe(true);
  });
});
