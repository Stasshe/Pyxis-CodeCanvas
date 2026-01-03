// src/stores/tabStore.ts
import { create } from 'zustand';

import { updateCachedModelContent } from '@/components/Tab/text-editor/hooks/useMonacoModels';
import { fileRepository } from '@/engine/core/fileRepository';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { DiffTab, EditorPane, OpenTabOptions, Tab } from '@/engine/tabs/types';
import { getCurrentProjectId } from './projectStore';

// Helper function to flatten all leaf panes (preserving order for pane index priority)
function flattenLeafPanes(panes: EditorPane[], result: EditorPane[] = []): EditorPane[] {
  for (const p of panes) {
    if (!p.children || p.children.length === 0) {
      result.push(p);
    } else {
      flattenLeafPanes(p.children, result);
    }
  }
  return result;
}

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
  splitPaneAndOpenFile: (
    paneId: string,
    direction: 'horizontal' | 'vertical',
    file: any,
    side: 'before' | 'after'
  ) => void;
  resizePane: (paneId: string, newSize: number) => void;

  // タブ操作
  /**
   * タブを開く（非同期）
   * 新規タブ作成時、fileRepositoryから最新のコンテンツを取得
   * 注意: 非同期関数ですが、既存の呼び出し元では await 不要（後方互換性あり）
   */
  openTab: (file: any, options?: OpenTabOptions) => Promise<void>;
  closeTab: (paneId: string, tabId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  updateTab: (paneId: string, tabId: string, updates: Partial<Tab>) => void;
  updateTabContent: (tabId: string, content: string, isDirty?: boolean) => void;
  moveTab: (fromPaneId: string, toPaneId: string, tabId: string) => void;
  moveTabToIndex: (fromPaneId: string, toPaneId: string, tabId: string, index: number) => void;

  // ユーティリティ
  getPane: (paneId: string) => EditorPane | null;
  getTab: (paneId: string, tabId: string) => Tab | null;
  getAllTabs: () => Tab[];
  findTabByPath: (path: string, kind?: string) => { paneId: string; tab: Tab } | null;

  // ファイル削除時のタブ処理
  handleFileDeleted: (deletedPath: string) => void;
  handleFilesDeleted: (deletedPaths: string[]) => void; // バッチ処理版

  // セッション管理
  saveSession: () => Promise<void>;
  loadSession: () => Promise<void>;
}

// パス正規化ヘルパー関数（ファイル削除処理で共通使用）
function normalizeTabPath(p?: string): string {
  if (!p) return '';
  const withoutKindPrefix = p.includes(':') ? p.replace(/^[^:]+:/, '') : p;
  const cleaned = withoutKindPrefix.replace(/(-preview|-diff|-ai)$/, '');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
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

  openTab: async (file, options = {}) => {
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

    // 既存タブの検索
    const pane = state.getPane(targetPaneId);
    if (!pane) {
      console.error(`[TabStore] Pane not found: ${targetPaneId}`);
      return;
    }

    // shouldReuseTabがある場合の検索
    if (tabDef.shouldReuseTab) {
      // searchAllPanesForReuseがtrueの場合、全ペインを検索（paneIndexが小さいペインを優先）
      if (options.searchAllPanesForReuse) {
        const allLeafPanes = flattenLeafPanes(state.panes);

        for (const searchPane of allLeafPanes) {
          for (const tab of searchPane.tabs) {
            if (tab.kind === kind && tabDef.shouldReuseTab(tab, file, options)) {
              // 既存タブを再利用する前に、最新のコンテンツで更新
              if ((kind === 'editor' || kind === 'binary') && file.path) {
                try {
                  const projectId = getCurrentProjectId();
                  if (projectId) {
                    const freshFile = await fileRepository.getFileByPath(projectId, file.path);
                    if (freshFile && freshFile.content !== undefined) {
                      // 既存タブのコンテンツを最新に更新
                      get().updateTabContent(tab.id, freshFile.content, false);
                    }
                  }
                } catch (e) {
                  console.warn('[TabStore] Failed to load fresh content for reused tab:', e);
                }
              }
              
              // 既存タブをアクティブ化
              if (options.makeActive !== false) {
                get().activateTab(searchPane.id, tab.id);
              }
              console.log(
                '[TabStore] Reusing existing tab via shouldReuseTab (all panes):',
                tab.id,
                'in pane:',
                searchPane.id
              );
              return;
            }
          }
        }
        // 全ペインで見つからなかった場合は新規タブを作成
      } else {
        // 従来の動作：targetPane内でのみカスタム検索を行う
        for (const tab of pane.tabs) {
          if (tab.kind === kind && tabDef.shouldReuseTab(tab, file, options)) {
            // 既存タブを再利用する前に、最新のコンテンツで更新
            if ((kind === 'editor' || kind === 'binary') && file.path) {
              try {
                const projectId = getCurrentProjectId();
                if (projectId) {
                  const freshFile = await fileRepository.getFileByPath(projectId, file.path);
                  if (freshFile && freshFile.content !== undefined) {
                    // 既存タブのコンテンツを最新に更新
                    get().updateTabContent(tab.id, freshFile.content, false);
                  }
                }
              } catch (e) {
                console.warn('[TabStore] Failed to load fresh content for reused tab:', e);
              }
            }
            
            // 既存タブをアクティブ化
            if (options.makeActive !== false) {
              get().activateTab(targetPaneId, tab.id);
            }
            console.log('[TabStore] Reusing existing tab via shouldReuseTab:', tab.id);
            return;
          }
        }
        // shouldReuseTabで見つからなかった場合は新規タブを作成（通常検索はスキップ）
      }
    } else {
      // shouldReuseTabがない場合は、通常の検索（パス/IDベース）
      const tabId =
        kind !== 'editor' ? `${kind}:${file.path || file.name}` : file.path || file.name;
      const existingTab = pane.tabs.find(t => {
        // 同じkindとpathのタブを検索
        return t.kind === kind && (t.path === file.path || t.id === tabId);
      });

      if (existingTab) {
        // 既存タブを再利用する前に、最新のコンテンツで更新
        if ((kind === 'editor' || kind === 'binary') && file.path) {
          try {
            const projectId = getCurrentProjectId();
            if (projectId) {
              const freshFile = await fileRepository.getFileByPath(projectId, file.path);
              if (freshFile && freshFile.content !== undefined) {
                // 既存タブのコンテンツを最新に更新
                get().updateTabContent(existingTab.id, freshFile.content, false);
              }
            }
          } catch (e) {
            console.warn('[TabStore] Failed to load fresh content for reused tab:', e);
          }
        }
        
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
    }

    // 新規タブの作成
    // エディタータブの場合、最新のコンテンツをfileRepositoryから取得
    let fileToCreate = file;
    if ((kind === 'editor' || kind === 'binary') && file.path) {
      try {
        const projectId = getCurrentProjectId();
        if (projectId) {
          const freshFile = await fileRepository.getFileByPath(projectId, file.path);
          if (freshFile) {
            // 最新のコンテンツのみ更新（重要なプロパティは保持）
            fileToCreate = {
              ...file,
              content: freshFile.content,
              isBufferArray: freshFile.isBufferArray ?? file.isBufferArray,
              bufferContent: freshFile.bufferContent ?? file.bufferContent,
            };
          }
        }
      } catch (e) {
        console.warn('[TabStore] Failed to load fresh content for new tab:', e);
        // フォールバック: 渡されたfileオブジェクトをそのまま使用
      }
    }

    const newTab = tabDef.createTab(fileToCreate, { ...options, paneId: targetPaneId });

    // ペインにタブを追加し、グローバルアクティブタブも同時に更新
    // 別々のset呼び出しではなく、1つの更新で原子的に行うことで
    // 状態の不整合を防ぐ
    const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(p => {
        if (p.id === targetPaneId) {
          return {
            ...p,
            tabs: [...p.tabs, newTab],
            activeTabId: options.makeActive !== false ? newTab.id : p.activeTabId,
          };
        }
        if (p.children) {
          return { ...p, children: updatePaneRecursive(p.children) };
        }
        return p;
      });
    };

    set(state => ({
      panes: updatePaneRecursive(state.panes),
      ...(options.makeActive !== false
        ? {
            globalActiveTab: newTab.id,
            activePane: targetPaneId,
          }
        : {}),
    }));
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
    // ペインのactiveTabIdとグローバル状態を同時に更新
    // 別々のset呼び出しだと状態の不整合が発生し、フォーカスが正しく当たらない
    const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(p => {
        if (p.id === paneId) {
          return { ...p, activeTabId: tabId };
        }
        if (p.children) {
          return { ...p, children: updatePaneRecursive(p.children) };
        }
        return p;
      });
    };

    set(state => ({
      panes: updatePaneRecursive(state.panes),
      globalActiveTab: tabId,
      activePane: paneId,
    }));
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
      activeTabId: fromPane.activeTabId === tabId ? newFromTabs[0]?.id || '' : fromPane.activeTabId,
    });

    // 移動先に挿入
    const adjustedIndex = Math.max(0, Math.min(index, toPane.tabs.length));
    const newToTabs = [
      ...toPane.tabs.slice(0, adjustedIndex),
      { ...tab, paneId: toPaneId },
      ...toPane.tabs.slice(adjustedIndex),
    ];

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

  // ファイル削除時のタブ処理: editor/previewを閉じ、diffはコンテンツを空にする
  handleFileDeleted: (deletedPath: string) => {
    const state = get();
    const normalizedDeletedPath = normalizeTabPath(deletedPath);
    console.log('[TabStore] handleFileDeleted:', normalizedDeletedPath);

    // 閉じるタブを収集
    const tabsToClose: Array<{ paneId: string; tabId: string }> = [];

    // ペインを再帰的に更新
    const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => {
        if (pane.children && pane.children.length > 0) {
          return { ...pane, children: updatePaneRecursive(pane.children) };
        }

        // リーフペイン
        const newTabs = pane.tabs.map((tab: Tab) => {
          const tabPath = normalizeTabPath(tab.path);

          // editor/previewは閉じる対象として記録
          if (
            (tab.kind === 'editor' || tab.kind === 'preview') &&
            tabPath === normalizedDeletedPath
          ) {
            tabsToClose.push({ paneId: pane.id, tabId: tab.id });
            return tab;
          }

          // 編集可能なdiffタブ（ワーキングディレクトリとの差分）のみコンテンツを空にする
          // readonlyのdiffタブ（過去のcommit間の差分）は変更不要
          if (tab.kind === 'diff' && tabPath === normalizedDeletedPath) {
            const diffTab = tab as DiffTab;
            if (diffTab.editable) {
              return {
                ...diffTab,
                diffs: diffTab.diffs.map(diff => ({
                  ...diff,
                  latterContent: '',
                })),
              };
            }
          }

          return tab;
        });

        return { ...pane, tabs: newTabs };
      });
    };

    // diffタブのコンテンツを更新
    set({ panes: updatePaneRecursive(state.panes) });

    // editor/previewタブを閉じる
    for (const { paneId, tabId } of tabsToClose) {
      get().closeTab(paneId, tabId);
    }
  },

  // バッチ版: 複数ファイルの削除を一度に処理（パフォーマンス最適化）
  handleFilesDeleted: (deletedPaths: string[]) => {
    if (deletedPaths.length === 0) return;
    if (deletedPaths.length === 1) {
      get().handleFileDeleted(deletedPaths[0]);
      return;
    }

    const state = get();

    // 削除対象パスのセットを作成（高速検索用）
    const normalizedDeletedPaths = new Set(deletedPaths.map(p => normalizeTabPath(p)));
    console.log('[TabStore] handleFilesDeleted: batch processing', deletedPaths.length, 'files');

    // 閉じるタブを収集
    const tabsToClose: Array<{ paneId: string; tabId: string }> = [];

    // ペインを再帰的に更新（一度のトラバースで全ての削除を処理）
    const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => {
        if (pane.children && pane.children.length > 0) {
          return { ...pane, children: updatePaneRecursive(pane.children) };
        }

        // リーフペイン
        const newTabs = pane.tabs.map((tab: Tab) => {
          const tabPath = normalizeTabPath(tab.path);

          // 削除対象かチェック（Set検索でO(1)）
          if (!normalizedDeletedPaths.has(tabPath)) {
            return tab;
          }

          // editor/previewは閉じる対象として記録
          if (tab.kind === 'editor' || tab.kind === 'preview') {
            tabsToClose.push({ paneId: pane.id, tabId: tab.id });
            return tab;
          }

          // 編集可能なdiffタブのコンテンツを空にする
          if (tab.kind === 'diff') {
            const diffTab = tab as DiffTab;
            if (diffTab.editable) {
              return {
                ...diffTab,
                diffs: diffTab.diffs.map(diff => ({
                  ...diff,
                  latterContent: '',
                })),
              };
            }
          }

          return tab;
        });

        return { ...pane, tabs: newTabs };
      });
    };

    // diffタブのコンテンツを更新（一度のset呼び出し）
    set({ panes: updatePaneRecursive(state.panes) });

    // editor/previewタブを閉じる
    for (const { paneId, tabId } of tabsToClose) {
      get().closeTab(paneId, tabId);
    }
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
            activeTabId: pane.activeTabId === tabId ? newTabs[0]?.id || '' : pane.activeTabId,
          };
        }

        if (pane.id === paneId) {
          // ターゲットペインを分割
          // 既存のタブ（移動するタブがここにある場合は除外）
          const existingTabs = pane.tabs
            .filter(t => t.id !== tabId)
            .map(tab => ({
              ...tab,
              // IDは変更しない（移動ではないため）
              // ただし、新しいペインIDに属することになるため、内部的な整合性は必要だが
              // ここでは既存のタブをそのまま `existingPaneId` のペインに移す
              // タブIDにペインIDが含まれている場合などは置換が必要かもしれないが、
              // 現在の実装では tab.id は path ベースのようなのでそのままで良い場合が多い
              // しかし splitPane では replace している...
              // 安全のため splitPane と同様に replace するか、あるいは paneId プロパティだけ更新するか
              // tabStore の moveTab では paneId プロパティを更新している
              paneId: existingPaneId,
            }));

          // 移動するタブ
          const movedTab = { ...tabToMove!, paneId: newPaneId };

          const pane1 = {
            id: existingPaneId,
            tabs: existingTabs,
            activeTabId: pane.activeTabId === tabId ? existingTabs[0]?.id || '' : pane.activeTabId, // 移動するタブがアクティブだった場合は別のアクティブへ
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
      globalActiveTab: tabId,
    });
  },

  splitPaneAndOpenFile: (paneId, direction, file, side) => {
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

    // ファイル用の新しいタブを作成
    const defaultEditor =
      typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
    const kind = file.isBufferArray ? 'binary' : 'editor';
    const newTabId = `${file.path || file.name}-${Date.now()}`;
    const newTab: Tab = {
      id: newTabId,
      name: file.name,
      path: file.path,
      kind,
      paneId: newPaneId,
      content: file.content || '',
      isDirty: false,
      isCodeMirror: defaultEditor === 'codemirror',
    };

    // 再帰的にペインを更新
    const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => {
        if (pane.id === paneId) {
          // 既存のタブのpaneIdを更新
          const existingTabs = pane.tabs.map(tab => ({
            ...tab,
            paneId: existingPaneId,
          }));

          const pane1 = {
            id: existingPaneId,
            tabs: existingTabs,
            activeTabId: pane.activeTabId,
            parentId: paneId,
            size: 50,
          };

          const pane2 = {
            id: newPaneId,
            tabs: [newTab],
            activeTabId: newTabId,
            parentId: paneId,
            size: 50,
          };

          return {
            ...pane,
            layout: direction,
            children: side === 'before' ? [pane2, pane1] : [pane1, pane2],
            tabs: [],
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
      globalActiveTab: newTabId,
    });
  },

  resizePane: (paneId, newSize) => {
    get().updatePane(paneId, { size: newSize });
  },

  // タブのコンテンツを同期更新（TabRegistryのupdateContentを使用）
  // 拡張性を確保：各タブタイプが自身のupdateContent実装を提供
  updateTabContent: (tabId: string, content: string, isDirty = false) => {
    const allTabs = get().getAllTabs();
    const tabInfo = allTabs.find(t => t.id === tabId);

    if (!tabInfo) return;

    // TabRegistryから該当タブタイプの定義を取得
    const tabDef = tabRegistry.get(tabInfo.kind);

    // updateContentメソッドがない場合はスキップ
    if (!tabDef?.updateContent) return;

    // getContentPathでファイルパスを取得
    const targetPath = tabDef.getContentPath?.(tabInfo) || tabInfo.path || '';
    if (!targetPath) return;

    // 変更が必要なタブがあるかチェック
    let hasChanges = false;
    const updatedTabIds: string[] = [];

    // 全てのペインを巡回して、path が一致するタブを更新
    const updatePanesRecursive = (panes: EditorPane[]): EditorPane[] => {
      return panes.map(pane => {
        let paneChanged = false;
        const newTabs = pane.tabs.map(t => {
          // 同じパスを持つタブを検索
          const tDef = tabRegistry.get(t.kind);
          const tPath = tDef?.getContentPath?.(t) || t.path || '';

          if (tPath === targetPath && tDef?.updateContent) {
            const updatedTab = tDef.updateContent(t, content, isDirty);
            if (updatedTab !== t) {
              paneChanged = true;
              hasChanges = true;
              updatedTabIds.push(t.id);
              return updatedTab;
            }
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
      
      // 非アクティブなタブのMonacoモデルキャッシュも更新
      // これにより、タブを開いていない状態でも外部変更が反映される
      for (const updatedTabId of updatedTabIds) {
        try {
          updateCachedModelContent(updatedTabId, content);
        } catch (e) {
          console.warn('[TabStore] Failed to update cached model for:', updatedTabId, e);
        }
      }
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
