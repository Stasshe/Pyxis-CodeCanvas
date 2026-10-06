import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateMetadata } from '@/engine/core/migration/metadata';
import type { LegacyChatSpace, LegacyFile, LegacyMapping } from '@/engine/core/migration/types';
import { STORES } from '@/engine/storage';
import type { EditorPane, EditorTab } from '@/engine/tabs/types';
import type { PyxisSession } from '@/stores/sessionStore';
import type { AIReviewEntry, ChatSpace, ChatSpaceMessage, Project } from '@/types';

interface LegacyReviewRecord extends Omit<AIReviewEntry, 'rootPath'> {
  projectId: string;
}

type StoredData = LegacyChatSpace | ChatSpace | PyxisSession | LegacyReviewRecord | AIReviewEntry;

interface TestEntry {
  id: string;
  data: StoredData;
  timestamp: number;
}

const fixtures = vi.hoisted(() => ({
  stores: new Map<string, Map<string, TestEntry>>(),
  recentRoots: new Set<string>(),
  closedDatabases: 0,
}));

vi.mock('@/engine/core/migration/idb', () => ({
  openExisting: vi.fn(async () =>
    Object.assign(new EventTarget(), {
      close: () => {
        fixtures.closedDatabases += 1;
      },
    })
  ),
  readAll: vi.fn(async <T extends object>(_database: IDBDatabase, storeName: string) => {
    const values = fixtures.stores.get(storeName);
    if (!values) return [];
    return [...values.values()] as T[];
  }),
  readValue: vi.fn(
    async <T extends object>(_database: IDBDatabase, storeName: string, key: string) => {
      const value = fixtures.stores.get(storeName)?.get(key);
      return value as T | undefined;
    }
  ),
  writeValue: vi.fn(async (_database: IDBDatabase, storeName: string, entry: TestEntry) => {
    let values = fixtures.stores.get(storeName);
    if (!values) {
      values = new Map();
      fixtures.stores.set(storeName, values);
    }
    values.set(entry.id, entry);
  }),
}));

vi.mock('@/engine/storage', () => ({
  STORES: {
    CHAT_SPACES: 'chat_spaces',
    TAB_STATE: 'tab_state',
    AI_REVIEWS: 'ai_reviews',
  },
  storageService: {
    getAll: vi.fn(async () => []),
  },
}));

vi.mock('@/engine/storage/recentFolderStorageAdapter', () => ({
  saveRecentFolder: vi.fn(async (project: Project) => {
    fixtures.recentRoots.add(project.rootPath);
  }),
}));

function setEntry(storeName: string, id: string, data: StoredData): void {
  let values = fixtures.stores.get(storeName);
  if (!values) {
    values = new Map();
    fixtures.stores.set(storeName, values);
  }
  values.set(id, { id, data, timestamp: Date.now() });
}

function getData(storeName: string, id: string): StoredData | undefined {
  return fixtures.stores.get(storeName)?.get(id)?.data;
}

function makeSession(tabs: readonly EditorPane[]): PyxisSession {
  return {
    version: 1,
    lastSaved: 1,
    tabs: {
      panes: [...tabs],
      activePane: 'pane-root',
      globalActiveTab: 'legacy-file-id',
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

function makeChatSpace(): LegacyChatSpace {
  const message: ChatSpaceMessage = {
    id: 'message-1',
    type: 'user',
    content: 'Review this file',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    mode: 'ask',
    fileContext: ['/projects/demo/src/main.ts'],
    editResponse: {
      message: 'Updated source',
      changedFiles: [
        {
          path: '/projects/demo/src/main.ts',
          originalContent: 'old source',
          suggestedContent: 'new source',
          explanation: 'Update source',
        },
      ],
    },
  };
  return {
    id: 'chat-1',
    name: 'Review',
    projectId: 'project-1',
    messages: [message],
    selectedFiles: ['src/main.ts'],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const project: LegacyMapping = {
  id: 'project-1',
  name: 'demo',
  rootPath: '/home/pyxis/demo',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

beforeEach(() => {
  fixtures.stores.clear();
  fixtures.recentRoots.clear();
  fixtures.closedDatabases = 0;
});

describe('migrateMetadata', () => {
  it('moves global chat, file reviews, and nested tab paths to the workspace root', async () => {
    const editor = {
      id: 'legacy-file-id',
      name: 'main.ts',
      kind: 'editor',
      path: 'src/main.ts',
      paneId: 'pane-root',
      content: '',
      isDirty: false,
      projectId: 'project-1',
      fileId: 'legacy-file-id',
    } as EditorTab & { projectId: string; fileId: string };
    const nestedEditor = {
      ...editor,
      id: 'legacy-readme-id',
      name: 'README.md',
      path: 'README.md',
      paneId: 'pane-child',
      projectId: 'project-1',
      fileId: 'legacy-readme-id',
    } as EditorTab & { projectId: string; fileId: string };
    const session = makeSession([
      {
        id: 'pane-root',
        tabs: [editor],
        activeTabId: 'legacy-file-id',
        children: [
          {
            id: 'pane-child',
            tabs: [nestedEditor],
            activeTabId: 'legacy-readme-id',
          },
        ],
      },
    ]);
    const chat = makeChatSpace();
    setEntry(STORES.CHAT_SPACES, 'chatSpace:project-1:chat-1', chat);
    setEntry('user_preferences', 'current-session', session);

    const review: LegacyReviewRecord = {
      projectId: 'project-1',
      filePath: 'README.md',
      suggestedContent: 'new readme',
      originalSnapshot: 'old readme',
      status: 'pending',
      history: [],
      updatedAt: 1,
    };
    setEntry(STORES.AI_REVIEWS, 'aiReview:project-1:README.md', review);

    const files: LegacyFile[] = [
      {
        id: 'legacy-file-id',
        projectId: 'project-1',
        path: 'src/main.ts',
        type: 'file',
        content: 'old source',
        isAiAgentReview: true,
        aiAgentSuggestedContent: 'new source',
        aiAgentOriginalSnapshot: 'old source',
        aiReviewStatus: 'pending',
        aiReviewComments: 'Review this',
      },
      {
        id: 'legacy-readme-id',
        projectId: 'project-1',
        path: 'README.md',
        type: 'file',
        content: 'old readme',
      },
    ];

    await migrateMetadata([project], files, []);

    expect(getData(STORES.CHAT_SPACES, 'chatSpace:/home/pyxis/demo:chat-1')).toMatchObject({
      rootPath: '/home/pyxis/demo',
      selectedFiles: ['/home/pyxis/demo/src/main.ts'],
      messages: [
        {
          fileContext: ['/home/pyxis/demo/src/main.ts'],
          editResponse: { changedFiles: [{ path: '/home/pyxis/demo/src/main.ts' }] },
        },
      ],
    });
    expect(getData(STORES.CHAT_SPACES, 'chatSpace:/home/pyxis/demo:chat-1')).not.toHaveProperty(
      'projectId'
    );
    expect(
      getData(STORES.AI_REVIEWS, 'aiReview:/home/pyxis/demo:/home/pyxis/demo/src/main.ts')
    ).toMatchObject({
      rootPath: '/home/pyxis/demo',
      filePath: '/home/pyxis/demo/src/main.ts',
      suggestedContent: 'new source',
      originalSnapshot: 'old source',
    });
    expect(
      getData(STORES.AI_REVIEWS, 'aiReview:/home/pyxis/demo:/home/pyxis/demo/README.md')
    ).toMatchObject({
      rootPath: '/home/pyxis/demo',
      filePath: '/home/pyxis/demo/README.md',
      suggestedContent: 'new readme',
    });
    const storedSession = getData(STORES.TAB_STATE, 'tabState:/home/pyxis/demo') as PyxisSession;
    expect(storedSession.tabs.panes[0].tabs[0]).toMatchObject({
      id: '/home/pyxis/demo/src/main.ts',
      path: '/home/pyxis/demo/src/main.ts',
      rootPath: '/home/pyxis/demo',
      fileId: '/home/pyxis/demo/src/main.ts',
    });
    expect(storedSession.tabs.panes[0].activeTabId).toBe('/home/pyxis/demo/src/main.ts');
    expect(storedSession.tabs.panes[0].children?.[0].tabs[0].path).toBe(
      '/home/pyxis/demo/README.md'
    );
    expect(storedSession.tabs.panes[0].children?.[0].activeTabId).toBe(
      '/home/pyxis/demo/README.md'
    );
    expect(storedSession.tabs.globalActiveTab).toBe('/home/pyxis/demo/src/main.ts');
    expect(fixtures.recentRoots.has('/home/pyxis/demo')).toBe(true);
    expect(fixtures.closedDatabases).toBe(1);
  });

  it('keeps an empty session unmapped across retries and still records recent roots', async () => {
    const secondProject: LegacyMapping = {
      ...project,
      id: 'project-2',
      name: 'other',
      rootPath: '/home/pyxis/other',
    };
    const emptySession = makeSession([{ id: 'pane-root', tabs: [], activeTabId: '' }]);
    setEntry('user_preferences', 'current-session', emptySession);

    await migrateMetadata([project, secondProject], [], []);
    await migrateMetadata([project, secondProject], [], []);

    expect(fixtures.stores.get(STORES.TAB_STATE)?.size ?? 0).toBe(0);
    expect([...fixtures.recentRoots].sort()).toEqual(['/home/pyxis/demo', '/home/pyxis/other']);
  });

  it('creates recent-folder metadata when the legacy database has no records', async () => {
    await migrateMetadata([project], [], []);

    expect([...fixtures.recentRoots]).toEqual(['/home/pyxis/demo']);
  });

  it('preserves an empty AI suggestion and prefixes legacy absolute paths once', async () => {
    const nestedProject: LegacyMapping = {
      id: 'project-src',
      name: 'src',
      rootPath: '/home/pyxis/src',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const file: LegacyFile = {
      id: 'legacy-file',
      projectId: nestedProject.id,
      path: '/src/index.ts',
      type: 'file',
      content: 'original',
      isAiAgentReview: true,
      aiAgentSuggestedContent: '',
      aiAgentOriginalSnapshot: 'original',
    };

    await migrateMetadata([nestedProject], [file], []);

    expect(
      getData(STORES.AI_REVIEWS, 'aiReview:/home/pyxis/src:/home/pyxis/src/src/index.ts')
    ).toMatchObject({
      rootPath: '/home/pyxis/src',
      filePath: '/home/pyxis/src/src/index.ts',
      suggestedContent: '',
      originalSnapshot: 'original',
    });
  });

  it('leaves path-only sessions unmapped when legacy projects share relative paths', async () => {
    const secondProject: LegacyMapping = {
      ...project,
      id: 'project-2',
      name: 'other',
      rootPath: '/home/pyxis/other',
    };
    const pathOnlyTab: EditorTab = {
      id: 'path-only-tab',
      name: 'main.ts',
      kind: 'editor',
      path: 'src/main.ts',
      paneId: 'pane-root',
      content: '',
      isDirty: false,
    };
    const session = makeSession([
      { id: 'pane-root', tabs: [pathOnlyTab], activeTabId: 'path-only-tab' },
    ]);
    const files: LegacyFile[] = [
      { id: 'file-1', projectId: project.id, path: 'src/main.ts', type: 'file' },
      { id: 'file-2', projectId: secondProject.id, path: 'src/main.ts', type: 'file' },
    ];
    setEntry('user_preferences', 'current-session', session);

    await migrateMetadata([project, secondProject], files, []);

    expect(fixtures.stores.get(STORES.TAB_STATE)?.size ?? 0).toBe(0);
  });
});
