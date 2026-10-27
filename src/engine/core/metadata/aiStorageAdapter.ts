import { STORES, storageService } from '@/engine/core/metadata/index';
import type { AIReviewEntry, AIReviewHistoryEntry } from '@/types/index';

const pendingWrites = new Map<string, Promise<void>>();

function serializeWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(write);
  const settled = operation.then(
    () => undefined,
    () => undefined
  );
  pendingWrites.set(key, settled);
  void settled.then(() => {
    if (pendingWrites.get(key) === settled) pendingWrites.delete(key);
  });
  return operation;
}

async function waitForWrite(key: string): Promise<void> {
  await pendingWrites.get(key);
}

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

  await serializeWrite(key, async () => {
    const existing = await storageService.get<AIReviewEntry>(STORES.AI_REVIEWS, key);

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
  });
}

export async function clearAIReviewEntry(
  rootPath: string,
  filePath: string,
  expectedParentMessageId?: string
): Promise<void> {
  const key = `aiReview:${rootPath}:${filePath}`;
  await serializeWrite(key, async () => {
    if (expectedParentMessageId !== undefined) {
      const existing = await storageService.get<AIReviewEntry>(STORES.AI_REVIEWS, key);
      if (!existing) return;
      if (existing.parentMessageId !== expectedParentMessageId) {
        throw new Error('AI review metadata belongs to a different source message.');
      }
    }
    await storageService.delete(STORES.AI_REVIEWS, key);
  });
}

export async function getAIReviewEntry(
  rootPath: string,
  filePath: string
): Promise<AIReviewEntry | null> {
  const key = `aiReview:${rootPath}:${filePath}`;
  await waitForWrite(key);
  return storageService.get<AIReviewEntry>(STORES.AI_REVIEWS, key);
}

export async function updateAIReviewEntry(
  rootPath: string,
  filePath: string,
  update: Partial<AIReviewEntry> | ((existing: AIReviewEntry) => Partial<AIReviewEntry>)
): Promise<AIReviewEntry | null> {
  const key = `aiReview:${rootPath}:${filePath}`;
  return serializeWrite(key, async () => {
    const existing = await storageService.get<AIReviewEntry>(STORES.AI_REVIEWS, key);
    if (!existing) return null;
    const patch = typeof update === 'function' ? update(existing) : update;
    const updated: AIReviewEntry = { ...existing, ...patch, updatedAt: Date.now() };
    await storageService.set(STORES.AI_REVIEWS, key, updated, { cache: false });
    return updated;
  });
}
