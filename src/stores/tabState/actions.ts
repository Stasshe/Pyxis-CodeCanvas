import { fsClient, isPathWithin, normalizePath } from '@/engine/core/fs';
import { recordRecentFilePath } from '@/engine/storage/recentFileHistoryAdapter';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { DiffTab, EditorPane, OpenTabOptions, Tab, TabFileInfo } from '@/engine/tabs/types';
import { getCurrentRootPath } from '@/stores/projectStore';
import {
  clearTabContent,
  getBufferContent,
  getTabContent,
  setBufferContent,
  setTabContent,
} from '@/stores/tabContentStore';
import {
  getContentFromPanes,
  loadAndUpdateTabContent,
  removeSaveTimerForPath,
  renameContentPaths,
  updateTabContent,
} from './contentSync';
import { prepareFileForTab } from './fileLoading';
import {
  collectAllTabs,
  createUniquePaneId as createUniquePaneIdForPanes,
  findFirstLeafPane,
  findInPanes,
  findPaneRecursive,
  flattenLeafPanes,
  resolveOpenTargetPaneId as resolveOpenTargetPaneIdForPanes,
  toLeafPaneId as toLeafPaneIdForPanes,
  validActiveTabId,
  withTabsInPane,
} from './paneUtils';
import { loadTabSession, saveTabSession } from './sessionActions';
import { tabState } from './state';

function createUniquePaneId(reserved = new Set<string>()): string {
  return createUniquePaneIdForPanes(tabState.panes, reserved);
}

function toLeafPaneId(paneId: string | null | undefined): string | null {
  return toLeafPaneIdForPanes(tabState.panes, paneId);
}

function resolveOpenTargetPaneId(preferredPaneId?: string | null): string | null {
  return resolveOpenTargetPaneIdForPanes(tabState.panes, tabState.activePane, preferredPaneId);
}

async function rememberOpenedFile(filePath: string | undefined, kind: string): Promise<void> {
  const rootPath = getCurrentRootPath();
  if (!rootPath || !filePath || (kind !== 'editor' && kind !== 'binary' && kind !== 'preview')) {
    return;
  }
  try {
    if (!isPathWithin(filePath, rootPath)) return;
  } catch {
    return;
  }
  try {
    await recordRecentFilePath(rootPath, filePath);
  } catch (error) {
    console.warn('[tabState] Failed to save recent file history', error);
  }
}
// ---------------------------------------------------------------------------
// tabActions（旧 useTabStore のアクション）
// ---------------------------------------------------------------------------
function focusFirstAvailableLeaf(): void {
  const leaf = findFirstLeafPane(tabState.panes);
  tabState.activePane = leaf?.id ?? null;
  tabState.globalActiveTab = leaf?.activeTabId || null;
}

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
        focusFirstAvailableLeaf();
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
          children: children?.length ? children.map(c => ({ ...c, parentId: p.id })) : children,
        } as EditorPane;
      });

    tabState.panes = sanitize(newPanes);

    if (tabState.activePane === paneId) {
      focusFirstAvailableLeaf();
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
      // tabContentStoreからコンテンツをクリーンアップ
      clearTabContent(tabId);
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
    const pane = getPane(paneId);
    const activatedTab = pane?.tabs.find(tab => tab.id === tabId);
    if (
      activatedTab?.path &&
      (activatedTab.kind === 'editor' ||
        activatedTab.kind === 'binary' ||
        activatedTab.kind === 'preview')
    ) {
      void rememberOpenedFile(activatedTab.path, activatedTab.kind);
    }
    if (
      pane?.activeTabId === tabId &&
      tabState.globalActiveTab === tabId &&
      tabState.activePane === paneId
    )
      return;
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
    // Remove from source WITHOUT calling closeTab (which would clearTabContent).
    // Moving a tab must preserve its content in tabContentStore.
    const newFromTabs = from.tabs.filter(x => x.id !== tabId);
    tabActions.updatePane(fromPaneId, {
      tabs: newFromTabs,
      activeTabId: from.activeTabId === tabId ? (newFromTabs[0]?.id ?? '') : from.activeTabId,
    });
    if (tabState.globalActiveTab === tabId) {
      tabState.globalActiveTab = newFromTabs[0]?.id ?? null;
      tabState.activePane = newFromTabs.length ? fromPaneId : null;
    }
    // Capture destination tabs before the source update potentially invalidates 'to'
    const toTabs = [...to.tabs];
    tabActions.updatePane(toPaneId, {
      tabs: [...toTabs, { ...t, paneId: toPaneId }],
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
    const np = normalizePath(deletedPath);
    const toClose: Array<{ paneId: string; tabId: string }> = [];
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(pane => {
        if (pane.children?.length) return { ...pane, children: up(pane.children) };
        const newTabs = pane.tabs.map((tab: Tab) => {
          const contentPath = tabRegistry.get(tab.kind)?.getContentPath?.(tab) ?? tab.path;
          const tp = normalizePath(contentPath || '/');
          if (isPathWithin(tp, np)) {
            toClose.push({ paneId: pane.id, tabId: tab.id });
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
    const normalizedPaths = paths.map(normalizePath);
    const toClose: Array<{ paneId: string; tabId: string }> = [];
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(pane => {
        if (pane.children?.length) return { ...pane, children: up(pane.children) };
        const newTabs = pane.tabs.map((tab: Tab) => {
          const contentPath = tabRegistry.get(tab.kind)?.getContentPath?.(tab) ?? tab.path;
          const tp = normalizePath(contentPath || '/');
          if (normalizedPaths.some(path => isPathWithin(tp, path))) {
            toClose.push({ paneId: pane.id, tabId: tab.id });
          }
          return tab;
        });
        return { ...pane, tabs: newTabs };
      });
    tabState.panes = up(tabState.panes);
    for (const { paneId, tabId } of toClose) tabActions.closeTab(paneId, tabId);
  },
  handleFilesRenamed(oldPath: string, newPath: string) {
    const oldRoot = normalizePath(oldPath);
    const newRoot = normalizePath(newPath);
    renameContentPaths(oldRoot, newRoot);
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(pane => {
        if (pane.children?.length) return { ...pane, children: up(pane.children) };
        return {
          ...pane,
          tabs: pane.tabs.map(tab => {
            const contentPath = tabRegistry.get(tab.kind)?.getContentPath?.(tab) ?? tab.path;
            const path = normalizePath(contentPath || '/');
            if (!isPathWithin(path, oldRoot)) return tab;
            const nextPath = `${newRoot}${path.slice(oldRoot.length)}`;
            const updated = { ...tab, path: normalizePath(nextPath) };
            if (updated.kind === 'ai') {
              const filePath = normalizePath(updated.filePath || path);
              if (isPathWithin(filePath, oldRoot)) {
                updated.filePath = normalizePath(`${newRoot}${filePath.slice(oldRoot.length)}`);
              }
            }
            return updated;
          }),
        };
      });
    tabState.panes = up(tabState.panes);
  },
  splitPane(paneId: string, direction: 'horizontal' | 'vertical') {
    const targetPaneId = toLeafPaneId(paneId);
    if (!targetPaneId) return;
    const target = getPane(targetPaneId);
    if (!target) return;
    const reserved = new Set([targetPaneId]);
    const existingId = createUniquePaneId(reserved);
    reserved.add(existingId);
    const newId = createUniquePaneId(reserved);
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id !== targetPaneId) {
          if (p.children) return { ...p, children: up(p.children) };
          return p;
        }
        const existingTabs = withTabsInPane(p.tabs, existingId);
        const existingActiveTabId = validActiveTabId(existingTabs, p.activeTabId);
        return {
          ...p,
          layout: direction,
          children: [
            {
              id: existingId,
              tabs: existingTabs,
              activeTabId: existingActiveTabId,
              parentId: targetPaneId,
              size: 50,
            },
            { id: newId, tabs: [], activeTabId: '', parentId: targetPaneId, size: 50 },
          ],
          tabs: [],
          activeTabId: '',
        };
      });
    tabState.panes = up(tabState.panes);
    tabState.activePane = existingId;
    tabState.globalActiveTab = target.activeTabId || null;
  },
  splitPaneAndMoveTab(
    paneId: string,
    direction: 'horizontal' | 'vertical',
    tabId: string,
    side: 'before' | 'after'
  ) {
    const targetPaneId = toLeafPaneId(paneId);
    if (!targetPaneId) return;
    const target = getPane(targetPaneId);
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
    const tabToMoveValue = tabToMove;
    if (!tabToMoveValue || !srcPaneId) return;
    const reserved = new Set([targetPaneId]);
    const newId = createUniquePaneId(reserved);
    reserved.add(newId);
    const existingId = createUniquePaneId(reserved);
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id === srcPaneId && srcPaneId !== targetPaneId) {
          const nt = p.tabs.filter(x => x.id !== tabId);
          return {
            ...p,
            tabs: nt,
            activeTabId: p.activeTabId === tabId ? (nt[0]?.id ?? '') : p.activeTabId,
          };
        }
        if (p.id !== targetPaneId) {
          if (p.children) return { ...p, children: up(p.children) };
          return p;
        }
        const existingTabs = p.tabs
          .filter(x => x.id !== tabId)
          .map(t => ({ ...t, paneId: existingId }));
        const moved: Tab = { ...(tabToMoveValue as Tab), paneId: newId };
        const [p1, p2] =
          side === 'before'
            ? [
                {
                  id: newId,
                  tabs: [moved],
                  activeTabId: moved.id,
                  parentId: targetPaneId,
                  size: 50,
                },
                {
                  id: existingId,
                  tabs: existingTabs,
                  activeTabId: validActiveTabId(
                    existingTabs,
                    p.activeTabId === tabId ? '' : p.activeTabId
                  ),
                  parentId: targetPaneId,
                  size: 50,
                },
              ]
            : [
                {
                  id: existingId,
                  tabs: existingTabs,
                  activeTabId: validActiveTabId(
                    existingTabs,
                    p.activeTabId === tabId ? '' : p.activeTabId
                  ),
                  parentId: targetPaneId,
                  size: 50,
                },
                {
                  id: newId,
                  tabs: [moved],
                  activeTabId: moved.id,
                  parentId: targetPaneId,
                  size: 50,
                },
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
  async splitPaneAndOpenFile(
    paneId: string,
    direction: 'horizontal' | 'vertical',
    file: TabFileInfo,
    side: 'before' | 'after'
  ) {
    const targetPaneId = toLeafPaneId(paneId);
    if (!targetPaneId) return;
    const target = getPane(targetPaneId);
    if (!target) return;
    const reserved = new Set([targetPaneId]);
    const newId = createUniquePaneId(reserved);
    reserved.add(newId);
    const existingId = createUniquePaneId(reserved);
    const defEditor =
      typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
    const filePath = file.path || '';
    const name = file.name || filePath.split('/').pop() || 'untitled';
    const existingTabForPath = collectAllTabs(tabState.panes).find(
      t => t.path === filePath && (t.kind === 'editor' || t.kind === 'binary')
    );
    let kind: 'editor' | 'binary' = 'editor';
    if (file.isBufferArray || file.bufferContent) kind = 'binary';
    else if (existingTabForPath?.kind === 'binary') kind = 'binary';
    let fileToOpen: TabFileInfo = file;
    if (existingTabForPath) {
      if (kind === 'binary') {
        let bufferContent = getBufferContent(existingTabForPath.id);
        if (bufferContent === undefined && 'bufferContent' in existingTabForPath) {
          bufferContent = existingTabForPath.bufferContent;
        }
        if (bufferContent) fileToOpen = { ...file, isBufferArray: true, bufferContent };
      } else {
        let content = getTabContent(existingTabForPath.id);
        if (
          content === undefined &&
          'content' in existingTabForPath &&
          typeof existingTabForPath.content === 'string'
        ) {
          content = existingTabForPath.content;
        }
        fileToOpen = { ...file, content };
      }
    }
    const prepared = await prepareFileForTab(fileToOpen, kind);
    kind = prepared.kind === 'binary' ? 'binary' : 'editor';
    fileToOpen = prepared.file;
    const content = fileToOpen.content ?? '';
    const bufferContent = fileToOpen.bufferContent;

    // Use a unique tabId so each pane instance has its own entry in tabContentStore.
    const newTabId = `${filePath || name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setTabContent(newTabId, content, false);
    if (bufferContent) setBufferContent(newTabId, bufferContent);

    const newTab: Tab = {
      id: newTabId,
      name,
      path: filePath,
      kind,
      paneId: newId,
      content,
      isDirty: false,
      isCodeMirror: defEditor === 'codemirror',
      ...(kind === 'binary'
        ? { isBufferArray: true, bufferContent, mimeType: fileToOpen.mimeType }
        : {}),
    };
    const up = (panes: readonly EditorPane[]): EditorPane[] =>
      panes.map(p => {
        if (p.id !== targetPaneId) {
          if (p.children) return { ...p, children: up(p.children) };
          return p;
        }
        const existingTabs = withTabsInPane(p.tabs, existingId);
        const [p1, p2] =
          side === 'before'
            ? [
                {
                  id: newId,
                  tabs: [newTab],
                  activeTabId: newTab.id,
                  parentId: targetPaneId,
                  size: 50,
                },
                {
                  id: existingId,
                  tabs: existingTabs,
                  activeTabId: validActiveTabId(existingTabs, p.activeTabId),
                  parentId: targetPaneId,
                  size: 50,
                },
              ]
            : [
                {
                  id: existingId,
                  tabs: existingTabs,
                  activeTabId: validActiveTabId(existingTabs, p.activeTabId),
                  parentId: targetPaneId,
                  size: 50,
                },
                {
                  id: newId,
                  tabs: [newTab],
                  activeTabId: newTab.id,
                  parentId: targetPaneId,
                  size: 50,
                },
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
    await rememberOpenedFile(filePath, kind);
  },
  resizePane(paneId: string, newSize: number) {
    tabActions.updatePane(paneId, { size: newSize });
  },
  async openTab(file: TabFileInfo, options: OpenTabOptions = {}) {
    const requestedKind =
      options.kind ??
      file.kind ??
      (file?.isBufferArray === true || file?.isBufferArray ? 'binary' : 'editor');
    let kind = requestedKind;
    let fileToCreate = file;
    try {
      const prepared = await prepareFileForTab(file, requestedKind);
      kind = prepared.kind;
      fileToCreate = prepared.file;
    } catch (error) {
      console.error('[tabState] Failed to load fresh content for new tab:', error);
      throw error;
    }
    let targetPaneId = resolveOpenTargetPaneId(options.paneId);

    if (!targetPaneId) {
      const newPane: EditorPane = { id: createUniquePaneId(), tabs: [], activeTabId: '' };
      tabActions.addPane(newPane);
      targetPaneId = newPane.id;
      tabState.activePane = newPane.id;
    }

    const tabDef = tabRegistry.get(kind);
    if (!tabDef) return;

    const pane = getPane(targetPaneId);
    if (!pane) return;

    if (tabDef.shouldReuseTab) {
      if (options.searchAllPanesForReuse) {
        const leaves = flattenLeafPanes(tabState.panes);
        for (const sp of leaves) {
          for (const t of sp.tabs) {
            if (t.kind === kind && tabDef.shouldReuseTab?.(t, file, options)) {
              await loadAndUpdateTabContent(t.id, kind, file.path);
              if (options.jumpToLine !== undefined || options.jumpToColumn !== undefined) {
                tabActions.updateTab(sp.id, t.id, {
                  jumpToLine: options.jumpToLine,
                  jumpToColumn: options.jumpToColumn,
                } as Partial<Tab>);
              }
              if (options.makeActive !== false) {
                tabActions.activateTab(sp.id, t.id);
                await rememberOpenedFile(file.path, kind);
              }
              return;
            }
          }
        }
      } else {
        for (const t of pane.tabs) {
          if (t.kind === kind && tabDef.shouldReuseTab?.(t, file, options)) {
            await loadAndUpdateTabContent(t.id, kind, file.path);
            if (options.jumpToLine !== undefined || options.jumpToColumn !== undefined) {
              tabActions.updateTab(targetPaneId, t.id, {
                jumpToLine: options.jumpToLine,
                jumpToColumn: options.jumpToColumn,
              } as Partial<Tab>);
            }
            if (options.makeActive !== false) {
              tabActions.activateTab(targetPaneId, t.id);
              await rememberOpenedFile(file.path, kind);
            }
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
        if (options.makeActive !== false) {
          tabActions.activateTab(targetPaneId, existing.id);
          await rememberOpenedFile(file.path, kind);
        }
        if (options.jumpToLine !== undefined || options.jumpToColumn !== undefined) {
          tabActions.updateTab(targetPaneId, existing.id, {
            jumpToLine: options.jumpToLine,
            jumpToColumn: options.jumpToColumn,
          } as Partial<Tab>);
        }
        return;
      }
    }

    const newTab = tabDef.createTab(fileToCreate, { ...options, paneId: targetPaneId });
    if (newTab.kind === 'binary' && newTab.bufferContent) {
      setBufferContent(newTab.id, newTab.bufferContent);
    }
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
      await rememberOpenedFile(file.path, kind);
    }
  },
  async saveSession(rootPath?: string | null) {
    await saveTabSession(rootPath);
  },
  async loadSession(rootPath?: string | null) {
    await loadTabSession(rootPath);
  },
};
