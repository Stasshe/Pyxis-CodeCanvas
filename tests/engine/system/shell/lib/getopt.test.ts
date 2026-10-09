import { describe, expect, it } from 'vitest';
import { parseWithGetOpt } from '@/engine/system/shell/lib/getopt';

describe('parseWithGetOpt', () => {
  it('preserves option order and consumes a negative required long argument', () => {
    const parsed = parseWithGetOpt(['--lines', '-2', '-v', '--quiet', '--', '-5'], 'v', [
      'lines=',
      'quiet',
    ]);

    expect(parsed.orderedOptions).toEqual([
      { option: 'lines', argument: '-2' },
      { option: 'v', argument: null },
      { option: 'quiet', argument: null },
    ]);
    expect(parsed.positional).toEqual(['-5']);
    expect(parsed.errors).toEqual([]);
  });
});
