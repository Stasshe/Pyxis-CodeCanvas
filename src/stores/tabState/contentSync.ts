import { updateCachedModelContent } from '@/components/Tab/text-editor/hooks/useMonacoModels';
import type { FileContent } from '@/engine/core/fileBytes';
import { readFileContent } from '@/engine/core/fileContent';
import { FSError, fsClient, normalizePath } from '@/engine/core/fs';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { EditorPane, Tab } from '@/engine/tabs/types';
import { getCurrentRootPath } from '@/stores/projectStore';
import {
  getTabContent,
  isTabDirty,
  setBufferContent,
  setTabContent,
} from '@/stores/tabContentStore';
import { collectAllTabs, findInPanes } from './paneUtils';
import { tabState } from './state';

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const savingPaths = new Set<string>();
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

function scheduleSave(path: string, getPanes: () => EditorPane[]): void {
  clearSaveTimer(path);
  const id = setTimeout(async () => {
    saveTimers.delete(path);
    const content = getContentFromPanes(getPanes(), path);
    if (content !== undefined) {
      try {
        await executeSave(path, content);
      } catch (e) {
        console.error('[tabState] Scheduled save failed:', e);
      }
    }
  }, DEBOUNCE_MS);
  saveTimers.set(path, id);
}

async function executeSave(path: string, content: string): Promise<boolean> {
  if (!getCurrentRootPath()) {
    console.error('[tabState] No workspace root for save');
    for (const l of saveListeners) l(path, false, new Error('No workspace root'));
    return false;
  }
  try {
    if (await fsClient.exists(path)) {
      const currentFile = await readFileContent(path);
      if (currentFile.kind === 'binary') {
        throw new Error(`Cannot save text over binary file: ${path}`);
      }
    }
    const currentContentBeforeSave = getContentFromPanes(tabState.panes, path);
    if (currentContentBeforeSave !== content) return false;
    savingPaths.add(path);
    await fsClient.writeFile(path, content);
    savingPaths.delete(path);

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
    console.error('[tabState] Save failed:', { path, error });
    for (const l of saveListeners) l(path, false, error as Error);
    return false;
  }
}

export function updateAllTabsByPath(path: string, content: string, isDirty: boolean): void {
  const targetPath = normalizePath(path);
  const allTabs = collectAllTabs(tabState.panes);

  for (const t of allTabs) {
    const tDef = tabRegistry.get(t.kind);
    const tPath = normalizePath(tDef?.getContentPath?.(t) ?? t.path ?? '/');
    if (tPath === targetPath && t.kind !== 'binary') {
      const prev = getTabContent(t.id);
      const currentDirty = t.isDirty ?? false;
      const shouldUpdate = prev !== content || currentDirty !== isDirty;

      if (shouldUpdate) {
        setTabContent(t.id, content, isDirty);

        if (prev !== content) {
          // Use filePath as model key — same file in multiple tabs shares one Monaco model
          if (!pendingModelUpdates.has(targetPath)) {
            pendingModelUpdates.set(targetPath, content);
            scheduleModelUpdateFlush();
          }
        }

        if (currentDirty !== isDirty) {
          t.isDirty = isDirty;
        }
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
    scheduleSave(p, () => tabState.panes);
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

export function removeSaveTimerForPath(path: string): void {
  clearSaveTimer(normalizePath(path));
}

export function renameContentPaths(oldPath: string, newPath: string): void {
  const oldRoot = normalizePath(oldPath);
  const newRoot = normalizePath(newPath);
  for (const [path, timer] of saveTimers) {
    if (path !== oldRoot && !path.startsWith(`${oldRoot}/`)) continue;
    clearTimeout(timer);
    saveTimers.delete(path);
    const nextPath = normalizePath(`${newRoot}${path.slice(oldRoot.length)}`);
    scheduleSave(nextPath, () => tabState.panes);
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
  filePath: string | undefined
): Promise<void> {
  if ((kind !== 'editor' && kind !== 'binary' && kind !== 'preview') || !filePath) return;
  const openedTab = collectAllTabs(tabState.panes).find(tab => tab.id === tabId);
  if (openedTab?.isDirty || isTabDirty(tabId)) return;
  try {
    await fsClient.init();
    if (!(await fsClient.exists(filePath))) return;
    const content = await readFileContent(filePath);
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

  const tabDef = tabRegistry.get(tab.kind);
  const targetPath = normalizePath(tabDef?.getContentPath?.(tab) ?? tab.path ?? '/');

  if (targetPath) {
    updateAllTabsByPath(targetPath, content, isDirty);

    if (isDirty) {
      try {
        scheduleSave(targetPath, () => tabState.panes);
      } catch (e) {
        console.warn('[tabState] scheduleSave failed:', e);
      }
    }
  }
}
