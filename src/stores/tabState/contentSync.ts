import type { FileContent } from '@/engine/core/fileBytes';
import { readFileContent } from '@/engine/core/fileContent';
import { FSError, fsClient, normalizePath } from '@/engine/core/fs/index';
import { tabRegistry } from '@/engine/ide/tabs/TabRegistry';
import type { EditorPane, Tab } from '@/engine/ide/tabs/types';
import { updateCachedModelContent } from '@/hooks/editor/useMonacoModels';
import { pushLogMessage } from '@/stores/loggerStore';
import { getCurrentRootPath } from '@/stores/projectStore';
import {
  getTabContent,
  isTabDirty,
  setBufferContent,
  setTabContent,
} from '@/stores/tabContentStore';
import { collectAllTabs, findInPanes } from './paneTree';
import { tabState } from './state';

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const savingPaths = new Set<string>();
const saveGenerations = new Map<string, number>();
const activeSaveCounts = new Map<string, number>();
const saveErrors = new Map<string, Error>();
const saveListeners = new Set<(path: string, success: boolean, error?: Error) => void>();
const changeListeners = new Set<
  (path: string, content: string, source: 'editor' | 'external') => void
>();
const DEBOUNCE_MS = 1000;
let saveSyncInitialized = false;

const pendingModelUpdates = new Map<string, string>();
let modelUpdateScheduled = false;

function scheduleModelUpdateFlush(): void {
  if (modelUpdateScheduled) return;
  modelUpdateScheduled = true;
  const flush = () => {
    modelUpdateScheduled = false;
    const entries = Array.from(pendingModelUpdates.entries());
    pendingModelUpdates.clear();
    for (const [id, content] of entries) {
      try {
        updateCachedModelContent(id, content);
      } catch (e) {
        console.warn('[tabState] updateCachedModelContent failed:', id, e);
      }
    }
  };
  if (typeof window !== 'undefined') {
    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => void;
    };
    const requestIdleCallback = browserWindow.requestIdleCallback;
    if (requestIdleCallback) {
      requestIdleCallback(flush, { timeout: 500 });
      return;
    }
  }
  setTimeout(flush, 0);
}

export function getContentFromPanes(
  panes: readonly EditorPane[],
  path: string
): string | undefined {
  const tabs = collectAllTabs(panes);
  const p = normalizePath(path);

  const editorTab = tabs.find(t => t.kind === 'editor' && normalizePath(t.path || '/') === p);
  if (editorTab) return getTabContent(editorTab.id);

  const diffTab = tabs.find(t => t.kind === 'diff' && normalizePath(t.path || '/') === p);
  if (diffTab) return getTabContent(diffTab.id);

  const aiTab = tabs.find(t => t.kind === 'ai' && normalizePath(t.path || '/') === p);
  if (aiTab) return getTabContent(aiTab.id);

  return undefined;
}

function clearSaveTimer(path: string): void {
  const id = saveTimers.get(path);
  if (id) {
    clearTimeout(id);
    saveTimers.delete(path);
  }
}

function getSaveGeneration(path: string): number {
  return saveGenerations.get(path) ?? 0;
}

function invalidateSave(path: string): void {
  if (!activeSaveCounts.has(path)) return;
  saveGenerations.set(path, getSaveGeneration(path) + 1);
}

function scheduleSave(path: string, contentSnapshot: string, getPanes: () => EditorPane[]): void {
  clearSaveTimer(path);
  const id = setTimeout(async () => {
    saveTimers.delete(path);
    const content = getContentFromPanes(getPanes(), path) ?? contentSnapshot;
    try {
      await executeSave(path, content);
    } catch (e) {
      console.error('[tabState] Scheduled save failed:', e);
    }
  }, DEBOUNCE_MS);
  saveTimers.set(path, id);
}

async function executeSave(path: string, content: string): Promise<boolean> {
  const generation = getSaveGeneration(path);
  saveErrors.delete(path);
  activeSaveCounts.set(path, (activeSaveCounts.get(path) ?? 0) + 1);
  try {
    if (await fsClient.exists(path)) {
      const currentFile = await readFileContent(path);
      if (currentFile.kind === 'binary') {
        throw new Error(`Cannot save text over binary file: ${path}`);
      }
    }
    if (generation !== getSaveGeneration(path)) return false;
    const currentContentBeforeSave = getContentFromPanes(tabState.panes, path);
    if (currentContentBeforeSave !== undefined && currentContentBeforeSave !== content)
      return false;
    savingPaths.add(path);
    await fsClient.writeFile(path, content);
    savingPaths.delete(path);
    saveErrors.delete(path);

    // Check if the user typed new content during the async save.
    // If so: do NOT overwrite the store/model (would revert edits) and do NOT
    // cancel the new debounce timer (it must fire to persist the newer content).
    const currentContent = getContentFromPanes(tabState.panes, path);
    if (currentContent === undefined || currentContent === content) {
      clearSaveTimer(path);
      updateAllTabsByPath(path, content, false);
    }

    for (const l of saveListeners) l(path, true);
    return true;
  } catch (error) {
    savingPaths.delete(path);
    reportSaveFailure(path, error);
    return false;
  } finally {
    const activeCount = activeSaveCounts.get(path) ?? 0;
    if (activeCount <= 1) {
      activeSaveCounts.delete(path);
      saveGenerations.delete(path);
    } else {
      activeSaveCounts.set(path, activeCount - 1);
    }
  }
}

export function reportSaveFailure(path: string, error: unknown, message?: string): void {
  const normalizedPath = normalizePath(path);
  const saveError = error instanceof Error ? error : new Error(String(error));
  saveErrors.set(normalizedPath, saveError);
  console.error('[tabState] Save failed:', { path: normalizedPath, error: saveError });
  pushLogMessage(
    message ?? `Failed to save ${normalizedPath}: ${saveError.message}`,
    'error',
    'Editor'
  );
  for (const listener of saveListeners) listener(normalizedPath, false, saveError);
}

export function updateAllTabsByPath(
  path: string,
  content: string,
  isDirty: boolean,
  updateModel = true
): void {
  const targetPath = normalizePath(path);
  const allTabs = collectAllTabs(tabState.panes);

  for (const t of allTabs) {
    const tDef = tabRegistry.get(t.kind);
    const tPath = normalizePath(tDef?.getContentPath?.(t) ?? t.path ?? '/');
    if (tPath === targetPath && t.kind !== 'binary') {
      const prev = getTabContent(t.id);
      const currentDirty = (t.isDirty ?? false) || isTabDirty(t.id);
      const shouldUpdate = prev !== content || currentDirty !== isDirty;

      if (shouldUpdate) {
        setTabContent(t.id, content, isDirty);

        if (prev !== content && updateModel) {
          // Use filePath as model key — same file in multiple tabs shares one Monaco model
          pendingModelUpdates.set(targetPath, content);
          scheduleModelUpdateFlush();
        }

        if (currentDirty !== isDirty) {
          t.isDirty = isDirty;
        }
        const updatedTab = tDef?.updateContent?.(t, content, isDirty);
        if (updatedTab && updatedTab !== t) Object.assign(t, updatedTab);
        t.isDirty = isDirty;
      }
    }
  }
}

export async function initTabSaveSync(): Promise<void> {
  if (saveSyncInitialized) return;
  await fsClient.init();
  fsClient.addChangeListener(event => {
    void handleFsChange(event).catch(error => {
      console.error('[tabState] Filesystem change handling failed:', error);
    });
  });
  saveSyncInitialized = true;
}

function tabsForPath(path: string): Tab[] {
  return collectAllTabs(tabState.panes).filter(tab => {
    const tabPath = tabRegistry.get(tab.kind)?.getContentPath?.(tab) ?? tab.path;
    return normalizePath(tabPath || '/') === path;
  });
}

function hasDirtyTab(tabs: readonly Tab[]): boolean {
  return tabs.some(tab => tab.isDirty || isTabDirty(tab.id));
}

async function handleFsChange(event: { type: string; path: string }): Promise<void> {
  if (event.type === 'delete') return;
  if (event.type !== 'create' && event.type !== 'update') return;

  const filePath = normalizePath(event.path);
  if (savingPaths.has(filePath)) return;
  const initialTabs = tabsForPath(filePath);
  if (initialTabs.length === 0 || hasDirtyTab(initialTabs)) return;

  try {
    const content = await readFileContent(filePath);
    const currentTabs = tabsForPath(filePath);
    if (hasDirtyTab(currentTabs)) return;
    applyFileContent(filePath, content);
  } catch (error) {
    if (error instanceof FSError && error.code === 'ENOENT') return;
    console.error('[tabState] Failed to refresh changed file:', { path: filePath, error });
  }
}

function applyFileContent(path: string, content: FileContent): void {
  const updatePanes = (panes: readonly EditorPane[]): EditorPane[] =>
    panes.map(pane => {
      if (pane.children) return { ...pane, children: updatePanes(pane.children) };
      const tabs = pane.tabs.map(tab => {
        if (normalizePath(tab.path || '/') !== normalizePath(path)) return tab;
        if (tab.kind !== 'editor' && tab.kind !== 'preview' && tab.kind !== 'binary') return tab;
        if (content.kind === 'binary') {
          clearSaveTimer(normalizePath(path));
          setBufferContent(tab.id, content.bufferContent);
          if (tab.kind === 'binary' && 'bufferContent' in tab) {
            tab.bufferContent = content.bufferContent;
            tab.mimeType = content.mimeType;
            return tab;
          }
          return {
            ...tab,
            kind: 'binary' as const,
            content: '',
            isDirty: false,
            bufferContent: content.bufferContent,
            mimeType: content.mimeType,
          };
        }
        setTabContent(tab.id, content.content, false);
        if (tab.kind === 'binary') {
          return { ...tab, kind: 'editor' as const, content: content.content, isDirty: false };
        }
        return { ...tab, content: content.content, isDirty: false };
      });
      return { ...pane, tabs };
    });
  tabState.panes = updatePanes(tabState.panes);
  if (content.kind === 'text') updateFromExternal(path, content.content);
}

export function setContent(path: string, content: string): void {
  const p = normalizePath(path);
  clearSaveTimer(p);
  const all = collectAllTabs(tabState.panes);
  const tab = all.find(
    t => normalizePath(tabRegistry.get(t.kind)?.getContentPath?.(t) ?? t.path ?? '/') === p
  );
  if (tab) {
    updateTabContent(tab.id, content, true);
    scheduleSave(p, content, () => tabState.panes);
  }
  for (const l of changeListeners) l(p, content, 'editor');
}

export function updateFromExternal(path: string, content: string): void {
  const p = normalizePath(path);
  clearSaveTimer(p);
  updateAllTabsByPath(p, content, false);
  for (const l of changeListeners) l(p, content, 'external');
}

export async function saveImmediately(path: string): Promise<boolean> {
  const p = normalizePath(path);
  clearSaveTimer(p);
  const content = getContentFromPanes(tabState.panes, p);
  if (content === undefined) return false;
  return executeSave(p, content);
}

export async function flushDirtyTabFiles(): Promise<void> {
  while (true) {
    const pendingTabs = collectAllTabs(tabState.panes).filter(tab =>
      tabRegistry.get(tab.kind)?.hasPendingChanges?.(tab)
    );
    for (const tab of pendingTabs) {
      const definition = tabRegistry.get(tab.kind);
      if (!definition?.flushPendingChanges) {
        throw new Error(`Cannot save pending changes for tab: ${tab.name}`);
      }
      await definition.flushPendingChanges(tab);
      if (definition.hasPendingChanges?.(tab)) {
        throw new Error(`Pending changes remain after saving tab: ${tab.name}`);
      }
    }

    const dirtyPaths = new Set<string>();
    for (const tab of collectAllTabs(tabState.panes)) {
      if (tab.needsContentRestore || (!tab.isDirty && !isTabDirty(tab.id))) continue;
      if (tab.kind !== 'editor' && tab.kind !== 'diff' && tab.kind !== 'ai') continue;
      const path = tabRegistry.get(tab.kind)?.getContentPath?.(tab) ?? tab.path;
      if (!path) throw new Error(`Cannot save dirty tab without a file path: ${tab.id}`);
      dirtyPaths.add(normalizePath(path));
    }
    if (dirtyPaths.size === 0) {
      if (
        collectAllTabs(tabState.panes).some(tab =>
          tabRegistry.get(tab.kind)?.hasPendingChanges?.(tab)
        )
      )
        continue;
      return;
    }

    for (const path of dirtyPaths) {
      while (hasDirtyTab(tabsForPath(path))) {
        if (!(await saveImmediately(path))) {
          const saveError = saveErrors.get(path);
          const reason = saveError ? `: ${saveError.message}` : '';
          throw new Error(`Failed to save dirty file before closing: ${path}${reason}`);
        }
      }
    }
  }
}

export function removeSaveTimerForPath(path: string): void {
  const normalizedPath = normalizePath(path);
  clearSaveTimer(normalizedPath);
  invalidateSave(normalizedPath);
  saveErrors.delete(normalizedPath);
}

export function renameContentPaths(oldPath: string, newPath: string): void {
  const oldRoot = normalizePath(oldPath);
  const newRoot = normalizePath(newPath);
  const invalidatedPaths = new Set<string>();
  for (const [path, timer] of saveTimers) {
    if (path !== oldRoot && !path.startsWith(`${oldRoot}/`)) continue;
    invalidateSave(path);
    invalidatedPaths.add(path);
    saveErrors.delete(path);
    const content = getContentFromPanes(tabState.panes, path);
    clearTimeout(timer);
    saveTimers.delete(path);
    const nextPath = normalizePath(`${newRoot}${path.slice(oldRoot.length)}`);
    if (content !== undefined) scheduleSave(nextPath, content, () => tabState.panes);
  }
  for (const tab of collectAllTabs(tabState.panes)) {
    if (!tab.isDirty && !isTabDirty(tab.id)) continue;
    const path = normalizePath(tabRegistry.get(tab.kind)?.getContentPath?.(tab) ?? tab.path ?? '/');
    if (path !== oldRoot && !path.startsWith(`${oldRoot}/`)) continue;
    if (!invalidatedPaths.has(path)) invalidateSave(path);
    saveErrors.delete(path);
    const content = getTabContent(tab.id);
    if (content === undefined) continue;
    const nextPath = normalizePath(`${newRoot}${path.slice(oldRoot.length)}`);
    scheduleSave(nextPath, content, () => tabState.panes);
  }
  for (const [path, content] of pendingModelUpdates) {
    if (path !== oldRoot && !path.startsWith(`${oldRoot}/`)) continue;
    pendingModelUpdates.delete(path);
    pendingModelUpdates.set(normalizePath(`${newRoot}${path.slice(oldRoot.length)}`), content);
  }
}

export function getContent(path: string): string | undefined {
  return getContentFromPanes(tabState.panes, normalizePath(path));
}

export function isDirty(path: string): boolean {
  const info = findInPanes(tabState.panes, normalizePath(path));
  if (!info) return false;
  const t = info.tab as { isDirty?: boolean };
  return t?.isDirty ?? false;
}

export function addSaveListener(
  fn: (path: string, success: boolean, error?: Error) => void
): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

export function addChangeListener(
  fn: (path: string, content: string, source: 'editor' | 'external') => void
): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export async function loadAndUpdateTabContent(
  tabId: string,
  kind: string,
  filePath: string | undefined,
  rootPath: string | null,
  sessionGeneration: number
): Promise<void> {
  if ((kind !== 'editor' && kind !== 'binary' && kind !== 'preview') || !filePath) return;
  const openedTab = collectAllTabs(tabState.panes).find(tab => tab.id === tabId);
  if (openedTab?.isDirty || isTabDirty(tabId)) return;
  try {
    await fsClient.init();
    if (!(await fsClient.exists(filePath))) return;
    const content = await readFileContent(filePath);
    if (getCurrentRootPath() !== rootPath || tabState.sessionGeneration !== sessionGeneration) {
      return;
    }
    const currentTab = collectAllTabs(tabState.panes).find(tab => tab.id === tabId);
    if (!currentTab || currentTab.isDirty || isTabDirty(tabId)) return;
    applyFileContent(filePath, content);
  } catch (e) {
    console.warn('[tabState] Failed to load fresh content for reused tab:', e);
  }
}

export function updateTabContent(tabId: string, content: string, isDirty = false): void {
  const allTabs = collectAllTabs(tabState.panes);
  const tab = allTabs.find(t => t.id === tabId);
  if (!tab || tab.kind === 'binary') return;
  if (isDirty && getTabContent(tabId) === content) return;

  const tabDef = tabRegistry.get(tab.kind);
  const targetPath = normalizePath(tabDef?.getContentPath?.(tab) ?? tab.path ?? '/');

  if (targetPath) {
    if (tab.kind === 'editor' && !tab.isCodeMirror) {
      pendingModelUpdates.delete(targetPath);
    }
    updateAllTabsByPath(targetPath, content, isDirty, tab.kind !== 'editor' || tab.isCodeMirror);

    if (isDirty) {
      try {
        scheduleSave(targetPath, content, () => tabState.panes);
      } catch (e) {
        console.warn('[tabState] scheduleSave failed:', e);
      }
    }
  }
}
