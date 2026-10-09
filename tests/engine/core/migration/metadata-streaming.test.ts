import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateMetadata } from '@/engine/core/migration/metadata';
import type {
  LegacyChatSpace,
  LegacyFileReference,
  LegacyMapping,
} from '@/engine/core/migration/types';
import type { PyxisSession } from '@/stores/sessionStore';
import type { AIReviewEntry, ChatSpace } from '@/types';

vi.mock('@/engine/storage', () => ({
  STORES: { TAB_STATE: 'tab_state', CHAT_SPACES: 'chat_spaces' },
  storageService: { initialize: vi.fn(async () => {}) },
}));
vi.mock('@/engine/storage/recentFolderStorageAdapter', () => ({
  saveRecentFolder: vi.fn(async () => {}),
}));

const globalName = 'pyxis-global';
const sourceName = 'PyxisProjects';
const fixtureConnections = new Set<IDBDatabase>();
const storeNames = [
  'translations',
  'keybindings',
  'user_preferences',
  'extensions',
  'tab_state',
  'chat_spaces',
  'ai_reviews',
];
const mapping: LegacyMapping = {
  id: 'project-1',
  name: 'demo',
  rootPath: '/home/pyxis/demo',
};

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database deletion blocked: ${name}`));
  });
}

async function openDatabase(name: string, version: number, stores: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      for (const store of stores) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => {
      fixtureConnections.add(request.result);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function put<T extends { id: string }>(
  db: IDBDatabase,
  storeName: string,
  value: T
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function chat(updatedAt: string, marker: string): LegacyChatSpace {
  return {
    id: 'chat-1',
    name: marker,
    projectId: mapping.id,
    messages: [
      {
        id: 'message-1',
        type: 'user',
        content: marker,
        timestamp: new Date(updatedAt),
        mode: 'ask',
      },
    ],
    selectedFiles: ['src/main.ts'],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date(updatedAt),
  };
}

function session(lastSaved: number): PyxisSession {
  return {
    version: 1,
    lastSaved,
    tabs: {
      panes: [{ id: 'pane-root', tabs: [], activeTabId: '' }],
      activePane: 'pane-root',
      globalActiveTab: null,
    },
    ui: {
      leftSidebarWidth: 240,
      rightSidebarWidth: 240,
      bottomPanelHeight: 200,
      isLeftSidebarVisible: true,
      isRightSidebarVisible: true,
      isBottomPanelVisible: true,
    },
  };
}

describe('metadata source streaming', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await deleteDatabase(globalName);
    await deleteDatabase(sourceName);
  });

  afterEach(() => {
    for (const db of fixtureConnections) db.close();
    fixtureConnections.clear();
  });

  it('selects the newest chat and rereads only compact file references while retrying safely', async () => {
    const globalDb = await openDatabase(globalName, 5, storeNames);
    const sourceDb = await openDatabase(sourceName, 1, ['files', 'chatSpaces']);
    const older = chat('2026-01-02T00:00:00Z', 'older');
    const globalNewest = chat('2026-01-04T00:00:00Z', 'global newest');
    await put(sourceDb, 'chatSpaces', older);
    await put(globalDb, 'chat_spaces', {
      id: 'legacy-global-chat',
      data: globalNewest,
      timestamp: 1,
    });
    await put(globalDb, 'tab_state', { id: mapping.id, data: session(10), timestamp: 1 });
    await put(globalDb, 'user_preferences', {
      id: 'current-session',
      data: session(20),
      timestamp: 1,
    });

    const content = 'legacy source payload '.repeat(4096);
    const sourceFile = {
      id: 'review-file',
      projectId: mapping.id,
      path: 'src/main.ts',
      type: 'file',
      content,
      isAiAgentReview: true,
      aiAgentSuggestedContent: 'suggested source',
    };
    await put(sourceDb, 'files', sourceFile);
    const files: LegacyFileReference[] = [
      {
        key: 'review-file',
        id: 'review-file',
        projectId: mapping.id,
        path: 'src/main.ts',
        type: 'file',
        hasReview: true,
      },
    ];
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const readEvents: string[] = [];
    const originalGet = IDBObjectStore.prototype.get;
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      key: IDBValidKey | IDBKeyRange
    ) {
      readEvents.push(`${this.name}:${String(key)}`);
      return originalGet.call(this, key);
    });
    const saveRecentFolder = await import('@/engine/storage/recentFolderStorageAdapter');
    vi.mocked(saveRecentFolder.saveRecentFolder).mockRejectedValueOnce(new Error('retry point'));

    await expect(migrateMetadata([mapping], files, sourceDb)).rejects.toThrow('retry point');
    expect(getAll).not.toHaveBeenCalled();
    expect(readEvents.indexOf('files:review-file')).toBeGreaterThan(
      readEvents.lastIndexOf('chat_spaces:chatSpace:/home/pyxis/demo:chat-1')
    );
    const storedChat = await new Promise<{ data: ChatSpace } | undefined>((resolve, reject) => {
      const request = globalDb
        .transaction('chat_spaces')
        .objectStore('chat_spaces')
        .get('chatSpace:/home/pyxis/demo:chat-1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(storedChat?.data.name).toBe('global newest');
    const storedSession = await new Promise<{ data: PyxisSession } | undefined>(
      (resolve, reject) => {
        const request = globalDb
          .transaction('tab_state')
          .objectStore('tab_state')
          .get('tabState:/home/pyxis/demo');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    expect(storedSession?.data.lastSaved).toBe(20);
    const storedReview = await new Promise<{ data: AIReviewEntry } | undefined>(
      (resolve, reject) => {
        const request = globalDb
          .transaction('ai_reviews')
          .objectStore('ai_reviews')
          .get('aiReview:/home/pyxis/demo:/home/pyxis/demo/src/main.ts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    expect(storedReview?.data.originalSnapshot).toBe(content);
    const migratedReviewTimestamp = storedReview?.data.updatedAt;

    await migrateMetadata([mapping], files, sourceDb);
    expect(getAll).not.toHaveBeenCalled();
    const originalFile = await new Promise<{ content: string } | undefined>((resolve, reject) => {
      const request = sourceDb.transaction('files').objectStore('files').get('review-file');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(originalFile?.content).toBe(content);
    const retriedReview = await new Promise<{ data: AIReviewEntry } | undefined>(
      (resolve, reject) => {
        const request = globalDb
          .transaction('ai_reviews')
          .objectStore('ai_reviews')
          .get('aiReview:/home/pyxis/demo:/home/pyxis/demo/src/main.ts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    if (!retriedReview) throw new Error('Migrated review is missing after retry');
    expect(retriedReview?.data.updatedAt).toBe(migratedReviewTimestamp);
    const historyFile = {
      ...sourceFile,
      aiReviewHistory: [
        {
          id: 'history-1',
          timestamp: new Date('2026-02-01T00:00:00Z'),
          content: 'suggested source',
        },
      ],
    };
    await put(sourceDb, 'files', historyFile);
    const historyUpdatedAt = historyFile.aiReviewHistory[0].timestamp.getTime();
    await put(globalDb, 'ai_reviews', {
      id: 'aiReview:/home/pyxis/demo:/home/pyxis/demo/src/main.ts',
      data: {
        ...retriedReview.data,
        history: historyFile.aiReviewHistory,
        updatedAt: historyUpdatedAt + 1,
      },
      timestamp: 1,
    });
    await expect(migrateMetadata([mapping], files, sourceDb)).rejects.toThrow(
      'Metadata destination already contains different data'
    );
    const stillStoredReview = await new Promise<{ data: AIReviewEntry } | undefined>(
      (resolve, reject) => {
        const request = globalDb
          .transaction('ai_reviews')
          .objectStore('ai_reviews')
          .get('aiReview:/home/pyxis/demo:/home/pyxis/demo/src/main.ts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    expect(stillStoredReview?.data.history).toEqual(historyFile.aiReviewHistory);
    expect(stillStoredReview?.data.updatedAt).toBe(historyUpdatedAt + 1);
    const changedSource = await new Promise<
      { aiReviewHistory: AIReviewEntry['history'] } | undefined
    >((resolve, reject) => {
      const request = sourceDb.transaction('files').objectStore('files').get('review-file');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(changedSource?.aiReviewHistory).toHaveLength(1);
  });
});
