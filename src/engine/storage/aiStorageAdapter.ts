import { STORES, storageService } from '@/engine/storage';
import type { AIReviewEntry, AIReviewHistoryEntry } from '@/types';

/**
 * Simple adapter to persist AI review metadata using storageService.
 * Stores entries under `AI_REVIEWS` using the workspace root and absolute file path.
 */
export async function saveAIReviewEntry(
  rootPath: string,
  filePath: string,
  originalContent: string,
  suggestedContent: string,
  meta?: { message?: string; parentMessageId?: string }
): Promise<void> {
  const key = `aiReview:${rootPath}:${filePath}`;

  const existing = (await storageService.get(STORES.AI_REVIEWS, key)) as AIReviewEntry | null;

  const historyEntry: AIReviewHistoryEntry = {
    id: `airev-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    timestamp: new Date(),
    content: originalContent,
    note: meta?.message,
  };

  const payload: AIReviewEntry = {
    rootPath,
    filePath,
    suggestedContent,
    originalSnapshot: originalContent,
    status: 'pending',
    comments: meta?.message,
    parentMessageId: meta?.parentMessageId,
    history:
      existing && Array.isArray(existing.history)
        ? [historyEntry, ...existing.history]
        : [historyEntry],
    updatedAt: Date.now(),
  };

  await storageService.set(STORES.AI_REVIEWS, key, payload, { cache: false });
  console.log('[aiStorageAdapter] Saved AI review entry:', key);
}

export async function clearAIReviewEntry(rootPath: string, filePath: string): Promise<void> {
  const key = `aiReview:${rootPath}:${filePath}`;
  await storageService.delete(STORES.AI_REVIEWS, key);
}

export async function getAIReviewEntry(
  rootPath: string,
  filePath: string
): Promise<AIReviewEntry | null> {
  const key = `aiReview:${rootPath}:${filePath}`;
  return (await storageService.get(STORES.AI_REVIEWS, key)) as AIReviewEntry | null;
}

export async function updateAIReviewEntry(
  rootPath: string,
  filePath: string,
  patch: Partial<AIReviewEntry>
): Promise<AIReviewEntry | null> {
  const key = `aiReview:${rootPath}:${filePath}`;
  const existing = (await storageService.get(STORES.AI_REVIEWS, key)) as AIReviewEntry | null;
  if (!existing) return null;
  const updated: AIReviewEntry = { ...existing, ...patch, updatedAt: Date.now() };
  await storageService.set(STORES.AI_REVIEWS, key, updated, { cache: false });
  return updated;
}
