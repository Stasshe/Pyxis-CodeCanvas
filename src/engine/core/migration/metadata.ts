import { IDB } from '@/constants/idb';
import { isPathWithin, normalizePath } from '@/engine/core/pathUtils';
import { STORES, storageService } from '@/engine/storage';
import { saveRecentFolder } from '@/engine/storage/recentFolderStorageAdapter';
import type { EditorPane, Tab } from '@/engine/tabs/types';
import type { PyxisSession } from '@/stores/sessionStore';
import type { AIEditResponse, AIReviewEntry, AIReviewHistoryEntry, ChatSpace } from '@/types';
import { openExisting, readAll, readValue, writeValue } from './idb';
import type { LegacyChatSpace, LegacyFile, LegacyMapping } from './types';

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
  data: T
): Promise<void> {
  const entry: StoredEntry<T> = { id, data, timestamp: Date.now() };
  await writeValue(db, storeName, entry);
  const saved = await readValue<StoredEntry<T>>(db, storeName, id);
  if (!saved || saved.id !== id || JSON.stringify(saved.data) !== JSON.stringify(data)) {
    throw new Error(`Metadata write verification failed: ${id}`);
  }
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
  files: LegacyFile[],
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
  files: LegacyFile[],
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
  files: LegacyFile[]
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
  files: LegacyFile[]
): Promise<void> {
  const oldTabStates = await readAll<StoredEntry<PyxisSession>>(db, STORES.TAB_STATE);
  for (const oldTabState of oldTabStates) {
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
    await saveSession(db, oldTabState.data, mappings, files, mapping);
  }

  const legacy = await readValue<StoredEntry<PyxisSession>>(db, 'user_preferences', SESSION_KEY);
  if (!legacy) return;
  const mapping = sessionMapping(legacy.data, mappings, files);
  if (!mapping) return;
  await saveSession(db, legacy.data, mappings, files, mapping);
}

async function saveSession(
  db: IDBDatabase,
  source: PyxisSession,
  mappings: LegacyMapping[],
  files: LegacyFile[],
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

async function migrateChats(
  db: IDBDatabase,
  mappings: LegacyMapping[],
  spaces: LegacyChatSpace[]
): Promise<void> {
  const legacyEntries = await readAll<StoredEntry<LegacyChatSpace>>(db, STORES.CHAT_SPACES);
  const candidates = [...spaces, ...legacyEntries.map(entry => entry.data)];
  const migrated = new Map<string, ChatSpace>();
  for (const space of candidates) {
    if (!space.projectId) continue;
    const mapping = findMapping(mappings, space.projectId);
    const chat = migrateChat(space, mapping);
    const key = `chatSpace:${mapping.rootPath}:${space.id}`;
    const existing = migrated.get(key);
    let oldTimestamp = 0;
    if (existing) oldTimestamp = new Date(existing.updatedAt).getTime();
    if (!existing || new Date(chat.updatedAt).getTime() > oldTimestamp) migrated.set(key, chat);
  }
  for (const [key, chat] of migrated) {
    await saveEntry(db, STORES.CHAT_SPACES, key, chat);
  }
}

async function migrateReviews(
  db: IDBDatabase,
  mappings: LegacyMapping[],
  files: LegacyFile[]
): Promise<void> {
  const reviews = new Map<string, AIReviewEntry>();
  for (const file of files) {
    const mapping = findMapping(mappings, file.projectId);
    const review = reviewFromFile(file, mapping);
    if (!review) continue;
    reviews.set(reviewKey(review.rootPath, review.filePath), review);
  }

  const oldEntries = await readAll<StoredEntry<LegacyReview>>(db, 'ai_reviews');
  for (const entry of oldEntries) {
    const mapping = mappings.find(candidate => entry.data.projectId === candidate.id);
    if (!entry.data.projectId) continue;
    if (!mapping) throw new Error(`AI review has no project mapping: ${entry.data.projectId}`);
    const review = reviewFromLegacy(entry.data, mapping);
    reviews.set(reviewKey(review.rootPath, review.filePath), review);
  }

  for (const [key, review] of reviews) {
    await saveEntry(db, 'ai_reviews', key, review);
  }
}

export async function migrateMetadata(
  mappings: LegacyMapping[],
  files: LegacyFile[],
  chatSpaces: LegacyChatSpace[]
): Promise<void> {
  if (mappings.length === 0) return;
  await storageService.getAll(STORES.CHAT_SPACES);
  const db = await openExisting(IDB.GLOBAL.NAME);
  if (!db) throw new Error('Could not initialize the metadata database');
  try {
    await migrateChats(db, mappings, chatSpaces);
    await migrateReviews(db, mappings, files);
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
