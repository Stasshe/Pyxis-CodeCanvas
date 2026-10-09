import { describe, expect, it } from 'vitest';
import { graphemes, nextColumn, normalizeColumn, previousColumn } from '@/engine/cmd/app/vim/text';

describe('vim text columns', () => {
  it('moves across grapheme boundaries while returning UTF-16 offsets', () => {
    const text = 'Ae\u0301👩‍💻Z';
    expect(nextColumn(text, 0)).toBe(1);
    expect(nextColumn(text, 1)).toBe(3);
    expect(nextColumn(text, 3)).toBe(8);
    expect(previousColumn(text, 8)).toBe(3);
    expect(previousColumn(text, 3)).toBe(1);
  });

  it('normalizes offsets inside a grapheme to its start', () => {
    expect(normalizeColumn('e\u0301x', 1, false)).toBe(0);
    expect(normalizeColumn('👩‍💻x', 4, true)).toBe(0);
    expect(normalizeColumn('👩‍💻x', 5, true)).toBe(5);
  });

  it('clamps normal mode to the final grapheme and insert mode to end of line', () => {
    expect(normalizeColumn('a😀', 99, false)).toBe(1);
    expect(normalizeColumn('a😀', 99, true)).toBe(3);
    expect(normalizeColumn('', 5, false)).toBe(0);
    expect(nextColumn('a😀', 3)).toBe(3);
    expect(previousColumn('', 0)).toBe(0);
  });

  it('exposes source offsets for renderer mapping', () => {
    expect(graphemes('A😀')).toEqual([
      { value: 'A', start: 0, end: 1 },
      { value: '😀', start: 1, end: 3 },
    ]);
  });
});
