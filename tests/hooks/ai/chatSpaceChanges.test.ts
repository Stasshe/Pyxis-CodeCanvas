import { describe, expect, it } from 'vitest';
import type { ChatSpaceChangeEvent } from '@/engine/storage/chatStorageAdapter';
import { applyChatSpaceChange } from '@/hooks/ai/chatSpaceChanges';
import type { ChatSpace } from '@/types';

function space(id: string, name: string, updatedAt: string): ChatSpace {
  const timestamp = new Date(updatedAt);
  return {
    id,
    name,
    rootPath: '/workspace',
    messages: [],
    selectedFiles: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('applyChatSpaceChange', () => {
  it('updates an active snapshot from persisted state and keeps the newest list first', () => {
    const activeSpace = space('space-1', 'Old name', '2026-01-01T00:00:00.000Z');
    const otherSpace = space('space-2', 'Other', '2026-01-02T00:00:00.000Z');
    const savedSpace = space('space-1', 'Applied', '2026-01-03T00:00:00.000Z');
    const event: ChatSpaceChangeEvent = {
      rootPath: '/workspace',
      spaceId: savedSpace.id,
      space: savedSpace,
    };

    const snapshot = applyChatSpaceChange('/workspace', event, {
      chatSpaces: [otherSpace, activeSpace],
      currentSpace: activeSpace,
    });

    expect(snapshot.currentSpace).toBe(savedSpace);
    expect(snapshot.chatSpaces).toEqual([savedSpace, otherSpace]);
  });

  it('ignores changes from another workspace and clears an externally deleted active space', () => {
    const activeSpace = space('space-1', 'Active', '2026-01-01T00:00:00.000Z');
    const snapshot = { chatSpaces: [activeSpace], currentSpace: activeSpace };
    const staleEvent: ChatSpaceChangeEvent = {
      rootPath: '/old-workspace',
      spaceId: activeSpace.id,
      space: { ...activeSpace, name: 'Stale update' },
    };

    expect(applyChatSpaceChange('/workspace', staleEvent, snapshot)).toBe(snapshot);

    const deletion: ChatSpaceChangeEvent = {
      rootPath: '/workspace',
      spaceId: activeSpace.id,
      space: null,
    };
    expect(applyChatSpaceChange('/workspace', deletion, snapshot)).toEqual({
      chatSpaces: [],
      currentSpace: null,
    });
  });
});
