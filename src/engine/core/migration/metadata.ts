import { IDB } from '@/constants/idb';
import { isPathWithin, normalizePath } from '@/engine/core/pathUtils';
import { STORES, storageService } from '@/engine/storage';
import { saveRecentFolder } from '@/engine/storage/recentFolderStorageAdapter';
import type { EditorPane, Tab } from '@/engine/tabs/types';
import type { PyxisSession } from '@/stores/sessionStore';
import type { AIEditResponse, AIReviewEntry, AIReviewHistoryEntry, ChatSpace } from '@/types';
import { iterateAllKeyed, openExisting, readValue, writeValue } from './idb';
import type { LegacyChatSpace, LegacyFile, LegacyFileReference, LegacyMapping } from './types';

interface StoredEntry<T> {
  id: string;
  data: T;
  timestamp: number;
  expiresAt?: number;
}

interface LegacyReview extends Omit<AIReviewEntry, 'rootPath'> {
  projectId: string;
}

type LegacyTab = Tab & {
  projectId?: string;
  rootPath?: string;
  filePath?: string;
  fileId?: string;
};

const SESSION_KEY = 'current-session';

function findMapping(mappings: LegacyMapping[], projectId: string): LegacyMapping {
  const mapping = mappings.find(candidate => candidate.id === projectId);
  if (!mapping) throw new Error(`Metadata has no project mapping: ${projectId}`);
  return mapping;
}

function absolutePath(mapping: LegacyMapping, path: string): string {
  if (!path) return path;
  const projectPrefix = `/projects/${mapping.name}`;
  let relativePath = path;
  if (relativePath === projectPrefix) relativePath = '';
  if (relativePath.startsWith(`${projectPrefix}/`)) {
    relativePath = relativePath.slice(projectPrefix.length);
  }
  relativePath = relativePath.replace(/^\/+/, '');
  if (!relativePath) return mapping.rootPath;
  const absolute = normalizePath(`${mapping.rootPath}/${relativePath}`);
  if (!isPathWithin(absolute, mapping.rootPath)) {
    throw new Error(`Legacy metadata path escapes project root: ${path}`);
  }
  return absolute;
}

function reviewKey(rootPath: string, filePath: string): string {
  return `aiReview:${rootPath}:${filePath}`;
}

async function saveEntry<T>(
  db: IDBDatabase,
  storeName: string,
  id: string,
  data: T,
  source?: { db: IDBDatabase; store: string; key: IDBValidKey; value: SourceValue },
  equivalent?: (existing: T, next: T) => boolean
): Promise<void> {
  const existing = await readValue<StoredEntry<T>>(db, storeName, id);
  if (existing) {
    if (existing.id === id && JSON.stringify(existing.data) === JSON.stringify(data)) return;
    const isSourceRecord =
      existing.id === id &&
      source?.db === db &&
      source.store === storeName &&
      source.key === id &&
      JSON.stringify(existing) === JSON.stringify(source.value);
    if (!isSourceRecord) {
      if (existing.id === id && equivalent?.(existing.data, data)) return;
      throw new Error(`Metadata destination already contains different data: ${id}`);
    }
  }
  const entry: StoredEntry<T> = { id, data, timestamp: Date.now() };
  await writeValue(db, storeName, entry);
  const saved = await readValue<StoredEntry<T>>(db, storeName, id);
  if (!saved || saved.id !== id || JSON.stringify(saved.data) !== JSON.stringify(data)) {
    throw new Error(`Metadata write verification failed: ${id}`);
  }
}

function sameReviewExceptTimestamp(existing: AIReviewEntry, next: AIReviewEntry): boolean {
  const { updatedAt: _existingUpdatedAt, ...existingData } = existing;
  const { updatedAt: _nextUpdatedAt, ...nextData } = next;
  return JSON.stringify(existingData) === JSON.stringify(nextData);
}

function reviewFromFile(file: LegacyFile, mapping: LegacyMapping): AIReviewEntry | null {
  let suggestedContent = file.aiAgentSuggestedContent;
  if (suggestedContent === undefined && file.isAiAgentReview) suggestedContent = file.aiAgentCode;
  if (suggestedContent === undefined) return null;
  const history: readonly AIReviewHistoryEntry[] = file.aiReviewHistory ?? [];
  const filePath = absolutePath(mapping, file.path);
  const review: AIReviewEntry = {
    rootPath: mapping.rootPath,
    filePath,
    suggestedContent,
    originalSnapshot: file.aiAgentOriginalSnapshot ?? file.content ?? '',
    status: file.aiReviewStatus ?? 'pending',
    comments: file.aiReviewComments,
    history,
    updatedAt: reviewTimestamp(file.aiReviewHistory),
  };
  return review;
}

function reviewTimestamp(history: LegacyFile['aiReviewHistory']): number {
  const latest = history?.[0];
  if (!latest) return Date.now();
  return latest.timestamp.getTime();
}

function migrateEditResponse(
  response: AIEditResponse | undefined,
  mapping: LegacyMapping
): AIEditResponse | undefined {
  if (!response) return undefined;
  return {
    ...response,
    changedFiles: response.changedFiles.map(file => ({
      ...file,
      path: absolutePath(mapping, file.path),
    })),
  };
}

function reviewFromLegacy(review: LegacyReview, mapping: LegacyMapping): AIReviewEntry {
  const { projectId: _projectId, ...reviewData } = review;
  return {
    ...reviewData,
    rootPath: mapping.rootPath,
    filePath: absolutePath(mapping, review.filePath),
  };
}

function migrateChat(space: LegacyChatSpace, mapping: LegacyMapping): ChatSpace {
  const { projectId: _projectId, ...chatData } = space;
  return {
    ...chatData,
    rootPath: mapping.rootPath,
    selectedFiles: space.selectedFiles.map(path => absolutePath(mapping, path)),
    messages: space.messages.map(message => ({
      ...message,
      fileContext: message.fileContext?.map(path => absolutePath(mapping, path)),
      editResponse: migrateEditResponse(message.editResponse, mapping),
    })),
  };
}

function updateId(id: string, oldPath: string, newPath: string): string {
  if (!oldPath) return id;
  return id.split(oldPath).join(newPath);
}

function migrateTab(
  tab: Tab,
  mappings: LegacyMapping[],
  files: LegacyFileReference[],
  fallback: LegacyMapping
): Tab {
  const legacyTab = tab as LegacyTab;
  const idFile = files.find(file => file.id === legacyTab.fileId);
  let mapping = fallback;
  if (legacyTab.projectId) mapping = findMapping(mappings, legacyTab.projectId);
  else if (idFile) mapping = findMapping(mappings, idFile.projectId);
  const previousPath = tab.path;
  const path = absolutePath(mapping, previousPath);
  const legacyFile = files.find(
    file => file.projectId === mapping.id && file.id === legacyTab.fileId
  );
  let id = updateId(tab.id, previousPath, path);
  if (legacyFile) id = updateId(id, legacyFile.id, absolutePath(mapping, legacyFile.path));
  const { projectId: _projectId, ...tabData } = legacyTab;
  const migrated = {
    ...tabData,
    id,
    path,
    rootPath: mapping.rootPath,
  } as LegacyTab;
  if (migrated.filePath) migrated.filePath = absolutePath(mapping, migrated.filePath);
  if (legacyFile) migrated.fileId = absolutePath(mapping, legacyFile.path);

  if (migrated.kind === 'ai' && migrated.aiEntry) {
    const legacyEntry = migrated.aiEntry as AIReviewEntry & { projectId?: string };
    const { projectId: _projectId, ...entryData } = legacyEntry;
    migrated.aiEntry = {
      ...entryData,
      rootPath: mapping.rootPath,
      filePath: absolutePath(mapping, migrated.aiEntry.filePath),
    };
  }
  if (migrated.kind === 'diff') {
    return {
      ...migrated,
      diffs: migrated.diffs.map(diff => ({
        ...diff,
        formerFullPath: absolutePath(mapping, diff.formerFullPath),
        latterFullPath: absolutePath(mapping, diff.latterFullPath),
      })),
    };
  }
  if (migrated.kind === 'merge-conflict') {
    return {
      ...migrated,
      conflicts: migrated.conflicts.map(conflict => ({
        ...conflict,
        filePath: absolutePath(mapping, conflict.filePath),
      })),
    };
  }
  return migrated;
}

function migratePanes(
  panes: readonly EditorPane[],
  mappings: LegacyMapping[],
  files: LegacyFileReference[],
  fallback: LegacyMapping,
  tabIds: Map<string, string>
): EditorPane[] {
  return panes.map(pane => {
    const tabs = pane.tabs.map(tab => {
      const migrated = migrateTab(tab, mappings, files, fallback);
      tabIds.set(tab.id, migrated.id);
      return migrated;
    });
    let children: EditorPane[] | undefined;
    if (pane.children) {
      children = migratePanes(pane.children, mappings, files, fallback, tabIds);
    }
    return {
      ...pane,
      activeTabId: tabIds.get(pane.activeTabId) ?? pane.activeTabId,
      tabs,
      children,
    };
  });
}

function sessionMapping(
  session: PyxisSession,
  mappings: LegacyMapping[],
  files: LegacyFileReference[]
): LegacyMapping | null {
  const findInPanes = (panes: readonly EditorPane[]): string | null => {
    for (const pane of panes) {
      for (const tab of pane.tabs) {
        const legacyTab = tab as LegacyTab;
        const legacyFile = files.find(file => file.id === legacyTab.fileId);
        const projectId = legacyTab.projectId ?? legacyFile?.projectId;
        if (projectId) return projectId;
      }
      if (pane.children) {
        const projectId = findInPanes(pane.children);
        if (projectId) return projectId;
      }
    }
    return null;
  };
  const projectId = findInPanes(session.tabs.panes);
  if (projectId) return findMapping(mappings, projectId);
  if (mappings.length === 1) return mappings[0];
  return null;
}

async function migrateSession(
  db: IDBDatabase,
  mappings: LegacyMapping[],
  files: LegacyFileReference[]
): Promise<void> {
  const sources = new Map<string, { store: string; key: IDBValidKey; mapping: LegacyMapping }>();
  for await (const { key, value: oldTabState } of iterateAllKeyed<StoredEntry<PyxisSession>>(
    db,
    STORES.TAB_STATE
  )) {
    const targetAlready = mappings.some(
      mapping => oldTabState.id === `tabState:${mapping.rootPath}`
    );
    if (targetAlready) continue;
    const keyedProject = mappings.find(
      mapping => oldTabState.id === mapping.id || oldTabState.id === `tabState:${mapping.id}`
    );
    let mapping = keyedProject;
    if (!mapping) mapping = sessionMapping(oldTabState.data, mappings, files) ?? undefined;
    if (!mapping) continue;
    sources.set(mapping.rootPath, { store: STORES.TAB_STATE, key, mapping });
  }

  {
    const legacy = await readValue<StoredEntry<PyxisSession>>(db, 'user_preferences', SESSION_KEY);
    if (legacy) {
      const mapping = sessionMapping(legacy.data, mappings, files);
      if (mapping) {
        sources.set(mapping.rootPath, { store: 'user_preferences', key: SESSION_KEY, mapping });
      }
    }
  }

  for (const source of sources.values()) {
    const stored = await readValue<StoredEntry<PyxisSession>>(db, source.store, source.key);
    if (!stored)
      throw new Error(`Legacy session source disappeared: ${source.store}/${source.key}`);
    await saveSession(db, stored.data, mappings, files, source.mapping);
  }
}

async function saveSession(
  db: IDBDatabase,
  source: PyxisSession,
  mappings: LegacyMapping[],
  files: LegacyFileReference[],
  mapping: LegacyMapping
): Promise<void> {
  const tabIds = new Map<string, string>();
  const panes = migratePanes(source.tabs.panes, mappings, files, mapping, tabIds);
  const session: PyxisSession = {
    ...source,
    tabs: {
      ...source.tabs,
      panes,
      globalActiveTab: remapTabId(source.tabs.globalActiveTab, tabIds),
    },
  };
  await saveEntry(db, STORES.TAB_STATE, `tabState:${mapping.rootPath}`, session);
}

function remapTabId(tabId: string | null, tabIds: Map<string, string>): string | null {
  if (tabId === null) return null;
  return tabIds.get(tabId) ?? tabId;
}

interface SourcePointer {
  db: IDBDatabase;
  store: string;
  key: IDBValidKey;
  format: 'project' | 'stored';
}

type SourceValue = LegacyFile | LegacyChatSpace | StoredEntry<LegacyChatSpace | LegacyReview>;

async function migrateChats(
  db: IDBDatabase,
  mappings: LegacyMapping[],
  projectsDb: IDBDatabase | null
): Promise<void> {
  const sources = new Map<string, { pointer: SourcePointer; timestamp: number }>();
  const consider = (space: LegacyChatSpace, pointer: SourcePointer): void => {
    if (!space.projectId) return;
    const mapping = findMapping(mappings, space.projectId);
    const key = `chatSpace:${mapping.rootPath}:${space.id}`;
    const timestamp = new Date(space.updatedAt).getTime();
    const existing = sources.get(key);
    if (!existing || timestamp > existing.timestamp) sources.set(key, { pointer, timestamp });
  };
  if (projectsDb) {
    for await (const { key, value } of iterateAllKeyed<LegacyChatSpace>(projectsDb, 'chatSpaces')) {
      consider(value, { db: projectsDb, store: 'chatSpaces', key, format: 'project' });
    }
  }
  for await (const { key, value } of iterateAllKeyed<StoredEntry<LegacyChatSpace>>(
    db,
    STORES.CHAT_SPACES
  )) {
    consider(value.data, { db, store: STORES.CHAT_SPACES, key, format: 'stored' });
  }
  for (const [targetKey, source] of sources) {
    let raw: SourceValue;
    let space: LegacyChatSpace;
    if (source.pointer.format === 'project') {
      const projectSpace = await readValue<LegacyChatSpace>(
        source.pointer.db,
        source.pointer.store,
        source.pointer.key
      );
      if (!projectSpace) throw new Error(`Legacy chat source disappeared: ${targetKey}`);
      raw = projectSpace;
      space = projectSpace;
    } else {
      const storedSpace = await readValue<StoredEntry<LegacyChatSpace>>(
        source.pointer.db,
        source.pointer.store,
        source.pointer.key
      );
      if (!storedSpace) throw new Error(`Legacy chat source disappeared: ${targetKey}`);
      raw = storedSpace;
      space = storedSpace.data;
    }
    const mapping = findMapping(mappings, space.projectId);
    const chat = migrateChat(space, mapping);
    await saveEntry(db, STORES.CHAT_SPACES, targetKey, chat, {
      key: source.pointer.key,
      value: raw,
      store: source.pointer.store,
      db: source.pointer.db,
    });
  }
}

async function migrateReviews(
  db: IDBDatabase,
  mappings: LegacyMapping[],
  files: LegacyFileReference[],
  projectsDb: IDBDatabase | null
): Promise<void> {
  const reviews = new Map<string, SourcePointer>();
  for (const file of files) {
    if (!file.hasReview || !projectsDb) continue;
    const mapping = findMapping(mappings, file.projectId);
    reviews.set(reviewKey(mapping.rootPath, absolutePath(mapping, file.path)), {
      db: projectsDb,
      store: 'files',
      key: file.key,
      format: 'project',
    });
  }

  for await (const { key, value: entry } of iterateAllKeyed<StoredEntry<LegacyReview>>(
    db,
    'ai_reviews'
  )) {
    const mapping = mappings.find(candidate => entry.data.projectId === candidate.id);
    if (!entry.data.projectId) continue;
    if (!mapping) throw new Error(`AI review has no project mapping: ${entry.data.projectId}`);
    reviews.set(reviewKey(mapping.rootPath, absolutePath(mapping, entry.data.filePath)), {
      db,
      store: 'ai_reviews',
      key,
      format: 'stored',
    });
  }

  for (const [targetKey, source] of reviews) {
    let review: AIReviewEntry;
    let historylessFile = false;
    let raw: SourceValue;
    if (source.format === 'project') {
      const file = await readValue<LegacyFile>(source.db, source.store, source.key);
      if (!file) throw new Error(`Legacy review source disappeared: ${targetKey}`);
      raw = file;
      const migrated = reviewFromFile(file, findMapping(mappings, file.projectId));
      if (!migrated) continue;
      review = migrated;
      historylessFile = !file.aiReviewHistory?.length;
    } else {
      const storedReview = await readValue<StoredEntry<LegacyReview>>(
        source.db,
        source.store,
        source.key
      );
      if (!storedReview) throw new Error(`Legacy review source disappeared: ${targetKey}`);
      raw = storedReview;
      const data = storedReview.data;
      review = reviewFromLegacy(data, findMapping(mappings, data.projectId));
    }
    let equivalent: ((existing: AIReviewEntry, next: AIReviewEntry) => boolean) | undefined;
    if (historylessFile) equivalent = sameReviewExceptTimestamp;
    await saveEntry(
      db,
      'ai_reviews',
      targetKey,
      review,
      {
        db: source.db,
        store: source.store,
        key: source.key,
        value: raw,
      },
      equivalent
    );
  }
}

export async function migrateMetadata(
  mappings: LegacyMapping[],
  files: LegacyFileReference[],
  projectsDb: IDBDatabase | null
): Promise<void> {
  if (mappings.length === 0) return;
  await storageService.initialize();
  const db = await openExisting(IDB.GLOBAL.NAME);
  if (!db) throw new Error('Could not initialize the metadata database');
  try {
    await migrateChats(db, mappings, projectsDb);
    await migrateReviews(db, mappings, files, projectsDb);
    await migrateSession(db, mappings, files);
    for (const mapping of mappings) {
      await saveRecentFolder({
        rootPath: mapping.rootPath,
        name: mapping.name,
        updatedAt: mapping.updatedAt ?? new Date(),
      });
    }
  } finally {
    db.close();
  }
}
