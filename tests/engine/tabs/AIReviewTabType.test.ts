import { describe, expect, it, vi } from 'vitest';
import { getAIReviewEntry, updateAIReviewEntry } from '@/engine/storage/aiStorageAdapter';
import { AIReviewTabType } from '@/engine/tabs/builtins/AIReviewTabType';
import type { AIReviewTab } from '@/engine/tabs/types';
import type { AIReviewEntry } from '@/types';

const { getAIReviewEntryMock, updateAIReviewEntryMock } = vi.hoisted(() => ({
  getAIReviewEntryMock: vi.fn(),
  updateAIReviewEntryMock: vi.fn(),
}));

vi.mock('@/engine/storage/aiStorageAdapter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/engine/storage/aiStorageAdapter')>();
  return {
    ...actual,
    getAIReviewEntry: getAIReviewEntryMock,
    updateAIReviewEntry: updateAIReviewEntryMock,
  };
});

function reviewTab(): AIReviewTab {
  return {
    id: 'ai:/project/file.txt',
    name: 'AI Review: file.txt',
    kind: 'ai',
    path: '/project/file.txt',
    paneId: 'pane-1',
    filePath: '/project/file.txt',
    originalContent: 'before',
    suggestedContent: 'edited suggestion',
  };
}

describe('AIReviewTabType session persistence', () => {
  it('flushes the latest draft and clears pending state only after storage confirms it', async () => {
    const tab = reviewTab();
    tab.aiEntry = {
      rootPath: '/project',
      filePath: '/project/file.txt',
      suggestedContent: 'older draft',
      originalSnapshot: 'before',
      status: 'pending',
      history: [],
      updatedAt: 1,
    };
    const persistedEntry = { ...tab.aiEntry, suggestedContent: tab.suggestedContent };
    updateAIReviewEntryMock.mockResolvedValue(persistedEntry);
    getAIReviewEntryMock.mockResolvedValue(persistedEntry);

    expect(AIReviewTabType.hasPendingChanges?.(tab)).toBe(true);
    await AIReviewTabType.flushPendingChanges?.(tab);

    expect(updateAIReviewEntry).toHaveBeenCalledWith(
      '/project',
      '/project/file.txt',
      expect.any(Function)
    );
    expect(getAIReviewEntry).toHaveBeenCalledWith('/project', '/project/file.txt');
    expect(AIReviewTabType.hasPendingChanges?.(tab)).toBe(false);
    AIReviewTabType.onClose?.(tab);
  });

  it('keeps the draft pending when storage cannot confirm the latest suggestion', async () => {
    const tab = reviewTab();
    tab.id = 'ai:/project/unconfirmed.txt';
    tab.aiEntry = {
      rootPath: '/project',
      filePath: '/project/file.txt',
      suggestedContent: 'older draft',
      originalSnapshot: 'before',
      status: 'pending',
      history: [],
      updatedAt: 1,
    };
    updateAIReviewEntryMock.mockResolvedValue(null);

    await expect(AIReviewTabType.flushPendingChanges!(tab)).rejects.toThrow(
      'The AI review suggestion could not be saved.'
    );
    expect(AIReviewTabType.hasPendingChanges?.(tab)).toBe(true);
    AIReviewTabType.onClose?.(tab);
  });

  it('does not overwrite a newer review when an old tab flushes its draft', async () => {
    const tab = reviewTab();
    tab.id = 'ai:/project/stale-parent.txt';
    const oldEntry: AIReviewEntry = {
      rootPath: '/project',
      filePath: '/project/file.txt',
      parentMessageId: 'message-old',
      suggestedContent: 'older draft',
      originalSnapshot: 'before',
      status: 'pending',
      history: [],
      updatedAt: 1,
    };
    tab.aiEntry = oldEntry;
    const metadataWrite = vi.fn();
    updateAIReviewEntryMock.mockImplementation(
      async (
        _rootPath: string,
        _filePath: string,
        update: Parameters<typeof updateAIReviewEntry>[2]
      ) => {
        const newerEntry: AIReviewEntry = {
          ...oldEntry,
          parentMessageId: 'message-new',
        };
        if (typeof update !== 'function') throw new Error('Expected a functional review update.');
        const patch = update(newerEntry);
        metadataWrite({ ...newerEntry, ...patch });
        return { ...newerEntry, ...patch };
      }
    );

    await expect(AIReviewTabType.flushPendingChanges!(tab)).rejects.toThrow(
      'This AI review belongs to a different source message and cannot be saved.'
    );
    expect(metadataWrite).not.toHaveBeenCalled();
    expect(AIReviewTabType.hasPendingChanges?.(tab)).toBe(true);
    AIReviewTabType.onClose?.(tab);
  });

  it('keeps a draft pending when readback has the same content under a newer parent', async () => {
    const tab = reviewTab();
    tab.id = 'ai:/project/readback-parent.txt';
    tab.aiEntry = {
      rootPath: '/project',
      filePath: '/project/file.txt',
      parentMessageId: 'message-old',
      suggestedContent: 'older draft',
      originalSnapshot: 'before',
      status: 'pending',
      history: [],
      updatedAt: 1,
    };
    updateAIReviewEntryMock.mockResolvedValue({
      ...tab.aiEntry,
      suggestedContent: tab.suggestedContent,
    });
    getAIReviewEntryMock.mockResolvedValue({
      ...tab.aiEntry,
      parentMessageId: 'message-new',
      suggestedContent: tab.suggestedContent,
    });

    await expect(AIReviewTabType.flushPendingChanges!(tab)).rejects.toThrow(
      'The latest AI review suggestion could not be confirmed in storage.'
    );
    expect(AIReviewTabType.hasPendingChanges?.(tab)).toBe(true);
    AIReviewTabType.onClose?.(tab);
  });

  it('keeps an untracked review pending when it cannot persist the draft', async () => {
    const tab = reviewTab();
    tab.id = 'ai:/project/untracked.txt';

    await expect(AIReviewTabType.flushPendingChanges!(tab)).rejects.toThrow(
      'This AI review has no workspace metadata and cannot save drafts.'
    );
    expect(AIReviewTabType.hasPendingChanges?.(tab)).toBe(true);
    AIReviewTabType.onClose?.(tab);
  });

  it('does not reuse pending state for a different review identity on the same tab id', () => {
    const tab = reviewTab();
    tab.id = 'ai:/project/reused.txt';
    tab.aiEntry = {
      rootPath: '/project-a',
      parentMessageId: 'message-a',
      filePath: '/project/reused.txt',
      suggestedContent: 'older draft',
      originalSnapshot: 'before',
      status: 'pending',
      history: [],
      updatedAt: 1,
    };
    expect(AIReviewTabType.hasPendingChanges?.(tab)).toBe(true);

    tab.aiEntry = {
      ...tab.aiEntry,
      rootPath: '/project-b',
      parentMessageId: 'message-b',
      suggestedContent: tab.suggestedContent,
    };

    expect(AIReviewTabType.hasPendingChanges?.(tab)).toBe(false);
    AIReviewTabType.onClose?.(tab);
  });

  it('rejects a review tab without review data', () => {
    expect(() => AIReviewTabType.createTab({ path: '/project/missing.ts' })).toThrow(
      'AI review data is missing; the review tab cannot be opened.'
    );
  });

  it('reuses only the same review identity for a file', () => {
    const file = { path: '/project/file.txt', name: 'file.txt' };
    const entry = {
      rootPath: '/project',
      filePath: '/project/file.txt',
      suggestedContent: 'proposal',
      originalSnapshot: 'before',
      status: 'pending' as const,
      history: [],
      updatedAt: 1,
      parentMessageId: 'message-a',
    };
    const existing = AIReviewTabType.createTab(file, {
      aiReviewProps: {
        originalContent: 'before',
        suggestedContent: 'proposal',
        filePath: '/project/file.txt',
        aiEntry: entry,
      },
    }) as AIReviewTab;
    const sameIdentity = {
      aiReviewProps: {
        originalContent: 'before',
        suggestedContent: 'proposal',
        filePath: '/project/file.txt',
        aiEntry: entry,
      },
    };
    const newIdentity = {
      aiReviewProps: {
        ...sameIdentity.aiReviewProps,
        aiEntry: { ...entry, parentMessageId: 'message-b' },
      },
    };

    expect(AIReviewTabType.shouldReuseTab?.(existing, file, sameIdentity)).toBe(true);
    expect(AIReviewTabType.shouldReuseTab?.(existing, file, newIdentity)).toBe(false);
    const nextTab = AIReviewTabType.createTab(file, newIdentity) as AIReviewTab;
    expect(nextTab.id).not.toBe(existing.id);
  });

  it('prefers the saved review draft when reopening a review tab', () => {
    const tab = AIReviewTabType.createTab(
      { path: '/project/file.txt', name: 'file.txt' },
      {
        paneId: 'pane-1',
        aiReviewProps: {
          originalContent: 'before',
          suggestedContent: 'original proposal',
          filePath: '/project/file.txt',
          aiEntry: {
            rootPath: '/project',
            filePath: '/project/file.txt',
            suggestedContent: 'saved draft',
            originalSnapshot: 'before',
            status: 'pending',
            history: [],
            updatedAt: 1,
          },
        },
      }
    ) as AIReviewTab;

    expect(tab.suggestedContent).toBe('saved draft');
  });

  it('keeps the edited suggestion in the serialized tab', () => {
    const serialized = AIReviewTabType.serializeForSession?.(reviewTab()) as
      | AIReviewTab
      | undefined;

    expect(serialized?.suggestedContent).toBe('edited suggestion');
  });

  it('restores an empty file as the original content', async () => {
    const getFileByPath = vi.fn().mockResolvedValue({ content: '' });
    const restored = (await AIReviewTabType.restoreContent?.(reviewTab(), {
      rootPath: '/project',
      getFileByPath,
    })) as AIReviewTab | undefined;

    expect(getFileByPath).toHaveBeenCalledWith('/project/file.txt');
    expect(restored?.originalContent).toBe('');
  });
});
