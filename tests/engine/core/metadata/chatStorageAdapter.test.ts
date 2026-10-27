import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSpace, ChatSpaceMessage } from '@/types/index';

const state = vi.hoisted(() => ({ spaces: new Map<string, ChatSpace>() }));

vi.mock('@/engine/core/metadata', () => ({
  STORES: { CHAT_SPACES: 'chat_spaces' },
  storageService: {
    get: async (_store: string, key: string) => {
      const space = state.spaces.get(key);
      if (!space) return null;
      return structuredClone(space);
    },
    set: async (_store: string, key: string, space: ChatSpace) => {
      state.spaces.set(key, structuredClone(space));
    },
    delete: async (_store: string, key: string) => {
      state.spaces.delete(key);
    },
    getAll: async () =>
      [...state.spaces.entries()].map(([id, data]) => ({ id, data, timestamp: 0 })),
  },
}));

import {
  addChatSpaceChangeListener,
  addMessageToChatSpace,
  createChatSpace,
  deleteChatSpace,
  getChatSpaces,
  renameChatSpace,
  truncateMessagesFromMessage,
  updateChatSpaceMessage,
  updateChatSpaceSelectedFiles,
} from '@/engine/core/metadata/chatStorageAdapter';

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

function createSpace(): ChatSpace {
  return {
    id: spaceId,
    name: 'Chat',
    rootPath,
    messages: [message('first'), message('second')],
    selectedFiles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('chat storage adapter', () => {
  beforeEach(() => {
    state.spaces.clear();
    state.spaces.set(storageKey, createSpace());
  });

  it('preserves concurrent message additions and a rename', async () => {
    await Promise.all([
      addMessageToChatSpace(rootPath, spaceId, message('third')),
      addMessageToChatSpace(rootPath, spaceId, message('fourth')),
      renameChatSpace(rootPath, spaceId, 'Renamed'),
    ]);

    const [saved] = await getChatSpaces(rootPath);
    expect(saved.name).toBe('Renamed');
    expect(saved.messages.map(savedMessage => savedMessage.content)).toEqual([
      'first',
      'second',
      'third',
      'fourth',
    ]);
  });

  it('publishes persisted snapshots and deletion events to subscribed hooks', async () => {
    const events: Array<{ rootPath: string; spaceId: string; space: ChatSpace | null }> = [];
    const unsubscribe = addChatSpaceChangeListener(event => events.push(event));
    try {
      await updateChatSpaceMessage(rootPath, spaceId, 'first', { content: 'updated' });
      const created = await createChatSpace(rootPath, 'New chat');
      await deleteChatSpace(rootPath, created.id);

      expect(events[0].space?.messages[0].content).toBe('updated');
      expect(events[0].rootPath).toBe(rootPath);
      expect(events[0].spaceId).toBe(spaceId);
      expect(events[1]).toMatchObject({ rootPath, spaceId: created.id, space: created });
      expect(events[2]).toEqual({ rootPath, spaceId: created.id, space: null });
    } finally {
      unsubscribe();
    }
  });

  it('does not list spaces from a root path sharing the key prefix', async () => {
    const collidingRoot = `${rootPath}:nested`;
    const collidingSpace = { ...createSpace(), rootPath: collidingRoot };
    state.spaces.set(`chatSpace:${collidingRoot}:${spaceId}`, collidingSpace);

    const spaces = await getChatSpaces(rootPath);

    expect(spaces).toHaveLength(1);
    expect(spaces[0].rootPath).toBe(rootPath);
  });

  it('applies truncation after an earlier queued mutation', async () => {
    const addition = addMessageToChatSpace(rootPath, spaceId, message('third'));
    const truncate = truncateMessagesFromMessage(rootPath, spaceId, 'second');

    await addition;
    expect((await truncate).map(savedMessage => savedMessage.content)).toEqual(['second', 'third']);

    const [saved] = await getChatSpaces(rootPath);
    expect(saved.messages.map(savedMessage => savedMessage.content)).toEqual(['first']);
  });

  it('does not truncate a chat that changed after the caller captured its tail', async () => {
    const addition = addMessageToChatSpace(rootPath, spaceId, message('third'));
    const truncate = truncateMessagesFromMessage(rootPath, spaceId, 'second', 'second');

    await addition;
    await expect(truncate).rejects.toThrow('chat changed before messages could be removed');

    const [saved] = await getChatSpaces(rootPath);
    expect(saved.messages.map(savedMessage => savedMessage.content)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('fails to update selected files when the chat space is missing', async () => {
    state.spaces.delete(storageKey);

    await expect(
      updateChatSpaceSelectedFiles(rootPath, spaceId, ['/workspace/src/app.ts'])
    ).rejects.toThrow('chat space not found');
  });

  it('merges concurrent applied flags against the latest message', async () => {
    const space = createSpace();
    space.messages[0].editResponse = {
      message: 'Changes ready',
      changedFiles: ['/a.ts', '/b.ts'].map(path => ({
        path,
        originalContent: '',
        suggestedContent: '',
        explanation: '',
        applied: false,
      })),
    };
    state.spaces.set(storageKey, space);

    const markApplied = (path: string) =>
      updateChatSpaceMessage(rootPath, spaceId, 'first', current => {
        const response = current.editResponse;
        if (!response) return {};
        return {
          editResponse: {
            ...response,
            changedFiles: response.changedFiles.map(file =>
              file.path === path ? { ...file, applied: true } : file
            ),
          },
        };
      });

    await Promise.all([markApplied('/a.ts'), markApplied('/b.ts')]);

    const [saved] = await getChatSpaces(rootPath);
    expect(saved.messages[0].editResponse?.changedFiles.map(file => file.applied)).toEqual([
      true,
      true,
    ]);
  });
});
