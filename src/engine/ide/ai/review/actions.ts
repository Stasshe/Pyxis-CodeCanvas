import type { AIReviewEntry } from '@/types/index';

type RollbackEntry = Pick<AIReviewEntry, 'status' | 'originalSnapshot'>;

export function canRollbackAIReview(
  entry: RollbackEntry | null
): entry is RollbackEntry & { status: 'applied'; originalSnapshot: string } {
  return entry?.status === 'applied' && typeof entry.originalSnapshot === 'string';
}
