import { describe, expect, it } from 'vitest';

import { canRollbackAIReview } from '@/components/AI/AIReview/aiReviewActions';

describe('canRollbackAIReview', () => {
  it('allows rollback when the saved original snapshot is empty', () => {
    const entry = { status: 'applied', originalSnapshot: '' };

    if (canRollbackAIReview(entry)) {
      expect(entry.originalSnapshot).toBe('');
    } else {
      expect.fail('An empty original snapshot is still rollbackable.');
    }
  });

  it('requires an applied entry with a string snapshot', () => {
    expect(canRollbackAIReview({ status: 'pending', originalSnapshot: 'before' })).toBe(false);
    expect(canRollbackAIReview(null)).toBe(false);
  });
});
