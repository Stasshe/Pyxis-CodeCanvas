import { updateCachedModelContent } from '@/components/Tab/text-editor/hooks/useMonacoModels';
import type { FileChangeEvent } from '@/engine/core/fileRepository';
import { fileRepository, toAppPath } from '@/engine/core/fileRepository';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { EditorPane } from '@/engine/tabs/types';
import { getCurrentProjectId } from '@/stores/projectStore';
import { getTabContent, setTabContent } from '@/stores/tabContentStore';
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
let unsubscribeFileRepository: (() => void) | null = null;

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
        updateCachedModelContent(id, content, 'tabState');
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
  const p = toAppPath(path);

  const editorTab = tabs.find(t => t.kind === 'editor' && toAppPath(t.path || '') === p);
  if (editorTab) return getTabContent(editorTab.id);

  const diffTab = tabs.find(t => t.kind === 'diff' && toAppPath(t.path || '') === p);
  if (diffTab) return getTabContent(diffTab.id);

  const aiTab = tabs.find(t => t.kind === 'ai' && toAppPath(t.path || '') === p);
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
  const projectId = getCurrentProjectId();
  if (!projectId) {
    console.error('[tabState] No project ID for save');
    for (const l of saveListeners) l(path, false, new Error('No project ID'));
    return false;
  }
  try {
    savingPaths.add(path);
    await fileRepository.saveFileByPath(projectId, path, content);
    savingPaths.delete(path);
    clearSaveTimer(path);
    updateAllTabsByPath(path, content, false);
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
  const targetPath = toAppPath(path);
  const allTabs = collectAllTabs(tabState.panes);

  for (const t of allTabs) {
    const tDef = tabRegistry.get(t.kind);
    const tPath = toAppPath(tDef?.getContentPath?.(t) ?? t.path ?? '');
    if (tPath === targetPath) {
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
  await fileRepository.init();
  unsubscribeFileRepository = fileRepository.addChangeListener(handleFileRepositoryChange);
  saveSyncInitialized = true;
}

function handleFileRepositoryChange(event: FileChangeEvent): void {
  if (event.type === 'delete') return;
  if (event.type !== 'create' && event.type !== 'update') return;

  const file = event.file as { path?: string; content?: string };
  const filePath = toAppPath(file?.path ?? '');
  const newContent = (file?.content ?? '') as string;
  if (savingPaths.has(filePath)) return;

  const allTabs = collectAllTabs(tabState.panes);
  const hasTab = allTabs.some(t => {
    const tDef = tabRegistry.get(t.kind);
    const p = toAppPath(tDef?.getContentPath?.(t) ?? t.path ?? '');
    return p === filePath;
  });
  if (!hasTab) return;

  const current = getContentFromPanes(tabState.panes, filePath);
  if (current === newContent) return;

  updateFromExternal(filePath, newContent);
}

export function setContent(path: string, content: string): void {
  const p = toAppPath(path);
  clearSaveTimer(p);
  const all = collectAllTabs(tabState.panes);
  const tab = all.find(
    t => toAppPath(tabRegistry.get(t.kind)?.getContentPath?.(t) ?? t.path ?? '') === p
  );
  if (tab) {
    updateTabContent(tab.id, content, true);
    scheduleSave(p, () => tabState.panes);
  }
  for (const l of changeListeners) l(p, content, 'editor');
}

export function updateFromExternal(path: string, content: string): void {
  const p = toAppPath(path);
  clearSaveTimer(p);
  updateAllTabsByPath(p, content, false);
  for (const l of changeListeners) l(p, content, 'external');
}

export async function saveImmediately(path: string): Promise<boolean> {
  const p = toAppPath(path);
  clearSaveTimer(p);
  const content = getContentFromPanes(tabState.panes, p);
  if (content === undefined) return false;
  return executeSave(p, content);
}

export function removeSaveTimerForPath(path: string): void {
  clearSaveTimer(toAppPath(path));
}

export function getContent(path: string): string | undefined {
  return getContentFromPanes(tabState.panes, toAppPath(path));
}

export function isDirty(path: string): boolean {
  const info = findInPanes(tabState.panes, toAppPath(path));
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
  try {
    const projectId = getCurrentProjectId();
    if (!projectId) return;
    const fresh = await fileRepository.getFileByPath(projectId, filePath);
    if (fresh?.content !== undefined) {
      if (kind === 'preview') {
        setTabContent(tabId, fresh.content, false);
      } else {
        updateTabContent(tabId, fresh.content, false);
      }
    }
  } catch (e) {
    console.warn('[tabState] Failed to load fresh content for reused tab:', e);
  }
}

export function updateTabContent(tabId: string, content: string, isDirty = false): void {
  const allTabs = collectAllTabs(tabState.panes);
  const tab = allTabs.find(t => t.id === tabId);
  if (!tab) return;

  const tabDef = tabRegistry.get(tab.kind);
  const targetPath = toAppPath(tabDef?.getContentPath?.(tab) ?? tab.path ?? '');

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
