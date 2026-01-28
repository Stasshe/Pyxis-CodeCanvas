/**
 * tabState - Valtio によるタブ状態管理
 *
 * EditorMemoryManager の責務（デバウンス保存、外部変更検知、保存制御）を
 * このモジュールに統合し、content は Tab オブジェクト内に直接保持する。
 */

import { proxy, snapshot } from 'valtio';

import { updateCachedModelContent } from '@/components/Tab/text-editor/hooks/useMonacoModels';
import type { FileChangeEvent } from '@/engine/core/fileRepository';
import { fileRepository, toAppPath } from '@/engine/core/fileRepository';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { DiffTab, EditorPane, OpenTabOptions, Tab, TabFileInfo } from '@/engine/tabs/types';
import { getCurrentProjectId } from '@/stores/projectStore';

// ---------------------------------------------------------------------------
// 保存・デバウンス用モジュール状態（旧 EditorMemoryManager の責務）
// ---------------------------------------------------------------------------
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const savingPaths = new Set<string>();
const saveListeners = new Set<(path: string, success: boolean, error?: Error) => void>();
const changeListeners = new Set<
  (path: string, content: string, source: 'editor' | 'external') => void
>();
const DEBOUNCE_MS = 1000;
let saveSyncInitialized = false;
let unsubscribeFileRepository: (() => void) | null = null;

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------
function flattenLeafPanes(panes: readonly EditorPane[], result: EditorPane[] = []): EditorPane[] {
  for (const p of panes) {
    if (!p.children || p.children.length === 0) {
      result.push(p);
    } else {
      flattenLeafPanes(p.children, result);
    }
  }
  return result;
}

function normalizeTabPath(p?: string): string {
  if (!p) return '';
  const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
  const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function findPaneRecursive(panes: readonly EditorPane[], paneId: string): EditorPane | null {
  for (const pane of panes) {
    if (pane.id === paneId) return pane;
    if (pane.children) {
      const found = findPaneRecursive(pane.children, paneId);
      if (found) return found;
    }
  }
  return null;
}

function collectAllTabs(panes: readonly EditorPane[]): Tab[] {
  const tabs: Tab[] = [];
  for (const pane of panes) {
    tabs.push(...pane.tabs);
    if (pane.children) tabs.push(...collectAllTabs(pane.children));
  }
  return tabs;
}

/**
 * 指定されたパスに対応するタブをペイン階層から検索する。
 *
 * - path は toAppPath で正規化して比較する。
 * - kind を指定した場合: その kind と完全一致するタブのみを対象とする。
 * - kind を省略/undefined の場合: kind は問わず、パスが一致するタブであればよい。
 */
function findInPanes(
  panes: readonly EditorPane[],
  path: string,
  kind?: string
): { paneId: string; tab: Tab } | null {
  const normalizedPath = toAppPath(path);

  for (const pane of panes) {
    const tab = pane.tabs.find(t => {
      const samePath = toAppPath(t.path || '') === normalizedPath;
      const matchesKind = kind === undefined || t.kind === kind;
      return samePath && matchesKind;
    });
    if (tab) return { paneId: pane.id, tab };
    if (pane.children) {
      const found = findInPanes(pane.children, path, kind);
      if (found) return found;
    }
  }
  return null;
}

function getContentFromPanes(panes: readonly EditorPane[], path: string): string | undefined {
  const tabs = collectAllTabs(panes);
  const p = toAppPath(path);
  const editorTab = tabs.find(t => t.kind === 'editor' && toAppPath(t.path || '') === p);
  if (editorTab && 'content' in editorTab) return (editorTab as { content: string }).content;
  const diffTab = tabs.find(t => t.kind === 'diff' && toAppPath(t.path || '') === p) as
    | DiffTab
    | undefined;
  if (diffTab?.diffs?.length) return diffTab.diffs[0].latterContent;
  return undefined;
}

// ---------------------------------------------------------------------------
// 保存・デバウンス 内部
// ---------------------------------------------------------------------------
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
    // isDirty のクリアは updateFromExternal 経由で updateTabContent を呼ぶのと同様の扱い
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

// 同一 path の全タブを content / isDirty で更新する（タブ構造は snapshot から取得してから置換）
function updateAllTabsByPath(path: string, content: string, isDirty: boolean): void {
  const current = snapshot(tabState);
  const targetPath = toAppPath(path);

  const updatePanesRecursive = (panes: readonly EditorPane[]): EditorPane[] => {
    return panes.map(pane => {
      if (pane.children?.length) {
        return { ...pane, children: updatePanesRecursive(pane.children) };
      }
      let changed = false;
      const newTabs = pane.tabs.map(t => {
        const tDef = tabRegistry.get(t.kind);
        const tPath = toAppPath(tDef?.getContentPath?.(t) ?? t.path ?? '');
        if (tPath !== targetPath || !tDef?.updateContent) return t;
        const updated = tDef.updateContent(t, content, isDirty);
        if (updated !== t) changed = true;
        return updated;
      });
      return changed ? { ...pane, tabs: newTabs } : pane;
    });
  };

  const next = updatePanesRecursive(current.panes);
  if (next !== current.panes) tabState.panes = next;
}

// ---------------------------------------------------------------------------
// Proxy 状態
// ---------------------------------------------------------------------------
export const tabState = proxy({
  panes: [] as EditorPane[],
  activePane: null as string | null,
  globalActiveTab: null as string | null,
  isLoading: true,
  isRestored: false,
  isContentRestored: false,
});

// ---------------------------------------------------------------------------
// 公開: 保存・同期の初期化（fileRepository リスナー登録）
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 公開: 保存・変更の API（旧 EditorMemoryManager 互換）
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 非同期: loadAndUpdateTabContent（openTab 内で使用）
// ---------------------------------------------------------------------------
async function loadAndUpdateTabContent(
  tabId: string,
  kind: string,
  filePath: string | undefined
): Promise<void> {
  if ((kind !== 'editor' && kind !== 'binary') || !filePath) return;
  try {
    const projectId = getCurrentProjectId();
    if (!projectId) return;
    const fresh = await fileRepository.getFileByPath(projectId, filePath);
    if (fresh?.content !== undefined) tabActions.updateTabContent(tabId, fresh.content, false);
  } catch (e) {
    console.warn('[tabState] Failed to load fresh content for reused tab:', e);
  }
}

// ---------------------------------------------------------------------------
// タブ操作: updateTabContent（全同一 path タブ更新 + 必要に応じて Monaco キャッシュ）
// ---------------------------------------------------------------------------
function updateTabContent(tabId: string, content: string, isDirty = false): void {
  const allTabs = collectAllTabs(tabState.panes);
  const tab = allTabs.find(t => t.id === tabId);
  if (!tab) return;

  const tabDef = tabRegistry.get(tab.kind);
  if (!tabDef?.updateContent) return;

  const targetPath = toAppPath(tabDef.getContentPath?.(tab) ?? tab.path ?? '');
  if (!targetPath) return;

  const updatedIds: string[] = [];
  const current = snapshot(tabState);

  const updatePanesRecursive = (panes: readonly EditorPane[]): EditorPane[] => {
    return panes.map(pane => {
      if (pane.children?.length) {
        return { ...pane, children: updatePanesRecursive(pane.children) };
      }
      let paneChanged = false;
      const newTabs = pane.tabs.map(t => {
        const def = tabRegistry.get(t.kind);
        const tp = toAppPath(def?.getContentPath?.(t) ?? t.path ?? '');
        if (tp !== targetPath || !def?.updateContent) return t;
        const updated = def.updateContent(t, content, isDirty);
        if (updated !== t) {
          paneChanged = true;
          updatedIds.push(t.id);
        }
        return updated;
      });
      return paneChanged ? { ...pane, tabs: newTabs } : pane;
    });
  };

  const next = updatePanesRecursive(current.panes);
  if (next !== current.panes) {
    tabState.panes = next;
    for (const id of updatedIds) {
      try {
        updateCachedModelContent(id, content, 'tabState');
      } catch (e) {
        console.warn('[tabState] updateCachedModelContent failed:', id, e);
      }
    }

    // If this update marks content as dirty, ensure a debounced save is scheduled.
    // This covers code paths that call `updateTabContent` directly (e.g. editor components)
    // instead of using `setContent` which already schedules saves.
    if (isDirty && targetPath) {
      try {
        scheduleSave(targetPath, () => tabState.panes);
      } catch (e) {
        console.warn('[tabState] scheduleSave failed:', e);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// tabActions（旧 useTabStore のアクション）
// ---------------------------------------------------------------------------
function getPane(paneId: string): EditorPane | null {
  return findPaneRecursive(tabState.panes, paneId);
}

export const tabActions = {
  setIsLoading(loading: boolean) {
    tabState.isLoading = loading;
    tabState.isRestored = !loading;
  },
  setIsContentRestored(restored: boolean) {
    tabState.isContentRestored = restored;
  },
  setPanes(panes: readonly Readonly<EditorPane>[]) {
    tabState.panes = panes as EditorPane[];
  },
  addPane(pane: EditorPane) {
    if (tabState.panes.some(p => p.id === pane.id)) return;
    tabState.panes = [...tabState.panes, pane];
  },
  removePane(paneId: string) {
    // Work with a filtered snapshot to avoid errors from falsy entries in the array
    const currentPanes = tabState.panes.filter(Boolean) as EditorPane[];

    // Collect tabs that will be removed so we can clean up timers and global state
    const removedTabs: Array<{ paneId: string; tab: Tab }> = [];

    const findAndCollect = (panes: readonly EditorPane[]): boolean => {
      for (const p of panes) {
        if (!p) continue;
        if (p.id === paneId) {
          // collect all tabs in this subtree
          const collectTabs = (node: EditorPane) => {
            for (const t of node.tabs ?? []) removedTabs.push({ paneId: node.id, tab: t });
            if (node.children) for (const c of node.children) collectTabs(c);
          };
          collectTabs(p);
          return true;
        }
        if (p.children && findAndCollect(p.children)) return true;
      }
      return false;
    };

    findAndCollect(currentPanes);

    // If any removed tabs reference a path with pending save timers, clear them
    for (const { tab } of removedTabs) {
      const tDef = tabRegistry.get(tab.kind);
      const path = tDef?.getContentPath?.(tab) ?? tab.path;
      if (path && (tab.kind === 'editor' || tab.kind === 'diff' || tab.kind === 'ai')) {
        removeSaveTimerForPath(path);
      }
    }

    if (tabState.globalActiveTab && removedTabs.some(r => r.tab.id === tabState.globalActiveTab)) {
      tabState.globalActiveTab = null;
    }

    const rootFiltered = currentPanes.filter(p => p.id !== paneId);
    if (rootFiltered.length !== currentPanes.length) {
      if (rootFiltered.length > 0) {
        const size = 100 / rootFiltered.length;
        tabState.panes = rootFiltered.map(p => ({ ...p, size }));
      } else {
        tabState.panes = [];
      }
      if (tabState.activePane === paneId) {
        tabState.activePane = null;
        tabState.globalActiveTab = null;
      }
      return;
    }

    const removeRecursive = (pane: EditorPane | null): EditorPane | null => {
      if (!pane) return null;
      if (!pane.children) return pane;

      const ch = pane.children
        .map(c => (c && c.id === paneId ? null : removeRecursive(c as EditorPane)))
        .filter(Boolean) as EditorPane[];

      if (ch.length === 1) return { ...ch[0], size: pane.size };
      if (ch.length > 0) {
        const s = 100 / ch.length;
        return { ...pane, children: ch.map(c => ({ ...c, size: s })) };
      }
      return { ...pane, children: ch };
    };

    const newPanes = currentPanes.map(p => removeRecursive(p)).filter(Boolean) as EditorPane[];

    // Final sanitize pass: remove falsy nodes and ensure parentId for children matches their parent
    const sanitize = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.filter(Boolean).map(p => {
        const children = p.children ? sanitize(p.children) : undefined;
        return {
          ...p,
          children:
            children && children.length ? children.map(c => ({ ...c, parentId: p.id })) : children,
        } as EditorPane;
      });

    tabState.panes = sanitize(newPanes);

    if (tabState.activePane === paneId) {
      tabState.activePane = null;
      tabState.globalActiveTab = null;
    }
  },

  updatePane(paneId: string, updates: Partial<EditorPane>) {
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id === paneId) return { ...p, ...updates };
        if (p.children) return { ...p, children: up(p.children) };
        return p;
      });
    tabState.panes = up(tabState.panes);
  },
  setActivePane(paneId: string | null) {
    tabState.activePane = paneId;
  },
  getPane,
  getTab(paneId: string, tabId: string): Tab | null {
    const pane = getPane(paneId);
    return pane?.tabs.find(t => t.id === tabId) ?? null;
  },
  getAllTabs: () => collectAllTabs(tabState.panes),
  findTabByPath(path: string, kind?: string) {
    return findInPanes(tabState.panes, path, kind);
  },
  updateTabContent,
  updateTab(paneId: string, tabId: string, updates: Partial<Tab>) {
    const pane = getPane(paneId);
    if (!pane) return;
    const i = pane.tabs.findIndex(t => t.id === tabId);
    if (i < 0) return;
    const next = [...pane.tabs];
    next[i] = { ...next[i], ...updates } as Tab;
    tabActions.updatePane(paneId, { tabs: next });
  },
  closeTab(paneId: string, tabId: string) {
    const pane = getPane(paneId);
    if (!pane) return;
    const tab = pane.tabs.find(t => t.id === tabId);
    if (tab) {
      const tDef = tabRegistry.get(tab.kind);
      const path = tDef?.getContentPath?.(tab) ?? tab.path;
      if (path && (tab.kind === 'editor' || tab.kind === 'diff' || tab.kind === 'ai')) {
        removeSaveTimerForPath(path);
      }
    }
    const newTabs = pane.tabs.filter(t => t.id !== tabId);
    let newActive = pane.activeTabId;
    if (pane.activeTabId === tabId) {
      const idx = pane.tabs.findIndex(t => t.id === tabId);
      newActive = newTabs.length ? (idx > 0 ? newTabs[idx - 1].id : newTabs[0].id) : '';
    }
    tabActions.updatePane(paneId, { tabs: newTabs, activeTabId: newActive });
    if (tabState.globalActiveTab === tabId) {
      tabState.globalActiveTab = newActive || null;
      tabState.activePane = newActive ? paneId : null;
    }
  },
  activateTab(paneId: string, tabId: string) {
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id === paneId) return { ...p, activeTabId: tabId };
        if (p.children) return { ...p, children: up(p.children) };
        return p;
      });
    tabState.panes = up(tabState.panes);
    tabState.globalActiveTab = tabId;
    tabState.activePane = paneId;
  },
  moveTab(fromPaneId: string, toPaneId: string, tabId: string) {
    const from = getPane(fromPaneId);
    const to = getPane(toPaneId);
    if (!from || !to) return;
    const t = from.tabs.find(x => x.id === tabId);
    if (!t) return;
    tabActions.closeTab(fromPaneId, tabId);
    tabActions.updatePane(toPaneId, {
      tabs: [...to.tabs, { ...t, paneId: toPaneId }],
      activeTabId: t.id,
    });
    tabState.globalActiveTab = t.id;
    tabState.activePane = toPaneId;
  },
  moveTabToIndex(fromPaneId: string, toPaneId: string, tabId: string, index: number) {
    const from = getPane(fromPaneId);
    const to = getPane(toPaneId);
    if (!from || !to) return;
    const t = from.tabs.find(x => x.id === tabId);
    if (!t) return;
    if (fromPaneId === toPaneId) {
      const i = from.tabs.findIndex(x => x.id === tabId);
      const j = Math.max(0, Math.min(index, from.tabs.length - 1));
      if (i < 0 || i === j) return;
      const arr = [...from.tabs];
      const [r] = arr.splice(i, 1);
      arr.splice(j, 0, r);
      tabActions.updatePane(fromPaneId, { tabs: arr, activeTabId: r.id });
      tabState.globalActiveTab = r.id;
      tabState.activePane = fromPaneId;
      return;
    }
    const newFrom = from.tabs.filter(x => x.id !== tabId);
    tabActions.updatePane(fromPaneId, {
      tabs: newFrom,
      activeTabId: from.activeTabId === tabId ? (newFrom[0]?.id ?? '') : from.activeTabId,
    });
    const j = Math.max(0, Math.min(index, to.tabs.length));
    const newTo = [...to.tabs.slice(0, j), { ...t, paneId: toPaneId }, ...to.tabs.slice(j)];
    tabActions.updatePane(toPaneId, { tabs: newTo, activeTabId: t.id });
    tabState.globalActiveTab = t.id;
    tabState.activePane = toPaneId;
  },
  handleFileDeleted(deletedPath: string) {
    const np = normalizeTabPath(deletedPath);
    const toClose: Array<{ paneId: string; tabId: string }> = [];
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(pane => {
        if (pane.children?.length) return { ...pane, children: up(pane.children) };
        const newTabs = pane.tabs.map((tab: Tab) => {
          const tp = normalizeTabPath(tab.path);
          if ((tab.kind === 'editor' || tab.kind === 'preview') && tp === np) {
            toClose.push({ paneId: pane.id, tabId: tab.id });
            return tab;
          }
          if (tab.kind === 'diff' && tp === np) {
            const dt = tab as DiffTab;
            if (dt.editable)
              return { ...dt, diffs: dt.diffs.map(d => ({ ...d, latterContent: '' })) };
          }
          return tab;
        });
        return { ...pane, tabs: newTabs };
      });
    tabState.panes = up(tabState.panes);
    for (const { paneId, tabId } of toClose) tabActions.closeTab(paneId, tabId);
  },
  handleFilesDeleted(paths: string[]) {
    if (paths.length === 0) return;
    if (paths.length === 1) {
      tabActions.handleFileDeleted(paths[0]);
      return;
    }
    const set = new Set(paths.map(normalizeTabPath));
    const toClose: Array<{ paneId: string; tabId: string }> = [];
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(pane => {
        if (pane.children?.length) return { ...pane, children: up(pane.children) };
        const newTabs = pane.tabs.map((tab: Tab) => {
          const tp = normalizeTabPath(tab.path);
          if (!set.has(tp)) return tab;
          if (tab.kind === 'editor' || tab.kind === 'preview') {
            toClose.push({ paneId: pane.id, tabId: tab.id });
            return tab;
          }
          if (tab.kind === 'diff') {
            const dt = tab as DiffTab;
            if (dt.editable)
              return { ...dt, diffs: dt.diffs.map(d => ({ ...d, latterContent: '' })) };
          }
          return tab;
        });
        return { ...pane, tabs: newTabs };
      });
    tabState.panes = up(tabState.panes);
    for (const { paneId, tabId } of toClose) tabActions.closeTab(paneId, tabId);
  },
  splitPane(paneId: string, direction: 'horizontal' | 'vertical') {
    const target = getPane(paneId);
    if (!target) return;
    const ids: string[] = [];
    const collect = (ps: readonly EditorPane[]) => {
      ps.forEach(p => {
        ids.push(p.id);
        if (p.children) collect(p.children);
      });
    };
    collect(tabState.panes);
    let n = 1;
    while (ids.includes(`pane-${n}`)) n++;
    const newId = `pane-${n}`;
    let n2 = n + 1;
    while (ids.includes(`pane-${n2}`) || `pane-${n2}` === newId) n2++;
    const existingId = `pane-${n2}`;
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id !== paneId) {
          if (p.children) return { ...p, children: up(p.children) };
          return p;
        }
        return {
          ...p,
          layout: direction,
          children: [
            {
              id: existingId,
              tabs: p.tabs.map(t => ({ ...t, id: t.id.replace(p.id, existingId) })),
              activeTabId: p.activeTabId ? p.activeTabId.replace(p.id, existingId) : '',
              parentId: paneId,
              size: 50,
            },
            { id: newId, tabs: [], activeTabId: '', parentId: paneId, size: 50 },
          ],
          tabs: [],
          activeTabId: '',
        };
      });
    tabState.panes = up(tabState.panes);
  },
  splitPaneAndMoveTab(
    paneId: string,
    direction: 'horizontal' | 'vertical',
    tabId: string,
    side: 'before' | 'after'
  ) {
    const target = getPane(paneId);
    if (!target) return;
    let srcPaneId = '';
    let tabToMove: Tab | null = null;
    const find = (ps: readonly EditorPane[]) => {
      for (const p of ps) {
        const t = p.tabs.find(x => x.id === tabId);
        if (t) {
          srcPaneId = p.id;
          tabToMove = t;
          return;
        }
        if (p.children) find(p.children);
      }
    };
    find(tabState.panes);
    if (!tabToMove || !srcPaneId) return;
    const ids: string[] = [];
    const collect = (ps: readonly EditorPane[]) => {
      ps.forEach(p => {
        ids.push(p.id);
        if (p.children) collect(p.children);
      });
    };
    collect(tabState.panes);
    let n = 1;
    while (ids.includes(`pane-${n}`)) n++;
    const newId = `pane-${n}`;
    const existingId = `pane-${n + 1}`;
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id === srcPaneId && srcPaneId !== paneId) {
          const nt = p.tabs.filter(x => x.id !== tabId);
          return {
            ...p,
            tabs: nt,
            activeTabId: p.activeTabId === tabId ? (nt[0]?.id ?? '') : p.activeTabId,
          };
        }
        if (p.id !== paneId) {
          if (p.children) return { ...p, children: up(p.children) };
          return p;
        }
        const existingTabs = p.tabs
          .filter(x => x.id !== tabId)
          .map(t => ({ ...t, paneId: existingId }));
        const moved = { ...tabToMove!, paneId: newId };
        const [p1, p2] =
          side === 'before'
            ? [
                { id: newId, tabs: [moved], activeTabId: moved.id, parentId: paneId, size: 50 },
                {
                  id: existingId,
                  tabs: existingTabs,
                  activeTabId:
                    p.activeTabId === tabId ? (existingTabs[0]?.id ?? '') : p.activeTabId,
                  parentId: paneId,
                  size: 50,
                },
              ]
            : [
                {
                  id: existingId,
                  tabs: existingTabs,
                  activeTabId:
                    p.activeTabId === tabId ? (existingTabs[0]?.id ?? '') : p.activeTabId,
                  parentId: paneId,
                  size: 50,
                },
                { id: newId, tabs: [moved], activeTabId: moved.id, parentId: paneId, size: 50 },
              ];
        return {
          ...p,
          layout: direction,
          children: [p1, p2],
          tabs: [],
          activeTabId: '',
        };
      });
    tabState.panes = up(tabState.panes);
    tabState.activePane = newId;
    tabState.globalActiveTab = tabId;
  },
  splitPaneAndOpenFile(
    paneId: string,
    direction: 'horizontal' | 'vertical',
    file: TabFileInfo,
    side: 'before' | 'after'
  ) {
    const target = getPane(paneId);
    if (!target) return;
    const ids: string[] = [];
    const collect = (ps: readonly EditorPane[]) => {
      ps.forEach(p => {
        ids.push(p.id);
        if (p.children) collect(p.children);
      });
    };
    collect(tabState.panes);
    let n = 1;
    while (ids.includes(`pane-${n}`)) n++;
    const newId = `pane-${n}`;
    const existingId = `pane-${n + 1}`;
    const defEditor =
      typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
    const kind = file.isBufferArray ? 'binary' : 'editor';
    const filePath = file.path || '';
    const name = file.name || filePath.split('/').pop() || 'untitled';
    const newTab: Tab = {
      id: `${filePath || name}-${Date.now()}`,
      name,
      path: filePath,
      kind,
      paneId: newId,
      content: (file.content as string) || '',
      isDirty: false,
      isCodeMirror: defEditor === 'codemirror',
    };
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id !== paneId) {
          if (p.children) return { ...p, children: up(p.children) };
          return p;
        }
        const existingTabs = p.tabs.map(t => ({ ...t, paneId: existingId }));
        const [p1, p2] =
          side === 'before'
            ? [
                { id: newId, tabs: [newTab], activeTabId: newTab.id, parentId: paneId, size: 50 },
                {
                  id: existingId,
                  tabs: existingTabs,
                  activeTabId: p.activeTabId,
                  parentId: paneId,
                  size: 50,
                },
              ]
            : [
                {
                  id: existingId,
                  tabs: existingTabs,
                  activeTabId: p.activeTabId,
                  parentId: paneId,
                  size: 50,
                },
                { id: newId, tabs: [newTab], activeTabId: newTab.id, parentId: paneId, size: 50 },
              ];
        return {
          ...p,
          layout: direction,
          children: [p1, p2],
          tabs: [],
          activeTabId: '',
        };
      });
    tabState.panes = up(tabState.panes);
    tabState.activePane = newId;
    tabState.globalActiveTab = newTab.id;
  },
  resizePane(paneId: string, newSize: number) {
    tabActions.updatePane(paneId, { size: newSize });
  },
  async openTab(file: TabFileInfo, options: OpenTabOptions = {}) {
    const kind =
      options.kind ??
      file.kind ??
      (file?.isBufferArray === true || file?.isBufferArray ? 'binary' : 'editor');
    let targetPaneId = options.paneId ?? tabState.activePane ?? null;
    const allTabs = tabActions.getAllTabs();

    if (allTabs.length === 0) {
      const findLeaf = (ps: readonly EditorPane[]): EditorPane | null => {
        for (const p of ps) {
          if (!p.children?.length) return p;
          const f = findLeaf(p.children);
          if (f) return f;
        }
        return null;
      };
      if (options.paneId) targetPaneId = options.paneId;
      else if (tabState.activePane && getPane(tabState.activePane))
        targetPaneId = tabState.activePane;
      else {
        const leaf = findLeaf(tabState.panes);
        if (leaf) targetPaneId = leaf.id;
        else if (!targetPaneId) {
          let next = 1;
          while (tabState.panes.some(p => p.id === `pane-${next}`)) next++;
          const newPane: EditorPane = { id: `pane-${next}`, tabs: [], activeTabId: '' };
          tabActions.addPane(newPane);
          targetPaneId = newPane.id;
          tabState.activePane = newPane.id;
        }
      }
      if (!targetPaneId) {
        const first = tabState.panes[0]?.id;
        if (first) targetPaneId = first;
        else {
          let next = 1;
          while (tabState.panes.some(p => p.id === `pane-${next}`)) next++;
          const newPane: EditorPane = { id: `pane-${next}`, tabs: [], activeTabId: '' };
          tabActions.addPane(newPane);
          targetPaneId = newPane.id;
          tabState.activePane = newPane.id;
        }
      }
    }

    if (!targetPaneId) return;

    const toLeaf = (id: string): string => {
      const s = getPane(id);
      if (!s) return id;
      const find = (p: EditorPane): EditorPane => {
        if (!p.children?.length) return p;
        return find(p.children[0]);
      };
      return find(s).id;
    };
    targetPaneId = toLeaf(targetPaneId);

    const tabDef = tabRegistry.get(kind);
    if (!tabDef) return;

    const pane = getPane(targetPaneId);
    if (!pane) return;

    if (tabDef.shouldReuseTab) {
      if (options.searchAllPanesForReuse) {
        const leaves = flattenLeafPanes(tabState.panes);
        for (const sp of leaves) {
          for (const t of sp.tabs) {
            if (t.kind === kind && tabDef.shouldReuseTab!(t, file, options)) {
              await loadAndUpdateTabContent(t.id, kind, file.path);
              if (options.makeActive !== false) tabActions.activateTab(sp.id, t.id);
              return;
            }
          }
        }
      } else {
        for (const t of pane.tabs) {
          if (t.kind === kind && tabDef.shouldReuseTab!(t, file, options)) {
            await loadAndUpdateTabContent(t.id, kind, file.path);
            if (options.makeActive !== false) tabActions.activateTab(targetPaneId, t.id);
            return;
          }
        }
      }
    } else {
      const tabId =
        kind !== 'editor' ? `${kind}:${file.path || file.name}` : file.path || file.name;
      const existing = pane.tabs.find(
        t => t.kind === kind && (t.path === file.path || t.id === tabId)
      );
      if (existing) {
        await loadAndUpdateTabContent(existing.id, kind, file.path);
        if (options.makeActive !== false) tabActions.activateTab(targetPaneId, existing.id);
        if (options.jumpToLine !== undefined || options.jumpToColumn !== undefined) {
          tabActions.updateTab(targetPaneId, existing.id, {
            jumpToLine: options.jumpToLine,
            jumpToColumn: options.jumpToColumn,
          } as Partial<Tab>);
        }
        return;
      }
    }

    let fileToCreate = file;
    if ((kind === 'editor' || kind === 'binary') && file.path) {
      try {
        const projectId = getCurrentProjectId();
        if (projectId) {
          const fresh = await fileRepository.getFileByPath(projectId, file.path);
          if (fresh) {
            fileToCreate = {
              ...file,
              content: fresh.content,
              isBufferArray: fresh.isBufferArray ?? file.isBufferArray,
              bufferContent: fresh.bufferContent ?? file.bufferContent,
            };
          }
        }
      } catch (e) {
        console.warn('[tabState] Failed to load fresh content for new tab:', e);
      }
    }

    const newTab = tabDef.createTab(fileToCreate, { ...options, paneId: targetPaneId });
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id !== targetPaneId) {
          if (p.children) return { ...p, children: up(p.children) };
          return p;
        }
        return {
          ...p,
          tabs: [...p.tabs, newTab],
          activeTabId: options.makeActive !== false ? newTab.id : p.activeTabId,
        };
      });
    tabState.panes = up(tabState.panes);
    if (options.makeActive !== false) {
      tabState.globalActiveTab = newTab.id;
      tabState.activePane = targetPaneId;
    }
  },
  async saveSession() {
    const { sessionStore, DEFAULT_SESSION } = await import('@/stores/sessionStore');
    await sessionStore.save({
      version: 1,
      lastSaved: Date.now(),
      tabs: {
        panes: tabState.panes,
        activePane: tabState.activePane,
        globalActiveTab: tabState.globalActiveTab,
      },
      ui: DEFAULT_SESSION.ui,
    });
  },
  async loadSession() {
    try {
      const { sessionStore } = await import('@/stores/sessionStore');
      const session = await sessionStore.load();
      tabState.panes = session.tabs.panes;
      tabState.activePane = session.tabs.activePane || null;
      const hasAny = session.tabs.panes.some((p: EditorPane) => {
        const check = (x: EditorPane) =>
          (x.tabs?.length ?? 0) > 0 || (x.children?.some(check) ?? false);
        return check(p);
      });
      if (!hasAny) tabState.isContentRestored = true;
    } catch (e) {
      console.error('[tabState] loadSession failed:', e);
      tabState.isContentRestored = true;
    } finally {
      tabState.isLoading = false;
      tabState.isRestored = true;
    }
  },
};
