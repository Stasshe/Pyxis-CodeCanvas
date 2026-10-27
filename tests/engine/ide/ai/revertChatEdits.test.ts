import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSpace, ChatSpaceMessage } from '@/types/index';

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  tabs: [] as Array<{ id: string; path: string; isDirty: boolean }>,
  dirtyTabIds: new Set<string>(),
  readBarrier: null as Promise<void> | null,
  readStarted: null as (() => void) | null,
  writeBarrier: null as Promise<void> | null,
  writeStarted: null as (() => void) | null,
  writes: 0,
  externalUpdates: [] as Array<[string, string]>,
  logs: [] as string[],
}));

vi.mock('@/engine/core/fs/index', () => ({
  fsClient: {
    exists: async (path: string) => state.files.has(path),
    writeFile: async (path: string, content: string) => {
      state.writeStarted?.();
      if (state.writeBarrier) await state.writeBarrier;
      state.writes += 1;
      state.files.set(path, content);
    },
    rm: async (path: string) => {
      state.files.delete(path);
    },
  },
}));

vi.mock('@/engine/ide/ai/textEdits', () => ({
  readAIText: async (path: string) => {
    state.readStarted?.();
    if (state.readBarrier) await state.readBarrier;
    return state.files.get(path) ?? '';
  },
}));

vi.mock('@/engine/core/metadata/aiStorageAdapter', () => ({
  clearAIReviewEntry: vi.fn(),
}));

vi.mock('@/stores/tabContentStore', () => ({
  isTabDirty: (tabId: string) => state.dirtyTabIds.has(tabId),
}));

vi.mock('@/stores/tabState', () => ({
  tabActions: { getAllTabs: () => state.tabs },
  updateFromExternal: (path: string, content: string) => {
    state.externalUpdates.push([path, content]);
  },
}));

vi.mock('@/stores/loggerStore', () => ({
  pushLogMessage: (message: string) => state.logs.push(message),
}));

import { markEditResponseFileReverted } from '@/engine/ide/ai/markEditResponseApplied';
import { revertChatEdits } from '@/engine/ide/ai/revertChatEdits';

const rootPath = '/workspace';
const filePath = '/workspace/file.ts';

function createEditMessage(
  files = [
    {
      path: filePath,
      originalContent: 'before',
      suggestedContent: 'suggested',
      appliedContent: 'reviewed and applied',
      explanation: '',
      applied: true,
    },
  ]
): ChatSpaceMessage {
  return {
    id: 'edit-message',
    type: 'assistant',
    content: 'Edit',
    timestamp: new Date(),
    mode: 'edit',
    editResponse: { message: 'Edit', changedFiles: files },
  };
}

function createSpace(editMessage = createEditMessage()): ChatSpace {
  return {
    id: 'space-1',
    name: 'Chat',
    rootPath,
    messages: [
      {
        id: 'user-message',
        type: 'user',
        content: 'Change this',
        timestamp: new Date(),
        mode: 'edit',
      },
      editMessage,
    ],
    selectedFiles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function revertedMessage(message: ChatSpaceMessage, path: string): ChatSpaceMessage {
  if (!message.editResponse) return message;
  return {
    ...message,
    editResponse: markEditResponseFileReverted(message.editResponse, path),
  };
}

describe('revertChatEdits', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    state.files.clear();
    state.tabs = [];
    state.dirtyTabIds.clear();
    state.readBarrier = null;
    state.readStarted = null;
    state.writeBarrier = null;
    state.writeStarted = null;
    state.writes = 0;
    state.externalUpdates = [];
    state.logs = [];
    vi.stubGlobal('alert', vi.fn());
  });

  it('reverts the exact content that was applied from review', async () => {
    state.files.set(filePath, 'reviewed and applied');
    const space = createSpace();
    const updateChatMessage = vi.fn(
      async (
        _spaceId: string,
        _messageId: string,
        patch:
          | Partial<ChatSpaceMessage>
          | ((message: ChatSpaceMessage) => Partial<ChatSpaceMessage>)
      ) => {
        const edit = space.messages[1];
        const changes = typeof patch === 'function' ? patch(edit) : patch;
        return { ...edit, ...changes };
      }
    );
    const revertToMessage = vi.fn(async () => [space.messages[0], space.messages[1]]);

    const reverted = await revertChatEdits({
      rootPath,
      space,
      messageId: 'user-message',
      updateChatMessage,
      revertToMessage,
    });

    expect(reverted).toBe(true);
    expect(state.files.get(filePath)).toBe('before');
    expect(revertToMessage).toHaveBeenCalledOnce();
    expect(state.externalUpdates).toEqual([[filePath, 'before']]);
  });

  it('reverts multiple files and removes files created by the applied edit', async () => {
    const createdPath = '/workspace/created.ts';
    const edit = createEditMessage([
      {
        path: filePath,
        originalContent: 'before',
        suggestedContent: 'suggested',
        appliedContent: 'reviewed and applied',
        explanation: '',
        applied: true,
      },
      {
        path: createdPath,
        originalContent: '',
        suggestedContent: 'created content',
        appliedContent: 'created content',
        explanation: '',
        applied: true,
        isNewFile: true,
      },
    ]);
    const space = createSpace(edit);
    state.files.set(filePath, 'reviewed and applied');
    state.files.set(createdPath, 'created content');
    const updateChatMessage = vi.fn(
      async (
        _spaceId: string,
        _messageId: string,
        patch:
          | Partial<ChatSpaceMessage>
          | ((message: ChatSpaceMessage) => Partial<ChatSpaceMessage>)
      ) => {
        const changes = typeof patch === 'function' ? patch(edit) : patch;
        return { ...edit, ...changes };
      }
    );
    const revertToMessage = vi.fn(async () => [space.messages[0], edit]);

    const reverted = await revertChatEdits({
      rootPath,
      space,
      messageId: 'user-message',
      updateChatMessage,
      revertToMessage,
    });

    expect(reverted).toBe(true);
    expect(state.files.get(filePath)).toBe('before');
    expect(state.files.has(createdPath)).toBe(false);
    expect(state.externalUpdates).toEqual([[filePath, 'before']]);
    expect(updateChatMessage).toHaveBeenCalledTimes(2);
    expect(revertToMessage).toHaveBeenCalledOnce();
  });

  it('preserves user edits made after the AI apply and leaves history intact', async () => {
    state.files.set(filePath, 'later user edit');
    const space = createSpace();
    const updateChatMessage = vi.fn();
    const revertToMessage = vi.fn();

    const reverted = await revertChatEdits({
      rootPath,
      space,
      messageId: 'user-message',
      updateChatMessage,
      revertToMessage,
    });

    expect(reverted).toBe(false);
    expect(state.files.get(filePath)).toBe('later user edit');
    expect(state.writes).toBe(0);
    expect(updateChatMessage).not.toHaveBeenCalled();
    expect(revertToMessage).not.toHaveBeenCalled();
    expect(state.logs[0]).toContain('The file changed after AI applied it');
  });

  it('rechecks dirty editor state after an awaited source read', async () => {
    state.files.set(filePath, 'reviewed and applied');
    state.tabs = [{ id: 'tab-1', path: filePath, isDirty: false }];
    let finishRead!: () => void;
    let readStarted!: () => void;
    const started = new Promise<void>(resolve => {
      readStarted = resolve;
    });
    state.readStarted = readStarted;
    state.readBarrier = new Promise<void>(resolve => {
      finishRead = resolve;
    });
    const space = createSpace();
    const updateChatMessage = vi.fn();
    const revertToMessage = vi.fn();

    const reverting = revertChatEdits({
      rootPath,
      space,
      messageId: 'user-message',
      updateChatMessage,
      revertToMessage,
    });
    await started;
    state.dirtyTabIds.add('tab-1');
    finishRead();

    await expect(reverting).resolves.toBe(false);
    expect(state.writes).toBe(0);
    expect(state.files.get(filePath)).toBe('reviewed and applied');
    expect(updateChatMessage).not.toHaveBeenCalled();
    expect(revertToMessage).not.toHaveBeenCalled();
    expect(state.logs[0]).toContain('unsaved file edits');
  });

  it('keeps history when an editor becomes dirty while rollback metadata is saving', async () => {
    state.files.set(filePath, 'reviewed and applied');
    state.tabs = [{ id: 'tab-1', path: filePath, isDirty: false }];
    const space = createSpace();
    let finishMetadata!: (message: ChatSpaceMessage | null) => void;
    let metadataStarted!: () => void;
    const started = new Promise<void>(resolve => {
      metadataStarted = resolve;
    });
    const updateChatMessage = vi.fn(
      () =>
        new Promise<ChatSpaceMessage | null>(resolve => {
          metadataStarted();
          finishMetadata = resolve;
        })
    );
    const revertToMessage = vi.fn();

    const reverting = revertChatEdits({
      rootPath,
      space,
      messageId: 'user-message',
      updateChatMessage,
      revertToMessage,
    });
    await started;
    state.dirtyTabIds.add('tab-1');
    finishMetadata(revertedMessage(space.messages[1], filePath));

    await expect(reverting).resolves.toBe(false);
    expect(state.files.get(filePath)).toBe('before');
    expect(revertToMessage).not.toHaveBeenCalled();
    expect(state.logs[0]).toContain('unsaved file edits');
  });

  it('tracks a rollback write that finishes after an editor becomes dirty', async () => {
    state.files.set(filePath, 'reviewed and applied');
    state.tabs = [{ id: 'tab-1', path: filePath, isDirty: false }];
    let finishWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => {
      writeStarted = resolve;
    });
    state.writeStarted = writeStarted;
    state.writeBarrier = new Promise<void>(resolve => {
      finishWrite = resolve;
    });
    const space = createSpace();
    const updateChatMessage = vi.fn();
    const revertToMessage = vi.fn();

    const reverting = revertChatEdits({
      rootPath,
      space,
      messageId: 'user-message',
      updateChatMessage,
      revertToMessage,
    });
    await started;
    state.dirtyTabIds.add('tab-1');
    finishWrite();

    await expect(reverting).resolves.toBe(false);
    expect(state.files.get(filePath)).toBe('before');
    expect(state.externalUpdates).toEqual([]);
    expect(updateChatMessage).not.toHaveBeenCalled();
    expect(revertToMessage).not.toHaveBeenCalled();
    expect(vi.mocked(alert).mock.calls[0][0]).toContain(
      `chat history may still mark it applied for ${filePath}`
    );
  });

  it('reports when rollback recovery cannot restore its applied marker', async () => {
    const firstPath = '/workspace/first.ts';
    const secondPath = '/workspace/second.ts';
    const edit = createEditMessage([
      {
        path: firstPath,
        originalContent: 'before first',
        suggestedContent: 'suggested first',
        appliedContent: 'applied first',
        explanation: '',
        applied: true,
      },
      {
        path: secondPath,
        originalContent: 'before second',
        suggestedContent: 'suggested second',
        appliedContent: 'applied second',
        explanation: '',
        applied: true,
      },
    ]);
    const space = createSpace(edit);
    state.files.set(firstPath, 'applied first');
    state.files.set(secondPath, 'applied second');
    const updateChatMessage = vi
      .fn()
      .mockResolvedValueOnce(revertedMessage(edit, firstPath))
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(null);
    const revertToMessage = vi.fn();

    const reverted = await revertChatEdits({
      rootPath,
      space,
      messageId: 'user-message',
      updateChatMessage,
      revertToMessage,
    });

    expect(reverted).toBe(false);
    expect(state.files.get(firstPath)).toBe('applied first');
    expect(state.files.get(secondPath)).toBe('applied second');
    expect(revertToMessage).not.toHaveBeenCalled();
    expect(vi.mocked(alert).mock.calls[0][0]).toContain(
      `Could not restore rollback tracking for ${firstPath}`
    );
    expect(state.logs[0]).toContain(`Could not restore rollback tracking for ${firstPath}`);
  });
});
