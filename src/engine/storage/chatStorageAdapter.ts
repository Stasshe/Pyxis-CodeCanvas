import { STORES, storageService } from '@/engine/storage';
import type { ChatSpace, ChatSpaceMessage } from '@/types';

export interface ChatSpaceChangeEvent {
  rootPath: string;
  spaceId: string;
  space: ChatSpace | null;
}

type ChatSpaceChangeListener = (event: ChatSpaceChangeEvent) => void;

/**
 * キー形式: chatSpace:${rootPath}:${spaceId}
 * プロジェクト単位での効率的な取得を可能にする
 */
function makeKey(rootPath: string, spaceId: string): string {
  return `chatSpace:${rootPath}:${spaceId}`;
}

const pendingWrites = new Map<string, Promise<void>>();
const changeListeners = new Set<ChatSpaceChangeListener>();

export function addChatSpaceChangeListener(listener: ChatSpaceChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function emitChatSpaceChange(event: ChatSpaceChangeEvent): void {
  for (const listener of changeListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[chatStorageAdapter] Change listener failed:', error);
    }
  }
}

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

function updateChatSpace<T>(
  rootPath: string,
  spaceId: string,
  update: (space: ChatSpace) => T
): Promise<T | null> {
  const key = makeKey(rootPath, spaceId);
  return serializeWrite(key, async () => {
    const stored = await storageService.get<ChatSpace>(STORES.CHAT_SPACES, key);
    if (!stored) return null;
    const space = { ...stored, messages: [...stored.messages] };
    const result = update(space);
    await storageService.set(STORES.CHAT_SPACES, key, space);
    emitChatSpaceChange({ rootPath, spaceId, space });
    return result;
  });
}

/**
 * プロジェクトのチャットスペース一覧を取得
 */
export async function getChatSpaces(rootPath: string): Promise<ChatSpace[]> {
  if (!rootPath) return [];

  const prefix = `chatSpace:${rootPath}:`;
  await Promise.all(
    [...pendingWrites.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, pending]) => pending.catch(() => undefined))
  );

  const all = (await storageService.getAll(STORES.CHAT_SPACES)) || [];
  const spaces: ChatSpace[] = [];

  for (const e of all) {
    if (e.id.startsWith(prefix)) {
      try {
        const space = e.data as ChatSpace;
        if (space.rootPath === rootPath) spaces.push(space);
      } catch (err) {
        console.warn('[chatStorageAdapter] malformed entry', err);
      }
    }
  }

  // updatedAt descでソート
  spaces.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return spaces;
}

export async function createChatSpace(rootPath: string, name: string): Promise<ChatSpace> {
  const id = `chatspace-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const now = new Date();
  const space: ChatSpace = {
    id,
    name,
    rootPath,
    messages: [],
    selectedFiles: [],
    createdAt: now,
    updatedAt: now,
  };
  // 新規作成時は即座に保存（キャッシュ有効）
  await storageService.set(STORES.CHAT_SPACES, makeKey(rootPath, id), space);
  emitChatSpaceChange({ rootPath, spaceId: id, space });
  return space;
}

export async function deleteChatSpace(rootPath: string, spaceId: string): Promise<void> {
  const key = makeKey(rootPath, spaceId);
  await serializeWrite(key, () => storageService.delete(STORES.CHAT_SPACES, key));
  emitChatSpaceChange({ rootPath, spaceId, space: null });
}

export async function renameChatSpace(
  rootPath: string,
  spaceId: string,
  newName: string
): Promise<void> {
  const updated = await updateChatSpace(rootPath, spaceId, space => {
    space.name = newName;
    space.updatedAt = new Date();
    return true;
  });
  if (!updated) throw new Error('chat space not found');
}

export async function addMessageToChatSpace(
  rootPath: string,
  spaceId: string,
  message: ChatSpaceMessage
): Promise<ChatSpaceMessage> {
  const msg = await updateChatSpace(rootPath, spaceId, space => {
    const newMessage: ChatSpaceMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    };
    space.messages.push(newMessage);
    space.updatedAt = new Date();
    return newMessage;
  });
  if (!msg) throw new Error('chat space not found');
  return msg;
}

export async function updateChatSpaceMessage(
  rootPath: string,
  spaceId: string,
  messageId: string,
  patch: Partial<ChatSpaceMessage> | ((message: ChatSpaceMessage) => Partial<ChatSpaceMessage>)
): Promise<ChatSpaceMessage | null> {
  return updateChatSpace(rootPath, spaceId, space => {
    const index = space.messages.findIndex(message => message.id === messageId);
    if (index === -1) return null;
    let changes: Partial<ChatSpaceMessage>;
    if (typeof patch === 'function') {
      changes = patch(space.messages[index]);
    } else {
      changes = patch;
    }
    const updated = { ...space.messages[index], ...changes };
    space.messages[index] = updated;
    space.updatedAt = new Date();
    return updated;
  }).then(result => result ?? null);
}

export async function updateChatSpaceSelectedFiles(
  rootPath: string,
  spaceId: string,
  selectedFiles: string[]
): Promise<void> {
  const updated = await updateChatSpace(rootPath, spaceId, space => {
    space.selectedFiles = selectedFiles;
    space.updatedAt = new Date();
    return true;
  });
  if (!updated) throw new Error('chat space not found');
}

/**
 * Truncate messages in a chat space: delete the specified message and all messages after it.
 * Returns the list of deleted messages (for potential rollback operations).
 */
export async function truncateMessagesFromMessage(
  rootPath: string,
  spaceId: string,
  messageId: string,
  expectedLastMessageId?: string
): Promise<ChatSpaceMessage[]> {
  const deleted = await updateChatSpace(rootPath, spaceId, space => {
    if (expectedLastMessageId && space.messages.at(-1)?.id !== expectedLastMessageId) {
      throw new Error('chat changed before messages could be removed');
    }
    const index = space.messages.findIndex(message => message.id === messageId);
    if (index === -1) return [];
    const removed = space.messages.splice(index);
    space.updatedAt = new Date();
    return removed;
  });
  return deleted ?? [];
}
