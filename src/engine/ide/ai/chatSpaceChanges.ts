import type { ChatSpaceChangeEvent } from '@/engine/core/metadata/chatStorageAdapter';
import type { ChatSpace } from '@/types/index';

interface ChatSpaceSnapshot {
  chatSpaces: ChatSpace[];
  currentSpace: ChatSpace | null;
}

export function applyChatSpaceChange(
  rootPath: string,
  event: ChatSpaceChangeEvent,
  snapshot: ChatSpaceSnapshot
): ChatSpaceSnapshot {
  if (event.rootPath !== rootPath) return snapshot;

  const chatSpaces = snapshot.chatSpaces.filter(space => space.id !== event.spaceId);
  if (event.space) chatSpaces.push(event.space);
  chatSpaces.sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime());

  let currentSpace = snapshot.currentSpace;
  if (currentSpace?.id === event.spaceId) currentSpace = event.space;

  return { chatSpaces, currentSpace };
}
