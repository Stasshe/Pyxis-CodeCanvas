import { describe, expect, it } from 'vitest';
import { markEditResponseFileApplied } from '@/hooks/ai/markEditResponseApplied';

describe('markEditResponseFileApplied', () => {
  it('marks only the applied file so chat rollback can restore its original content', () => {
    const response = {
      message: 'Edits suggested',
      changedFiles: [
        {
          path: '/project/a.ts',
          originalContent: 'before a',
          suggestedContent: 'after a',
          explanation: 'Update a',
        },
        {
          path: '/project/b.ts',
          originalContent: 'before b',
          suggestedContent: 'after b',
          explanation: 'Update b',
        },
      ],
    };

    const result = markEditResponseFileApplied(
      response,
      '/project/a.ts',
      'before a',
      'reviewed after a'
    );

    expect(result.changedFiles[0]).toEqual({
      ...response.changedFiles[0],
      applied: true,
      appliedContent: 'reviewed after a',
    });
    expect(result.changedFiles[1]).toEqual(response.changedFiles[1]);
    expect(result.changedFiles[0].originalContent).toBe('before a');
  });
});
