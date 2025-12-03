// src/stores/tabStore.ts
import { create } from 'zustand';

import { tabRegistry } from '@/engine/tabs/TabRegistry';
import { EditorPane, Tab, OpenTabOptions } from '@/engine/tabs/types';

interface TabStore {
  // ペイン管理
  panes: EditorPane[];
  activePane: string | null; // グローバルにアクティブなペイン
  globalActiveTab: string | null; // グローバルにアクティブなタブ（1つだけ）

  // セッション管理
  isLoading: boolean;
  isRestored: boolean;
  isContentRestored: boolean;
  setIsLoading: (loading: boolean) => void;
  setIsContentRestored: (restored: boolean) => void;

  // ペイン操作
  setPanes: (panes: EditorPane[]) => void;
  addPane: (pane: EditorPane) => void;
  removePane: (paneId: string) => void;
  updatePane: (paneId: string, updates: Partial<EditorPane>) => void;
  setActivePane: (paneId: string | null) => void;
  splitPane: (paneId: string, direction: 'horizontal' | 'vertical') => void;
  splitPaneAndMoveTab: (
    paneId: string,
    direction: 'horizontal' | 'vertical',
    tabId: string,
    side: 'before' | 'after'
  ) => void;
  resizePane: (paneId: string, newSize: number) => void;

  // タブ操作
  openTab: (file: any, options?: OpenTabOptions) => void;
  closeTab: (paneId: string, tabId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  updateTab: (paneId: string, tabId: string, updates: Partial<Tab>) => void;
  updateTabContent: (tabId: string, content: string, immediate?: boolean) => void;
  updateDiffTabContent: (path: string, content: string, immediate?: boolean) => void;
  moveTab: (fromPaneId: string, toPaneId: string, tabId: string) => void;
  moveTabToIndex: (fromPaneId: string, toPaneId: string, tabId: string, index: number) => void;

  // ユーティリティ
  getPane: (paneId: string) => EditorPane | null;
  getTab: (paneId: string, tabId: string) => Tab | null;
  getAllTabs: () => Tab[];
  findTabByPath: (path: string, kind?: string) => { paneId: string; tab: Tab } | null;

  // セッション管理
  saveSession: () => Promise<void>;
  loadSession: () => Promise<void>;
}

export const useTabStore = create<TabStore>((set, get) => ({
  panes: [],
  activePane: null,
  globalActiveTab: null,
  isLoading: true,
  isRestored: false,
  isContentRestored: false,

  setIsLoading: (loading: boolean) => set({ isLoading: loading, isRestored: !loading }),
  setIsContentRestored: (restored: boolean) => set({ isContentRestored: restored }),

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
    // 優先順位: options.kind -> file.kind -> (buffer arrayなら'binary') -> 'editor'
    const kind =
      options.kind ||
      file.kind ||
      (file && (file.isBufferArray === true || file.isBufferArray) ? 'binary' : 'editor');
    // 初期は options または global active pane を優先し、まだない場合は null にして
    // 後続のロジックで "leaf pane" の探索や新規作成を正しく行えるようにする
    let targetPaneId = options.paneId || state.activePane || null;
    // もし全体でタブが一つもない場合は、優先順に
    // 1) options.paneId
    // 2) 現在の state.activePane（存在かつ有効なペイン）
    // 3) 子を持たない leaf ペイン
    // 4) 新規ペイン作成
    const allTabs = get().getAllTabs();
    if (allTabs.length === 0) {
      if (options.paneId) {
        targetPaneId = options.paneId;
      } else if (state.activePane && get().getPane(state.activePane)) {
        targetPaneId = state.activePane;
      } else {
        // leaf ペインを探索（深さ優先）
        const findLeafPane = (panes: EditorPane[]): EditorPane | null => {
          for (const p of panes) {
            if (!p.children || p.children.length === 0) return p;
            const found = findLeafPane(p.children);
            if (found) return found;
          }
          return null;
        };

        const leaf = findLeafPane(get().panes);
        if (leaf) {
          targetPaneId = leaf.id;
        } else if (!targetPaneId) {
          // ペインが一つも存在しない場合は新規ペインを作る
          const existingIds = get().panes.map(p => p.id);
          let nextNum = 1;
          while (existingIds.includes(`pane-${nextNum}`)) nextNum++;
          const newPaneId = `pane-${nextNum}`;
          const newPane: EditorPane = { id: newPaneId, tabs: [], activeTabId: '' };
          get().addPane(newPane);
          targetPaneId = newPaneId;
          set({ activePane: newPaneId });
        }
      }

      // ここまでで targetPaneId が未決定であれば、まず既存の最初のペインを試す。
      // それも無ければ新規ペインを作成して targetPaneId を決定する。
      if (!targetPaneId) {
        const firstPaneId = state.panes[0]?.id;
        if (firstPaneId) {
          targetPaneId = firstPaneId;
        } else {
          // 既存ペインが全く無い場合は新規作成
          const existingIds = get().panes.map(p => p.id);
          let nextNum = 1;
          while (existingIds.includes(`pane-${nextNum}`)) nextNum++;
          const newPaneId = `pane-${nextNum}`;
          const newPane: EditorPane = { id: newPaneId, tabs: [], activeTabId: '' };
          get().addPane(newPane);
          targetPaneId = newPaneId;
          set({ activePane: newPaneId });
        }
      }

      // 最終確認ガード（型安全性確保）
      if (!targetPaneId) {
        console.error('[TabStore] No pane available to open tab in');
        return;
      }
    }

    // 最終ガード：ここで targetPaneId が決まっていなければ処理を中止して型の安全性を確保
    if (!targetPaneId) {
      console.error('[TabStore] No pane available to open tab in (final guard)');
      return;
    }

    // もし targetPaneId が親ペイン（children を持つ）を指している場合、実際のタブ追加は葉ペインに行う。
    // これは「グローバルアクティブが空の親ペイン」になっている状況への対処。
    const normalizeToLeafPane = (paneId: string): string => {
      const startPane = get().getPane(paneId);
      if (!startPane) return paneId;

      const findLeaf = (p: EditorPane): EditorPane => {
        if (!p.children || p.children.length === 0) return p;
        // 優先的に最初の子を辿る（UI上のフォーカスを自然に保つため）
        return findLeaf(p.children[0]);
      };

      const leaf = findLeaf(startPane);
      return leaf.id || paneId;
    };

    // 正規化して葉ペインIDを使う
    targetPaneId = normalizeToLeafPane(targetPaneId);

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

  // タブを特定のインデックスに移動（同一ペイン内の並び替えまたは他ペインへ挿入）
  moveTabToIndex: (fromPaneId: string, toPaneId: string, tabId: string, index: number) => {
    const state = get();
    const fromPane = state.getPane(fromPaneId);
    const toPane = state.getPane(toPaneId);
    if (!fromPane || !toPane) return;

    const tab = fromPane.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // 同一ペイン内の並べ替えの場合は単純に配列を並べ替えて終了
    if (fromPaneId === toPaneId) {
      const currentIndex = fromPane.tabs.findIndex(t => t.id === tabId);
      const targetIndex = Math.max(0, Math.min(index, fromPane.tabs.length - 1));
      if (currentIndex === -1 || currentIndex === targetIndex) return;

      const reordered = [...fromPane.tabs];
      const [removed] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, removed);

      get().updatePane(fromPaneId, {
        tabs: reordered,
        activeTabId: removed.id,
      });

      set({ globalActiveTab: removed.id, activePane: fromPaneId });
      return;
    }

    // 別ペインへ移動する場合
    // まず移動元から削除
    const newFromTabs = fromPane.tabs.filter(t => t.id !== tabId);
    get().updatePane(fromPaneId, {
      tabs: newFromTabs,
      activeTabId: fromPane.activeTabId === tabId ? (newFromTabs[0]?.id || '') : fromPane.activeTabId,
    });

    // 移動先に挿入
    const adjustedIndex = Math.max(0, Math.min(index, toPane.tabs.length));
    const newToTabs = [...toPane.tabs.slice(0, adjustedIndex), { ...tab, paneId: toPaneId }, ...toPane.tabs.slice(adjustedIndex)];

    get().updatePane(toPaneId, {
      tabs: newToTabs,
      activeTabId: tab.id,
    });

    set({
      globalActiveTab: tab.id,
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
    
    // existingPaneId も重複しないように生成
    let nextNum2 = nextNum + 1;
    while (existingIds.includes(`pane-${nextNum2}`) || `pane-${nextNum2}` === newPaneId) {
      nextNum2++;
    }
    const existingPaneId = `pane-${nextNum2}`;

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

  splitPaneAndMoveTab: (paneId, direction, tabId, side) => {
    const state = get();
    const targetPane = state.getPane(paneId);
    if (!targetPane) return;

    // 移動するタブを特定（どのペインにあるか探す）
    let sourcePaneId = '';
    let tabToMove: Tab | null = null;
    
    // 全ペインから探す
    const findTab = (panes: EditorPane[]) => {
      for (const p of panes) {
        const t = p.tabs.find(tab => tab.id === tabId);
        if (t) {
          sourcePaneId = p.id;
          tabToMove = t;
          return;
        }
        if (p.children) findTab(p.children);
      }
    };
    findTab(state.panes);

    if (!tabToMove || !sourcePaneId) return;

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
        // ソースペインからタブを削除（ターゲットと同じペインの場合は後で処理されるのでここでは削除しない）
        if (pane.id === sourcePaneId && sourcePaneId !== paneId) {
           const newTabs = pane.tabs.filter(t => t.id !== tabId);
           return {
             ...pane,
             tabs: newTabs,
             activeTabId: pane.activeTabId === tabId ? (newTabs[0]?.id || '') : pane.activeTabId
           };
        }

        if (pane.id === paneId) {
          // ターゲットペインを分割
          // 既存のタブ（移動するタブがここにある場合は除外）
          const existingTabs = pane.tabs.filter(t => t.id !== tabId).map(tab => ({
             ...tab,
             // IDは変更しない（移動ではないため）
             // ただし、新しいペインIDに属することになるため、内部的な整合性は必要だが
             // ここでは既存のタブをそのまま `existingPaneId` のペインに移す
             // タブIDにペインIDが含まれている場合などは置換が必要かもしれないが、
             // 現在の実装では tab.id は path ベースのようなのでそのままで良い場合が多い
             // しかし splitPane では replace している...
             // 安全のため splitPane と同様に replace するか、あるいは paneId プロパティだけ更新するか
             // tabStore の moveTab では paneId プロパティを更新している
             paneId: existingPaneId
          }));
          
          // 移動するタブ
          const movedTab = { ...tabToMove!, paneId: newPaneId };

          const pane1 = {
            id: existingPaneId,
            tabs: existingTabs,
            activeTabId: pane.activeTabId === tabId ? (existingTabs[0]?.id || '') : pane.activeTabId, // 移動するタブがアクティブだった場合は別のアクティブへ
            parentId: paneId,
            size: 50,
          };

          const pane2 = {
            id: newPaneId,
            tabs: [movedTab],
            activeTabId: movedTab.id,
            parentId: paneId,
            size: 50,
          };

          return {
            ...pane,
            layout: direction,
            children: side === 'before' ? [pane2, pane1] : [pane1, pane2],
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

    const newPanes = updatePaneRecursive(state.panes);
    set({ 
      panes: newPanes,
      activePane: newPaneId,
      globalActiveTab: tabId
    });
  },

  resizePane: (paneId, newSize) => {
    get().updatePane(paneId, { size: newSize });
  },

  updateTabContent: (tabId: string, content: string, immediate = false) => {
    const allTabs = get().getAllTabs();
    const tabInfo = allTabs.find(t => t.id === tabId);

    if (!tabInfo) return;

    // editor/preview 系のみ操作対象
    if (!(tabInfo.kind === 'editor' || tabInfo.kind === 'preview')) return;

    const targetPath = tabInfo.path || '';
    const targetKind = tabInfo.kind;

    // 全てのペインを巡回して、path と kind が一致するタブを更新
    const updatePanesRecursive = (panes: any[]): any[] => {
      return panes.map((pane: any) => {
        const newTabs = pane.tabs.map((t: any) => {
          if (t.path === targetPath && t.kind === targetKind) {
            return { ...t, content, isDirty: immediate ? true : false };
          }
          return t;
        });

        if (pane.children) {
          return { ...pane, tabs: newTabs, children: updatePanesRecursive(pane.children) };
        }

        return { ...pane, tabs: newTabs };
      });
    };

    set(state => ({ panes: updatePanesRecursive(state.panes) }));
  },

  // DiffTabのコンテンツを同期更新（同じパスを持つ全てのDiffTabを更新）
  updateDiffTabContent: (path: string, content: string, immediate = false) => {
    if (!path) return;

    // 変更が必要なタブがあるかチェック
    let hasChanges = false;

    // 全てのペインを巡回して、pathが一致するdiffタブを更新
    const updatePanesRecursive = (panes: any[]): any[] => {
      return panes.map((pane: any) => {
        let paneChanged = false;
        const newTabs = pane.tabs.map((t: any) => {
          if (t.kind === 'diff' && t.path === path && t.diffs && t.diffs.length > 0) {
            // コンテンツが同じ場合はスキップ
            if (t.diffs[0].latterContent === content && t.isDirty === immediate) {
              return t;
            }
            // diffsの最初の要素のlatterContentを更新
            const updatedDiffs = [...t.diffs];
            updatedDiffs[0] = {
              ...updatedDiffs[0],
              latterContent: content,
            };
            paneChanged = true;
            hasChanges = true;
            return { ...t, diffs: updatedDiffs, isDirty: immediate };
          }
          return t;
        });

        if (pane.children) {
          const newChildren = updatePanesRecursive(pane.children);
          if (paneChanged || newChildren !== pane.children) {
            return { ...pane, tabs: newTabs, children: newChildren };
          }
        }

        return paneChanged ? { ...pane, tabs: newTabs } : pane;
      });
    };

    const newPanes = updatePanesRecursive(get().panes);
    if (hasChanges) {
      set({ panes: newPanes });
    }
  },

  saveSession: async () => {
    const state = get();
    const { sessionStorage, DEFAULT_SESSION } = await import('@/stores/sessionStorage');
    
    // UI状態は含めない（page.tsxが管理）
    const session = {
      version: 1,
      lastSaved: Date.now(),
      tabs: {
        panes: state.panes,
        activePane: state.activePane,
        globalActiveTab: state.globalActiveTab,
      },
      ui: DEFAULT_SESSION.ui, // デフォルト値を使用
    };
    
    await sessionStorage.save(session);
  },

  loadSession: async () => {
    try {
      const { sessionStorage } = await import('@/stores/sessionStorage');
      console.log('[TabStore] Loading session from IndexedDB...');
      const session = await sessionStorage.load();

      set({
        panes: session.tabs.panes,
        activePane: session.tabs.activePane || null,
      });

      console.log('[TabStore] Session restored successfully');

      // タブが1つもない場合は即座にコンテンツ復元完了とする
      const hasAnyTabs = session.tabs.panes.some((pane: any) => {
        const checkPane = (p: any): boolean => {
          if (p.tabs && p.tabs.length > 0) return true;
          if (p.children) return p.children.some(checkPane);
          return false;
        };
        return checkPane(pane);
      });

      if (!hasAnyTabs) {
        console.log('[TabStore] No tabs to restore, marking as completed immediately');
        set({ isContentRestored: true });
      }
    } catch (error) {
      console.error('[TabStore] Failed to restore session:', error);
      set({ isContentRestored: true });
    } finally {
      set({ isLoading: false, isRestored: true });
    }
  },
}));
