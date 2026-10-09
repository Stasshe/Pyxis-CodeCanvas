import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIReviewEntry } from '@/types';

const state = vi.hoisted(() => ({ entries: new Map<string, AIReviewEntry>() }));

vi.mock('@/engine/storage', () => ({
  STORES: { AI_REVIEWS: 'ai_reviews' },
  storageService: {
    get: async (_store: string, key: string) => state.entries.get(key) ?? null,
    set: async (_store: string, key: string, entry: AIReviewEntry) => {
      state.entries.set(key, structuredClone(entry));
    },
    delete: async (_store: string, key: string) => {
      state.entries.delete(key);
    },
  },
}));

import {
  clearAIReviewEntry,
  getAIReviewEntry,
  saveAIReviewEntry,
  updateAIReviewEntry,
} from '@/engine/storage/aiStorageAdapter';

describe('AI review storage adapter', () => {
  beforeEach(() => state.entries.clear());

  it('retains history when reviews for the same file save concurrently', async () => {
    await Promise.all([
      saveAIReviewEntry('/workspace', '/workspace/file.ts', 'first', 'suggestion one'),
      saveAIReviewEntry('/workspace', '/workspace/file.ts', 'second', 'suggestion two'),
    ]);

    const entry = await getAIReviewEntry('/workspace', '/workspace/file.ts');
    expect(entry?.history.map(history => history.content)).toEqual(['second', 'first']);
    expect(entry?.suggestedContent).toBe('suggestion two');
  });

  it('keeps review history isolated by workspace root', async () => {
    await Promise.all([
      saveAIReviewEntry('/workspace/one', '/workspace/one/file.ts', 'one', 'one suggestion'),
      saveAIReviewEntry('/workspace/two', '/workspace/two/file.ts', 'two', 'two suggestion'),
    ]);

    const firstWorkspaceEntry = await getAIReviewEntry('/workspace/one', '/workspace/one/file.ts');
    const secondWorkspaceEntry = await getAIReviewEntry('/workspace/two', '/workspace/two/file.ts');
    expect(firstWorkspaceEntry?.history[0].content).toBe('one');
    expect(secondWorkspaceEntry?.history[0].content).toBe('two');
  });

  it('succeeds when a guarded clear finds no review entry', async () => {
    const rootPath = '/workspace';
    const filePath = '/workspace/file.ts';

    await expect(clearAIReviewEntry(rootPath, filePath, 'message-1')).resolves.toBeUndefined();
    await expect(getAIReviewEntry(rootPath, filePath)).resolves.toBeNull();
  });

  it('keeps a newer review when an old parent attempts to clear it', async () => {
    const rootPath = '/workspace';
    const filePath = '/workspace/file.ts';
    await saveAIReviewEntry(rootPath, filePath, 'old source', 'old suggestion', {
      parentMessageId: 'old-message',
    });
    await saveAIReviewEntry(rootPath, filePath, 'new source', 'new suggestion', {
      parentMessageId: 'new-message',
    });

    await expect(clearAIReviewEntry(rootPath, filePath, 'old-message')).rejects.toThrow(
      'different source message'
    );

    const entry = await getAIReviewEntry(rootPath, filePath);
    expect(entry?.parentMessageId).toBe('new-message');
    expect(entry?.suggestedContent).toBe('new suggestion');
  });

  it('merges concurrent history updates against the latest entry', async () => {
    const rootPath = '/workspace';
    const filePath = '/workspace/file.ts';
    await saveAIReviewEntry(rootPath, filePath, 'initial', 'suggestion');

    await Promise.all(
      ['first update', 'second update'].map(content =>
        updateAIReviewEntry(rootPath, filePath, entry => ({
          history: [
            {
              id: content,
              timestamp: new Date(),
              content,
            },
            ...entry.history,
          ],
        }))
      )
    );

    const entry = await getAIReviewEntry(rootPath, filePath);
    expect(entry?.history.map(history => history.content)).toEqual([
      'second update',
      'first update',
      'initial',
    ]);
  });
});
