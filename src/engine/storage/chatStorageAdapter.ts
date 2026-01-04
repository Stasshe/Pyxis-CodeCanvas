import { STORES, storageService } from '@/engine/storage';
import type { ChatSpace, ChatSpaceMessage } from '@/types';

/**
 * キー形式: chatSpace:${projectId}:${spaceId}
 * プロジェクト単位での効率的な取得を可能にする
 */
function makeKey(projectId: string, spaceId: string): string {
  return `chatSpace:${projectId}:${spaceId}`;
}

/**
 * デバウンス保存管理
 * 頻繁な保存を防ぐため、一定時間待機してから保存を実行
 */
const debouncedSaves = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_DELAY_MS = 1000; // 1秒

function debouncedSave(key: string, saveFunction: () => Promise<void>): void {
  // 既存のタイマーをクリア
  const existingTimer = debouncedSaves.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // 新しいタイマーを設定
  const timer = setTimeout(async () => {
    try {
      await saveFunction();
      debouncedSaves.delete(key);
    } catch (error) {
      console.error('[chatStorageAdapter] Debounced save failed for key:', key, error);
      debouncedSaves.delete(key);
    }
  }, DEBOUNCE_DELAY_MS);

  debouncedSaves.set(key, timer);
}

/**
 * プロジェクトのチャットスペース一覧を取得
 */
export async function getChatSpaces(projectId: string): Promise<ChatSpace[]> {
  if (!projectId) return [];

  const all = (await storageService.getAll(STORES.CHAT_SPACES)) || [];
  const spaces: ChatSpace[] = [];
  const prefix = `chatSpace:${projectId}:`;

  for (const e of all) {
    if (e.id.startsWith(prefix)) {
      try {
        spaces.push(e.data as ChatSpace);
      } catch (err) {
        console.warn('[chatStorageAdapter] malformed entry', err);
      }
    }
  }

  // updatedAt descでソート
  spaces.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return spaces;
}

/**
 * プロジェクトに属する全てのチャットスペースを削除
 */
export async function deleteChatSpacesForProject(projectId: string): Promise<void> {
  if (!projectId) return;

  const spaces = await getChatSpaces(projectId);

  // 全てのスペースを削除
  await Promise.all(spaces.map(space => deleteChatSpace(projectId, space.id)));

  console.log(
    `[chatStorageAdapter] Deleted ${spaces.length} chat space(s) for project: ${projectId}`
  );
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
  // 新規作成時は即座に保存（キャッシュ有効）
  await storageService.set(STORES.CHAT_SPACES, makeKey(projectId, id), space);
  return space;
}

export async function deleteChatSpace(projectId: string, spaceId: string): Promise<void> {
  await storageService.delete(STORES.CHAT_SPACES, makeKey(projectId, spaceId));
}

export async function renameChatSpace(
  projectId: string,
  spaceId: string,
  newName: string
): Promise<void> {
  const key = makeKey(projectId, spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) throw new Error('chat space not found');
  const updated = { ...(sp as ChatSpace), name: newName, updatedAt: new Date() } as ChatSpace;

  // デバウンス保存を使用
  debouncedSave(key, async () => {
    await storageService.set(STORES.CHAT_SPACES, key, updated);
  });
}

export async function addMessageToChatSpace(
  projectId: string,
  spaceId: string,
  message: ChatSpaceMessage
): Promise<ChatSpaceMessage> {
  const key = makeKey(projectId, spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) throw new Error('chat space not found');
  const space = { ...(sp as ChatSpace) } as ChatSpace;
  const msg = {
    ...message,
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  } as ChatSpaceMessage;
  space.messages = [...space.messages, msg];
  space.updatedAt = new Date();

  // デバウンス保存を使用
  debouncedSave(key, async () => {
    await storageService.set(STORES.CHAT_SPACES, key, space);
  });

  return msg;
}

export async function updateChatSpaceMessage(
  projectId: string,
  spaceId: string,
  messageId: string,
  patch: Partial<ChatSpaceMessage>
): Promise<ChatSpaceMessage | null> {
  const key = makeKey(projectId, spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) return null;
  const space = { ...(sp as ChatSpace) } as ChatSpace;
  const idx = space.messages.findIndex(m => m.id === messageId);
  if (idx === -1) return null;
  const updated = { ...space.messages[idx], ...patch } as ChatSpaceMessage;
  space.messages[idx] = updated;
  space.updatedAt = new Date();

  // デバウンス保存を使用
  debouncedSave(key, async () => {
    await storageService.set(STORES.CHAT_SPACES, key, space);
  });

  return updated;
}

export async function updateChatSpaceSelectedFiles(
  projectId: string,
  spaceId: string,
  selectedFiles: string[]
): Promise<void> {
  const key = makeKey(projectId, spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) return;
  const space = { ...(sp as ChatSpace) } as ChatSpace;
  space.selectedFiles = selectedFiles;
  space.updatedAt = new Date();

  // デバウンス保存を使用
  debouncedSave(key, async () => {
    await storageService.set(STORES.CHAT_SPACES, key, space);
  });
}

export async function saveChatSpace(space: ChatSpace): Promise<void> {
  if (!space.projectId || !space.id) {
    throw new Error('ChatSpace must have projectId and id');
  }
  const key = makeKey(space.projectId, space.id);

  // デバウンス保存を使用
  debouncedSave(key, async () => {
    await storageService.set(STORES.CHAT_SPACES, key, space);
  });
}

export async function getChatSpace(projectId: string, spaceId: string): Promise<ChatSpace | null> {
  const key = makeKey(projectId, spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) return null;
  return sp as ChatSpace;
}

/**
 * Truncate messages in a chat space: delete the specified message and all messages after it.
 * Returns the list of deleted messages (for potential rollback operations).
 */
export async function truncateMessagesFromMessage(
  projectId: string,
  spaceId: string,
  messageId: string
): Promise<ChatSpaceMessage[]> {
  const key = makeKey(projectId, spaceId);
  const sp = await storageService.get(STORES.CHAT_SPACES, key);
  if (!sp) return [];

  const space = { ...(sp as ChatSpace) } as ChatSpace;
  const idx = space.messages.findIndex(m => m.id === messageId);

  if (idx === -1) return [];

  const deletedMessages = space.messages.slice(idx);
  space.messages = space.messages.slice(0, idx);
  space.updatedAt = new Date();

  // 即座に保存（重要な操作のため）
  await storageService.set(STORES.CHAT_SPACES, key, space);

  return deletedMessages;
}
