import { storageService, STORES } from '@/engine/storage';
import type { ChatSpace, ChatSpaceMessage } from '@/types';

function makeKey(id: string) {
  return `chatSpace:${id}`;
}

export async function getChatSpaces(projectId: string): Promise<ChatSpace[]> {
  if (!projectId) return [];
  const all = (await storageService.getAll(STORES.CHAT_SPACES)) || [];
  const spaces: ChatSpace[] = [];
  for (const e of all) {
    try {
      const data = e.data as ChatSpace;
      if (data.projectId === projectId) spaces.push(data);
    } catch (e) {
      console.warn('[chatStorageAdapter] malformed entry', e);
    }
  }
  // sort by updatedAt desc
  spaces.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return spaces;
}

export async function createChatSpace(projectId: string, name: string): Promise<ChatSpace> {
  const id = `chatspace-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const now = new Date();
  const space: ChatSpace = {
    id,
    name,
    projectId,
    messages: [],
    selectedFiles: [],
    createdAt: now,
    updatedAt: now,
  };
  await storageService.set(STORES.CHAT_SPACES, makeKey(id), space, { cache: false });
  return space;
}

export async function deleteChatSpace(spaceId: string): Promise<void> {
  await storageService.delete(STORES.CHAT_SPACES, makeKey(spaceId));
}

export async function renameChatSpace(spaceId: string, newName: string): Promise<void> {
  const key = makeKey(spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) throw new Error('chat space not found');
  const updated = { ...(sp as ChatSpace), name: newName, updatedAt: new Date() } as ChatSpace;
  await storageService.set(STORES.CHAT_SPACES, key, updated, { cache: false });
}

export async function addMessageToChatSpace(spaceId: string, message: ChatSpaceMessage): Promise<ChatSpaceMessage> {
  const key = makeKey(spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) throw new Error('chat space not found');
  const space = { ...(sp as ChatSpace) } as ChatSpace;
  const msg = { ...message, id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}` } as ChatSpaceMessage;
  space.messages = [...space.messages, msg];
  space.updatedAt = new Date();
  await storageService.set(STORES.CHAT_SPACES, key, space, { cache: false });
  return msg;
}

export async function updateChatSpaceMessage(spaceId: string, messageId: string, patch: Partial<ChatSpaceMessage>): Promise<ChatSpaceMessage | null> {
  const key = makeKey(spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) return null;
  const space = { ...(sp as ChatSpace) } as ChatSpace;
  const idx = space.messages.findIndex(m => m.id === messageId);
  if (idx === -1) return null;
  const updated = { ...space.messages[idx], ...patch } as ChatSpaceMessage;
  space.messages[idx] = updated;
  space.updatedAt = new Date();
  await storageService.set(STORES.CHAT_SPACES, key, space, { cache: false });
  return updated;
}

export async function updateChatSpaceSelectedFiles(spaceId: string, selectedFiles: string[]): Promise<void> {
  const key = makeKey(spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) return;
  const space = { ...(sp as ChatSpace) } as ChatSpace;
  space.selectedFiles = selectedFiles;
  space.updatedAt = new Date();
  await storageService.set(STORES.CHAT_SPACES, key, space, { cache: false });
}

export async function saveChatSpace(space: ChatSpace): Promise<void> {
  const key = makeKey(space.id);
  await storageService.set(STORES.CHAT_SPACES, key, space, { cache: false });
}
