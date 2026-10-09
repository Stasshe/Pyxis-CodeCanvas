import { describe, expect, it } from 'vitest';
import { moveHistory } from '@/components/Bottom/terminalHistory';

describe('moveHistory', () => {
  it('saves and restores the line draft around history navigation', () => {
    const history = ['first', 'second'];
    const selected = moveHistory(history, { index: -1, draft: '', line: 'draft' }, 'up');
    expect(selected).toEqual({ index: 1, draft: 'draft', line: 'second' });
    expect(moveHistory(history, selected, 'down')).toEqual({
      index: -1,
      draft: 'draft',
      line: 'draft',
    });
  });

  it('keeps the newest item selected when moving up again', () => {
    expect(moveHistory(['first'], { index: 0, draft: 'draft', line: 'first' }, 'up')).toEqual({
      index: 0,
      draft: 'draft',
      line: 'first',
    });
  });
});
