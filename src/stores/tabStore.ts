// src/stores/tabStore.ts
import { create } from 'zustand';
import { EditorPane, Tab, OpenTabOptions } from '@/engine/tabs/types';
import { tabRegistry } from '@/engine/tabs/TabRegistry';

interface TabStore {
  // ペイン管理
  panes: EditorPane[];
  activePane: string | null; // グローバルにアクティブなペイン
  globalActiveTab: string | null; // グローバルにアクティブなタブ（1つだけ）

  // ペイン操作
  setPanes: (panes: EditorPane[]) => void;
  addPane: (pane: EditorPane) => void;
  removePane: (paneId: string) => void;
  updatePane: (paneId: string, updates: Partial<EditorPane>) => void;
  setActivePane: (paneId: string | null) => void;
  splitPane: (paneId: string, direction: 'horizontal' | 'vertical') => void;
  resizePane: (paneId: string, newSize: number) => void;

  // タブ操作
  openTab: (file: any, options?: OpenTabOptions) => void;
  closeTab: (paneId: string, tabId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  updateTab: (paneId: string, tabId: string, updates: Partial<Tab>) => void;
  moveTab: (fromPaneId: string, toPaneId: string, tabId: string) => void;

  // ユーティリティ
  getPane: (paneId: string) => EditorPane | null;
  getTab: (paneId: string, tabId: string) => Tab | null;
  getAllTabs: () => Tab[];
  findTabByPath: (path: string, kind?: string) => { paneId: string; tab: Tab } | null;
}

export const useTabStore = create<TabStore>((set, get) => ({
  panes: [],
  activePane: null,
  globalActiveTab: null,

  setPanes: panes => set({ panes }),

  addPane: pane => {
    const state = get();
    // 重複チェック: 同じIDのペインが既に存在する場合は追加しない
    const exists = state.panes.some(p => p.id === pane.id);
    if (exists) {
      console.warn('[TabStore] Pane with id', pane.id, 'already exists, skipping addPane');
      return;
    }
    set({ panes: [...state.panes, pane] });
  },

  removePane: paneId =>
    set(state => {
      // ルートレベルから削除する場合
      const rootFiltered = state.panes.filter(p => p.id !== paneId);
      if (rootFiltered.length !== state.panes.length) {
        // ルートレベルで削除された場合、残りペインのサイズを調整
        if (rootFiltered.length > 0) {
          const newSize = 100 / rootFiltered.length;
          const adjusted = rootFiltered.map(pane => ({ ...pane, size: newSize }));
          return {
            panes: adjusted,
            activePane: state.activePane === paneId ? null : state.activePane,
            globalActiveTab: state.activePane === paneId ? null : state.globalActiveTab,
          };
        }
        return {
          panes: [],
          activePane: null,
          globalActiveTab: null,
        };
      }

      // 子ペインから削除する場合（再帰的）
      const removePaneRecursive = (pane: EditorPane): EditorPane => {
        if (!pane.children) return pane;

        // 再帰的に子ペインを探索し、targetIdを削除
        const updatedChildren = pane.children
          .map(child => (child.id === paneId ? null : removePaneRecursive(child)))
          .filter(Boolean) as EditorPane[];

        // 子ペインが1つだけ残った場合、その子を現在のペインに昇格
        if (updatedChildren.length === 1) {
          const remainingChild = updatedChildren[0];
          // 親ペインのsizeを維持
          return {
            ...remainingChild,
            size: pane.size,
          };
        }

        // サイズを再調整
        if (updatedChildren.length > 0) {
          const newSize = 100 / updatedChildren.length;
          return {
            ...pane,
            children: updatedChildren.map(child => ({ ...child, size: newSize })),
          };
        }

        return { ...pane, children: updatedChildren };
      };

      const newPanes = state.panes.map(pane => removePaneRecursive(pane));

      return {
        panes: newPanes,
        activePane: state.activePane === paneId ? null : state.activePane,
        globalActiveTab: state.activePane === paneId ? null : state.globalActiveTab,
      };
    }),

  updatePane: (paneId, updates) =>
    set(state => {
      const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
        return panes.map(p => {
          if (p.id === paneId) {
            return { ...p, ...updates };
          }
          if (p.children) {
            return { ...p, children: updatePaneRecursive(p.children) };
          }
          return p;
        });
      };

      return { panes: updatePaneRecursive(state.panes) };
    }),

  setActivePane: paneId => set({ activePane: paneId }),

  openTab: (file, options = {}) => {
    const state = get();
    const kind = options.kind || 'editor';
    const targetPaneId = options.paneId || state.activePane || state.panes[0]?.id;

    if (!targetPaneId) {
      console.error('[TabStore] No pane available to open tab');
      return;
    }

    const tabDef = tabRegistry.get(kind);
    if (!tabDef) {
      console.error(`[TabStore] No tab type registered for kind: ${kind}`);
      return;
    }

    // タブIDの生成
    const tabId = kind !== 'editor' ? `${kind}:${file.path || file.name}` : file.path || file.name;

    // 既存タブの検索
    const pane = state.getPane(targetPaneId);
    if (!pane) {
      console.error(`[TabStore] Pane not found: ${targetPaneId}`);
      return;
    }

    const existingTab = pane.tabs.find(t => {
      // 同じkindとpathのタブを検索
      return t.kind === kind && (t.path === file.path || t.id === tabId);
    });

    if (existingTab) {
      // 既存タブをアクティブ化
      if (options.makeActive !== false) {
        get().activateTab(targetPaneId, existingTab.id);
      }

      // jumpToLine/jumpToColumnがある場合は更新
      if (options.jumpToLine !== undefined || options.jumpToColumn !== undefined) {
        get().updateTab(targetPaneId, existingTab.id, {
          jumpToLine: options.jumpToLine,
          jumpToColumn: options.jumpToColumn,
        } as Partial<Tab>);
      }

      return;
    }

    // 新規タブの作成
    const newTab = tabDef.createTab(file, { ...options, paneId: targetPaneId });

    // ペインにタブを追加
    get().updatePane(targetPaneId, {
      tabs: [...pane.tabs, newTab],
      activeTabId: options.makeActive !== false ? newTab.id : pane.activeTabId,
    });

    // グローバルアクティブタブを更新
    if (options.makeActive !== false) {
      set({
        globalActiveTab: newTab.id,
        activePane: targetPaneId,
      });
    }
  },

  closeTab: (paneId, tabId) => {
    const state = get();
    const pane = state.getPane(paneId);
    if (!pane) return;

    const newTabs = pane.tabs.filter(t => t.id !== tabId);
    let newActiveTabId = pane.activeTabId;

    // 閉じたタブがアクティブだった場合、次のタブをアクティブに
    if (pane.activeTabId === tabId) {
      const closedIndex = pane.tabs.findIndex(t => t.id === tabId);
      if (newTabs.length > 0) {
        if (closedIndex > 0) {
          newActiveTabId = newTabs[closedIndex - 1].id;
        } else {
          newActiveTabId = newTabs[0].id;
        }
      } else {
        newActiveTabId = '';
      }
    }

    get().updatePane(paneId, {
      tabs: newTabs,
      activeTabId: newActiveTabId,
    });

    // グローバルアクティブタブの更新
    if (state.globalActiveTab === tabId) {
      set({
        globalActiveTab: newActiveTabId || null,
        activePane: newActiveTabId ? paneId : null,
      });
    }
  },

  activateTab: (paneId, tabId) => {
    const state = get();
    get().updatePane(paneId, { activeTabId: tabId });
    set({
      globalActiveTab: tabId,
      activePane: paneId,
    });
  },

  updateTab: (paneId: string, tabId: string, updates: Partial<Tab>) => {
    const state = get();
    const pane = state.getPane(paneId);
    if (!pane) return;

    const newTabs = pane.tabs.map(t => (t.id === tabId ? ({ ...t, ...updates } as Tab) : t));

    get().updatePane(paneId, { tabs: newTabs });
  },

  moveTab: (fromPaneId, toPaneId, tabId) => {
    const state = get();
    const fromPane = state.getPane(fromPaneId);
    const toPane = state.getPane(toPaneId);

    if (!fromPane || !toPane) return;

    const tab = fromPane.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // 移動元から削除
    get().closeTab(fromPaneId, tabId);

    // 移動先に追加（paneIdを更新）
    const updatedTab = { ...tab, paneId: toPaneId };
    get().updatePane(toPaneId, {
      tabs: [...toPane.tabs, updatedTab],
      activeTabId: updatedTab.id,
    });

    // グローバルアクティブタブを更新
    set({
      globalActiveTab: updatedTab.id,
      activePane: toPaneId,
    });
  },

  // ユーティリティメソッド
  getPane: paneId => {
    const findPane = (panes: EditorPane[]): EditorPane | null => {
      for (const pane of panes) {
        if (pane.id === paneId) return pane;
        if (pane.children) {
          const found = findPane(pane.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findPane(get().panes);
  },

  getTab: (paneId, tabId) => {
    const pane = get().getPane(paneId);
    if (!pane) return null;
    return pane.tabs.find(t => t.id === tabId) || null;
  },

  getAllTabs: () => {
    const collectTabs = (panes: EditorPane[]): Tab[] => {
      const tabs: Tab[] = [];
      for (const pane of panes) {
        tabs.push(...pane.tabs);
        if (pane.children) {
          tabs.push(...collectTabs(pane.children));
        }
      }
      return tabs;
    };
    return collectTabs(get().panes);
  },

  findTabByPath: (path, kind) => {
    const state = get();
    const findInPanes = (panes: EditorPane[]): { paneId: string; tab: Tab } | null => {
      for (const pane of panes) {
        const tab = pane.tabs.find(t => t.path === path && (kind === undefined || t.kind === kind));
        if (tab) return { paneId: pane.id, tab };

        if (pane.children) {
          const found = findInPanes(pane.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findInPanes(state.panes);
  },

  splitPane: (paneId, direction) => {
    const state = get();
    const targetPane = state.getPane(paneId);
    if (!targetPane) return;

    // 既存のペインIDを収集
    const getAllPaneIds = (panes: EditorPane[]): string[] => {
      const ids: string[] = [];
      const traverse = (panes: EditorPane[]) => {
        panes.forEach(pane => {
          ids.push(pane.id);
          if (pane.children) traverse(pane.children);
        });
      };
      traverse(panes);
      return ids;
    };

    const existingIds = getAllPaneIds(state.panes);
    let nextNum = 1;
    while (existingIds.includes(`pane-${nextNum}`)) {
      nextNum++;
    }
    const newPaneId = `pane-${nextNum}`;
    const existingPaneId = `pane-${nextNum + 1}`;

    // 再帰的にペインを更新
    const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => {
        if (pane.id === paneId) {
          // このペインを分割
          return {
            ...pane,
            layout: direction,
            children: [
              {
                id: existingPaneId,
                tabs: pane.tabs.map(tab => ({
                  ...tab,
                  id: tab.id.replace(pane.id, existingPaneId),
                })),
                activeTabId: pane.activeTabId
                  ? pane.activeTabId.replace(pane.id, existingPaneId)
                  : '',
                parentId: paneId,
                size: 50,
              },
              {
                id: newPaneId,
                tabs: [],
                activeTabId: '',
                parentId: paneId,
                size: 50,
              },
            ],
            tabs: [], // 親ペインはタブを持たない
            activeTabId: '',
          };
        }
        if (pane.children) {
          return { ...pane, children: updatePaneRecursive(pane.children) };
        }
        return pane;
      });
    };

    set({ panes: updatePaneRecursive(state.panes) });
  },

  resizePane: (paneId, newSize) => {
    get().updatePane(paneId, { size: newSize });
  },
}));
