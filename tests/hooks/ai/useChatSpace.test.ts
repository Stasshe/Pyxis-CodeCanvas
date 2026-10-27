import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSpace, ChatSpaceMessage } from '@/types/index';

const state = vi.hoisted(() => ({
  spaces: new Map<string, ChatSpace>(),
  reviewEntries: new Map<string, { parentMessageId: string }>(),
  fileContents: new Map<string, string>(),
  failStorageWrites: false,
  failStorageDeletes: false,
  tabs: [] as Array<{ id: string; path: string; isDirty: boolean }>,
  dirtyTabIds: new Set<string>(),
  writeBarrier: null as Promise<void> | null,
  writeStarted: null as (() => void) | null,
  externalUpdates: [] as Array<[string, string]>,
  getAllReads: 0,
}));

vi.mock('@/engine/core/fs/index', () => ({
  fsClient: {
    exists: async (path: string) => state.fileContents.has(path),
    writeFile: async (path: string, content: string) => {
      state.writeStarted?.();
      if (state.writeBarrier) await state.writeBarrier;
      state.fileContents.set(path, content);
    },
    rm: async (path: string) => {
      state.fileContents.delete(path);
    },
  },
}));

vi.mock('@/engine/ide/ai/textEdits', () => ({
  readAIText: async (path: string) => state.fileContents.get(path) ?? '',
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

vi.mock('@/engine/core/metadata', () => ({
  STORES: { CHAT_SPACES: 'chat_spaces', AI_REVIEWS: 'ai_reviews' },
  storageService: {
    get: async (_store: string, key: string) => {
      if (_store === 'ai_reviews') return state.reviewEntries.get(key) ?? null;
      const space = state.spaces.get(key);
      if (!space) return null;
      return structuredClone(space);
    },
    set: async (_store: string, key: string, value: unknown) => {
      if (state.failStorageWrites) throw new Error('storage write failed');
      if (_store === 'ai_reviews') {
        state.reviewEntries.set(key, structuredClone(value) as { parentMessageId: string });
      } else {
        state.spaces.set(key, structuredClone(value) as ChatSpace);
      }
    },
    delete: async (_store: string, key: string) => {
      if (state.failStorageDeletes) throw new Error('storage delete failed');
      if (_store === 'ai_reviews') state.reviewEntries.delete(key);
      else state.spaces.delete(key);
    },
    getAll: async () => {
      state.getAllReads += 1;
      return [...state.spaces.entries()].map(([id, data]) => ({ id, data, timestamp: 0 }));
    },
  },
}));

vi.mock('@/stores/loggerStore', () => ({ pushLogMessage: vi.fn() }));

import {
  addMessageToChatSpace,
  getChatSpaces,
  updateChatSpaceMessage,
  updateChatSpaceSelectedFiles,
} from '@/engine/core/metadata/chatStorageAdapter';
import { applyChatEdit } from '@/engine/ide/ai/applyChatEdit';
import { markEditResponseFileApplied } from '@/engine/ide/ai/markEditResponseApplied';
import { useChatSpace } from '@/hooks/ai/useChatSpace';
import { pushLogMessage } from '@/stores/loggerStore';

const rootPath = '/workspace';
const spaceId = 'chatspace-1';
const storageKey = `chatSpace:${rootPath}:${spaceId}`;

function message(id: string): ChatSpaceMessage {
  return {
    id,
    type: 'user',
    content: id,
    timestamp: new Date(),
    mode: 'ask',
  };
}

function editMessage(): ChatSpaceMessage {
  return {
    id: 'edit-response',
    type: 'assistant',
    content: 'Suggested changes',
    timestamp: new Date(),
    mode: 'edit',
    editResponse: {
      message: 'Suggested changes',
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
    },
  };
}

function createSpace(): ChatSpace {
  return {
    id: spaceId,
    name: 'Chat',
    rootPath,
    messages: [message('first')],
    selectedFiles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('useChatSpace', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    state.spaces.clear();
    state.reviewEntries.clear();
    state.fileContents.clear();
    state.failStorageWrites = false;
    state.failStorageDeletes = false;
    state.tabs = [];
    state.dirtyTabIds.clear();
    state.writeBarrier = null;
    state.writeStarted = null;
    state.externalUpdates = [];
    state.getAllReads = 0;
    state.spaces.set(storageKey, createSpace());
  });

  it('renames from the latest stored record while hook state is stale', async () => {
    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    hook.selectSpace(createSpace());

    await addMessageToChatSpace(rootPath, spaceId, message('concurrent message'));
    await updateChatSpaceSelectedFiles(rootPath, spaceId, ['/workspace/src/app.ts']);
    await hook.updateSpaceName(spaceId, 'Renamed');

    const [saved] = await getChatSpaces(rootPath);
    expect(saved.name).toBe('Renamed');
    expect(saved.messages.map(item => item.content)).toEqual(['first', 'concurrent message']);
    expect(saved.selectedFiles).toEqual(['/workspace/src/app.ts']);
  });

  it('propagates chat creation storage failures so callers can preserve the input and report them', async () => {
    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }
    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    state.failStorageWrites = true;

    await expect(hook.createNewSpace('New chat')).rejects.toThrow('storage write failed');
    expect([...state.spaces.values()].map(space => space.name)).toEqual(['Chat']);
  });

  it('keeps rename and delete failures visible to callers without changing stored spaces', async () => {
    const originalSpace = createSpace();
    originalSpace.updatedAt = new Date('2026-01-01T00:00:00.000Z');
    state.spaces.set(storageKey, originalSpace);
    const secondSpace = createSpace();
    secondSpace.id = 'chatspace-second';
    secondSpace.name = 'Second';
    secondSpace.updatedAt = new Date('2026-01-02T00:00:00.000Z');
    state.spaces.set(`chatSpace:${rootPath}:${secondSpace.id}`, secondSpace);
    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    hook.selectSpace(createSpace());
    state.failStorageWrites = true;
    state.failStorageDeletes = true;

    await expect(hook.updateSpaceName(spaceId, 'Renamed')).resolves.toBe(false);
    await expect(hook.deleteSpace(spaceId)).resolves.toBe(false);
    const savedSpaces = await getChatSpaces(rootPath);
    expect(Object.fromEntries(savedSpaces.map(space => [space.id, space.name]))).toEqual({
      [spaceId]: 'Chat',
      [secondSpace.id]: 'Second',
    });
    expect(pushLogMessage).toHaveBeenCalledWith(
      'Failed to update chat space name: storage write failed',
      'error',
      'AI'
    );
    expect(pushLogMessage).toHaveBeenCalledWith(
      'Failed to delete chat space: storage delete failed',
      'error',
      'AI'
    );
  });

  it('updates the active space from the pre-delete snapshot without a second read', async () => {
    const remaining = createSpace();
    remaining.id = 'chatspace-remaining';
    remaining.name = 'Remaining';
    state.spaces.set(`chatSpace:${rootPath}:${remaining.id}`, remaining);

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    hook.selectSpace(createSpace());

    await expect(hook.deleteSpace(spaceId)).resolves.toBe(true);
    expect(state.getAllReads).toBe(1);
    await hook.addMessage('Still available', 'user', 'ask');

    const saved = await getChatSpaces(rootPath);
    expect(saved.map(space => space.id)).toEqual([remaining.id]);
    expect(saved[0].messages.at(-1)?.content).toBe('Still available');
  });

  it('preserves all existing spaces when creating an eleventh space', async () => {
    state.spaces.clear();
    const spaceIds = Array.from({ length: 10 }, (_, index) => `chatspace-${index}`);
    for (const [index, id] of spaceIds.entries()) {
      const space = createSpace();
      space.id = id;
      space.name = `Space ${index}`;
      state.spaces.set(`chatSpace:${rootPath}:${id}`, space);
    }

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');

    const created = await hook.createNewSpace('Eleventh chat');
    const savedSpaces = await getChatSpaces(rootPath);

    expect(created).not.toBeNull();
    expect(savedSpaces).toHaveLength(11);
    expect(new Set(savedSpaces.map(space => space.id))).toEqual(
      new Set([...spaceIds, created?.id])
    );
  });

  it('does not revert a different space after the active selection changes', async () => {
    const otherSpace = createSpace();
    otherSpace.id = 'chatspace-other';
    otherSpace.messages = [message('other-message')];
    state.spaces.set(`chatSpace:${rootPath}:${otherSpace.id}`, otherSpace);

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    hook.selectSpace(createSpace());
    hook.selectSpace(otherSpace);

    const removed = await hook.revertToMessage('first', undefined, spaceId);
    const saved = (await getChatSpaces(rootPath)).find(space => space.id === spaceId);

    expect(removed).toEqual([]);
    expect(saved?.messages.map(item => item.id)).toEqual(['first']);
  });

  it('propagates revert storage failures instead of returning an empty history result', async () => {
    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    hook.selectSpace(createSpace());
    state.failStorageWrites = true;

    await expect(hook.revertToMessage('first')).rejects.toThrow('storage write failed');
  });

  it('restores the file and reports failure when applied-state metadata cannot be saved', async () => {
    const space = createSpace();
    space.messages = [editMessage()];
    state.spaces.set(storageKey, space);
    state.fileContents.set('/project/a.ts', 'before a');
    state.failStorageWrites = true;

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    vi.stubGlobal('alert', vi.fn());

    const applied = await applyChatEdit(
      rootPath,
      space,
      '/project/a.ts',
      'after a',
      hook.updateChatMessage
    );

    expect(applied).toBe(false);
    expect(state.fileContents.get('/project/a.ts')).toBe('before a');
    expect(vi.mocked(alert)).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('stores the exact pre-apply file content with the applied marker', async () => {
    const space = createSpace();
    space.messages = [editMessage()];
    state.spaces.set(storageKey, space);
    state.fileContents.set('/project/a.ts', 'before a');

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');

    const applied = await applyChatEdit(
      rootPath,
      space,
      '/project/a.ts',
      'reviewed after a',
      hook.updateChatMessage
    );
    const [saved] = await getChatSpaces(rootPath);
    const savedFile = saved.messages[0].editResponse?.changedFiles[0];

    expect(applied).toBe(true);
    expect(state.fileContents.get('/project/a.ts')).toBe('reviewed after a');
    expect(savedFile?.applied).toBe(true);
    expect(savedFile?.originalContent).toBe('before a');
    expect(savedFile?.appliedContent).toBe('reviewed after a');
  });

  it('reports a review metadata cleanup failure after a successful apply', async () => {
    const space = createSpace();
    space.messages = [editMessage()];
    state.spaces.set(storageKey, space);
    state.fileContents.set('/project/a.ts', 'before a');
    state.reviewEntries.set(`aiReview:${rootPath}:/project/a.ts`, {
      parentMessageId: 'edit-response',
    });
    state.failStorageDeletes = true;

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    vi.stubGlobal('alert', vi.fn());

    const applied = await applyChatEdit(
      rootPath,
      space,
      '/project/a.ts',
      'after a',
      hook.updateChatMessage
    );
    const [saved] = await getChatSpaces(rootPath);

    expect(applied).toBe(true);
    expect(state.fileContents.get('/project/a.ts')).toBe('after a');
    expect(saved.messages[0].editResponse?.changedFiles[0].applied).toBe(true);
    expect(vi.mocked(alert).mock.calls[0][0]).toContain('AI review metadata could not be cleared');
    vi.unstubAllGlobals();
  });

  it('preserves a dirty editor buffer created while the file write is pending', async () => {
    const space = createSpace();
    space.messages = [editMessage()];
    state.spaces.set(storageKey, space);
    state.fileContents.set('/project/a.ts', 'before a');

    let finishWrite!: () => void;
    let onWriteStarted!: () => void;
    const writeStarted = new Promise<void>(resolve => {
      onWriteStarted = resolve;
    });
    state.writeStarted = onWriteStarted;
    state.writeBarrier = new Promise<void>(resolve => {
      finishWrite = resolve;
    });

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    vi.stubGlobal('alert', vi.fn());

    const applying = applyChatEdit(
      rootPath,
      space,
      '/project/a.ts',
      'after a',
      hook.updateChatMessage
    );
    await writeStarted;
    state.tabs = [{ id: 'tab-a', path: '/project/a.ts', isDirty: false }];
    state.dirtyTabIds.add('tab-a');
    finishWrite();

    await expect(applying).resolves.toBe(false);
    expect(state.externalUpdates).toEqual([]);
    expect(state.fileContents.get('/project/a.ts')).toBe('after a');
    expect(vi.mocked(alert).mock.calls[0][0]).toContain('unsaved editor changes');
    vi.unstubAllGlobals();
  });

  it('does not apply a proposal over a changed file', async () => {
    const space = createSpace();
    space.messages = [editMessage()];
    state.spaces.set(storageKey, space);
    state.fileContents.set('/project/a.ts', 'manual edit');

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    vi.stubGlobal('alert', vi.fn());

    const applied = await applyChatEdit(
      rootPath,
      space,
      '/project/a.ts',
      'after a',
      hook.updateChatMessage
    );

    expect(applied).toBe(false);
    expect(state.fileContents.get('/project/a.ts')).toBe('manual edit');
  });

  it('merges applied flags into the latest edit response', async () => {
    const space = createSpace();
    space.messages.push(editMessage());
    state.spaces.set(storageKey, space);

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    hook.selectSpace(space);

    const latestMessage = editMessage();
    if (!latestMessage.editResponse) throw new Error('Missing edit response');
    await updateChatSpaceMessage(rootPath, spaceId, latestMessage.id, {
      editResponse: markEditResponseFileApplied(
        latestMessage.editResponse,
        '/project/b.ts',
        undefined,
        'applied b'
      ),
    });
    await hook.updateChatMessage(spaceId, latestMessage.id, current => {
      if (!current.editResponse) return {};
      return {
        editResponse: markEditResponseFileApplied(
          current.editResponse,
          '/project/a.ts',
          'current before apply a',
          'applied a'
        ),
      };
    });

    const [saved] = await getChatSpaces(rootPath);
    const savedMessage = saved.messages.find(item => item.id === latestMessage.id);
    expect(savedMessage?.editResponse?.changedFiles.map(file => file.applied)).toEqual([
      true,
      true,
    ]);
    expect(savedMessage?.editResponse?.changedFiles[0].originalContent).toBe(
      'current before apply a'
    );
  });

  it('appends apply events to the parent message space when it is not selected', async () => {
    const parentSpace = createSpace();
    parentSpace.id = 'parent-space';
    parentSpace.name = 'Parent';
    state.spaces.set(`chatSpace:${rootPath}:${parentSpace.id}`, parentSpace);
    const activeSpace = createSpace();
    activeSpace.id = 'active-space';
    state.spaces.set(`chatSpace:${rootPath}:${activeSpace.id}`, activeSpace);

    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');

    const added = await hook.addMessage('Applied changes', 'assistant', 'edit', [], undefined, {
      parentMessageId: 'source-message',
      action: 'apply',
      spaceId: parentSpace.id,
    });
    const savedSpaces = await getChatSpaces(rootPath);
    const target = savedSpaces.find(space => space.id === parentSpace.id);

    expect(added).not.toBeNull();
    expect(target?.messages.at(-1)?.action).toBe('apply');
    expect(target?.messages.at(-1)?.parentMessageId).toBe('source-message');
    expect(target?.messages).toHaveLength(parentSpace.messages.length + 1);
  });

  it('rejects messages from a request bound to a different workspace', async () => {
    const hookHolder: { current?: ReturnType<typeof useChatSpace> } = {};
    function Probe(): null {
      hookHolder.current = useChatSpace(rootPath);
      return null;
    }

    renderToString(createElement(Probe));
    const hook = hookHolder.current;
    if (!hook) throw new Error('Hook did not render');
    hook.selectSpace(createSpace());

    const added = await hook.addMessage('Stale response', 'assistant', 'ask', [], undefined, {
      rootPath: '/other-workspace',
      spaceId,
    });

    expect(added).toBeNull();
    const [saved] = await getChatSpaces(rootPath);
    expect(saved.messages).toHaveLength(1);
  });
});
