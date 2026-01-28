// src/components/Tab/TabBar.tsx
'use client';
import {
  Menu,
  Minus,
  Plus,
  Save,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Trash2,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';

import DraggableTab from './DraggableTab';
import { TabIcon } from './TabIcon';
import { useTabCloseConfirmation } from './useTabCloseConfirmation';

import { DND_TAB } from '@/constants/dndTypes';
import { useFileSelector } from '@/context/FileSelectorContext';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { type EditorPane, hasContent } from '@/engine/tabs/types';
import { triggerAction, useKeyBinding } from '@/hooks/keybindings/useKeyBindings';
import { tabActions, tabState } from '@/stores/tabState';
import { useSnapshot, snapshot } from 'valtio';
import { hasContent, type EditorPane } from '@/engine/tabs/types';

interface TabBarProps {
  paneId: string;
}

interface TabRect {
  left: number;
  bottom: number;
}

interface TabContextMenuState {
  isOpen: boolean;
  tabId: string;
  tabRect: TabRect | null;
}

/**
 * TabBar: 完全に自律的なタブバーコンポーネント
 * - タブのクリック = タブをアクティブにする
 * - タブの右クリック/長押し = コンテキストメニューを表示
 * - メニューはタブの真下に固定表示
 */
export default function TabBar({ paneId }: TabBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { requestClose, ConfirmationDialog } = useTabCloseConfirmation();
  const { openFileSelector } = useFileSelector();

  const {
    getPane,
    activateTab,
    closeTab,
    openTab,
    removePane,
    moveTab,
    moveTabToIndex,
    splitPane,
  } = tabActions;

  // Subscribe only to minimal pane metadata for rendering
  const paneMeta = useSnapshot(tabState).panes.find(p => p.id === paneId);
  const tabsMeta =
    paneMeta?.tabs?.map(t => ({ id: t.id, name: t.name, isDirty: t.isDirty, kind: t.kind, path: t.path })) || [];
  const activeTabId = paneMeta?.activeTabId;
  const globalActiveTab = useSnapshot(tabState).globalActiveTab;

  // Non-reactive access to full pane structure for imperative operations
  const pane = getPane(paneId);
  if (!pane) return null;

  // ペインメニューの開閉状態
  const [paneMenuOpen, setPaneMenuOpen] = useState(false);
  const paneMenuRef = useRef<HTMLDivElement>(null);

  // タブコンテキストメニューの状態
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState>({
    isOpen: false,
    tabId: '',
    tabRect: null,
  });
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  // タッチ検出用
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressRef = useRef(false);

  // メニュー外クリックで閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (
        paneMenuOpen &&
        paneMenuRef.current &&
        !paneMenuRef.current.contains(event.target as Node)
      ) {
        setPaneMenuOpen(false);
      }
      if (
        tabContextMenu.isOpen &&
        tabContextMenuRef.current &&
        !tabContextMenuRef.current.contains(event.target as Node)
      ) {
        setTabContextMenu({ isOpen: false, tabId: '', tabRect: null });
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [paneMenuOpen, tabContextMenu.isOpen]);

  // 同名ファイルの重複チェック（最小データで計算）
  const nameCount: Record<string, number> = {};
  tabsMeta.forEach(tab => {
    nameCount[tab.name] = (nameCount[tab.name] || 0) + 1;
  });

  // タブを閉じる
  const handleTabClose = useCallback(
    (tabId: string) => {
      // Use a non-reactive snapshot to get current dirty flag if needed
      const state = snapshot(tabState);
      const tab = state.panes.flatMap((p: any) => p.tabs || []).find((t: any) => t.id === tabId);
      requestClose(tabId, (tab as any)?.isDirty || false, () => closeTab(paneId, tabId));
    },
    [requestClose, closeTab, paneId]
  );

  // 新しいタブを追加
  const handleAddTab = useCallback(() => {
    openFileSelector(paneId);
  }, [openFileSelector, paneId]);

  const handleRemovePane = useCallback(() => {
    // Use a fresh snapshot at the moment of the click to avoid races with in-flight
    // updates to the shared pane tree. Close any open menus first so we don't try to
    // reference elements that may be unmounted during removal.
    const currentPanes = snapshot(tabState).panes;
    const flatPanes = flattenPanes(currentPanes);
    if (flatPanes.length <= 1) return;

    // Check for dirty tabs in this pane
    const targetPane = currentPanes.find(p => p.id === paneId) || flattenPanes(currentPanes).find(p => p.id === paneId);
    if (targetPane) {
      const hasDirtyTabs = targetPane.tabs.some(t => t.isDirty);
      if (hasDirtyTabs) {
        if (!confirm(t('tabCloseConfirmation.discardChangesMessage') || 'You have unsaved changes. Are you sure you want to close this pane?')) {
          setPaneMenuOpen(false);
          return;
        }
      }
    }

    setPaneMenuOpen(false);
    setTabContextMenu({ isOpen: false, tabId: '', tabRect: null });

    // Defer the actual removal so we don't run a synchronous state mutation in the
    // middle of click handling, which has caused crashes in some cases.
    requestAnimationFrame(() => {
      try {
        removePane(paneId);
      } catch (err) {
        console.error('[TabBar] removePane failed', err);
      }
    });
  }, [paneId, removePane, t]);
  // 全タブを閉じる
  const handleRemoveAllTabs = useCallback(() => {
    // Use non-reactive snapshot for authoritative list at click time
    const state = snapshot(tabState);
    const currentPane = state.panes.find((p: any) => p.id === paneId);
    currentPane?.tabs?.forEach((tab: any) => closeTab(paneId, tab.id));
  }, [closeTab, paneId]);

  // タブをペインに移動
  const handleMoveTabToPane = useCallback(
    (tabId: string, targetPaneId: string) => {
      moveTab(paneId, targetPaneId, tabId);
      setTabContextMenu({ isOpen: false, tabId: '', tabRect: null });
    },
    [moveTab, paneId]
  );

  // コンテキストメニューを開く（タブの真下に固定）
  const openTabContextMenu = useCallback((tabId: string, tabElement: HTMLElement) => {
    const rect = tabElement.getBoundingClientRect();
    setTabContextMenu({
      isOpen: true,
      tabId,
      tabRect: { left: rect.left, bottom: rect.bottom },
    });
  }, []);

  // タブクリック = アクティブにする（メニューは開かない）
  const handleTabClick = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      const target = e.target as HTMLElement;
      // 閉じるボタンがクリックされた場合は無視
      if (target.closest('[data-close-button]')) {
        return;
      }
      activateTab(paneId, tabId);
    },
    [activateTab, paneId]
  );

  // タブ右クリック = コンテキストメニューを表示
  const handleTabRightClick = useCallback(
    (e: React.MouseEvent, tabId: string, tabElement: HTMLElement) => {
      e.preventDefault();
      e.stopPropagation();
      openTabContextMenu(tabId, tabElement);
    },
    [openTabContextMenu]
  );

  // タッチ開始 = タッチ位置を記録
  const handleTouchStart = useCallback(
    (e: React.TouchEvent, tabId: string, tabElement: HTMLElement) => {
      const touch = e.touches[0];
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      isLongPressRef.current = false;
    },
    []
  );

  // タッチ終了 = モバイルではタブをアクティブにする（コンテキストメニューは表示しない）
  // 注意: e.preventDefault()を呼ぶとreact-dndのドロップイベントがブロックされるため呼ばない
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent, tabId: string, tabElement: HTMLElement) => {
      const target = e.target as HTMLElement;

      // 閉じるボタンがタップされた場合は無視
      if (target.closest('[data-close-button]')) {
        touchStartPosRef.current = null;
        return;
      }

      // タップ（短いタッチ）でタブをアクティブにする（onClickに任せる）
      // コンテキストメニューは表示しない（PCの右クリックのみ）
      touchStartPosRef.current = null;
      isLongPressRef.current = false;
    },
    []
  );

  // タッチ移動 = タップキャンセル
  const handleTouchMove = useCallback(() => {
    touchStartPosRef.current = null;
  }, []);

  // ショートカットキー
  useKeyBinding('newTab', handleAddTab, [paneId]);

  useKeyBinding(
    'closeTab',
    () => {
      if (snapshot(tabState).activePane !== paneId) return;
      if (activeTabId) handleTabClose(activeTabId);
    },
    [activeTabId, paneId]
  );

  useKeyBinding(
    'removeAllTabs',
    () => {
      if (snapshot(tabState).activePane !== paneId) return;
      handleRemoveAllTabs();
    },
    [paneId]
  );

  useKeyBinding(
    'nextTab',
    () => {
      if (snapshot(tabState).activePane !== paneId) return;
      if (tabsMeta.length === 0) return;
      const currentIndex = tabsMeta.findIndex(t => t.id === activeTabId);
      const nextIndex = (currentIndex + 1) % tabsMeta.length;
      activateTab(paneId, tabsMeta[nextIndex].id);
    },
    [tabsMeta, activeTabId, paneId]
  );

  useKeyBinding(
    'prevTab',
    () => {
      if (snapshot(tabState).activePane !== paneId) return;
      if (tabsMeta.length === 0) return;
      const currentIndex = tabsMeta.findIndex(t => t.id === activeTabId);
      const prevIndex = (currentIndex - 1 + tabsMeta.length) % tabsMeta.length;
      activateTab(paneId, tabsMeta[prevIndex].id);
    },
    [tabsMeta, activeTabId, paneId]
  );

  useKeyBinding(
    'openMdPreview',
    () => {
      if (tabState.activePane !== paneId) return;
      const activeTab = tabsMeta.find(t => t.id === activeTabId);
      if (!activeTab) return;

      const ext = activeTab.name.split('.').pop()?.toLowerCase() || '';
      if (!(ext === 'md' || ext === 'mdx')) return;

      // Helper: open preview for current active tab into the target pane using a non-reactive snapshot
      const openPreviewIntoPane = (targetPaneId: string) => {
        const state = snapshot(tabState);
        const freshTab = state.panes.flatMap((p: any) => p.tabs || []).find((t: any) => t.id === activeTab.id);
        if (!freshTab) return;
        openTab(
          {
            name: freshTab.name || activeTab.name,
            path: freshTab.path || activeTab.path,
            content: freshTab.content,
          },
          { kind: 'preview', paneId: targetPaneId, targetPaneId }
        );
      };

      const leafPanes = flattenPanes(snapshot(tabState).panes);

      if (leafPanes.length === 1) {
        splitPane(paneId, 'vertical');
        const parent = getPane(paneId);
        if (!parent?.children?.length) return;

        const newPane =
          parent.children.find(c => !c.tabs || c.tabs.length === 0) ||
          parent.children[1] ||
          parent.children[0];
        if (newPane) {
          openPreviewIntoPane(newPane.id);
        }
        return;
      }

      const other = leafPanes.filter(p => p.id !== paneId);
      if (other.length === 0) return;
      const emptyOther = other.find(p => !p.tabs || p.tabs.length === 0);
      const randomPane = emptyOther || other[Math.floor(Math.random() * other.length)];

      openPreviewIntoPane(randomPane.id);
    },
    [paneId, activeTabId, tabsMeta]
  );

  // ペインリスト（タブ移動用） - non-reactive snapshot for list
  const flatPanes = flattenPanes(snapshot(tabState).panes);
  const availablePanes = flatPanes.map((p, idx) => ({
    id: p.id,
    name: `Pane ${idx + 1}`,
  }));

  // ホイールスクロール対応
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      (e.currentTarget as HTMLDivElement).scrollBy({ left: e.deltaY, behavior: 'auto' });
      e.preventDefault();
    }
  };

  // コンテナへのドロップ
  const [, containerDrop] = useDrop(
    () => ({
      accept: DND_TAB,
      drop: (item: any) => {
        if (!item?.tabId) return;
        if (item.fromPaneId === paneId) return;
        moveTab(item.fromPaneId, paneId, item.tabId);
      },
    }),
    [paneId]
  );

  // タブリストコンテナへの参照（自動スクロール用）
  const tabListContainerRef = useRef<HTMLDivElement>(null);

  // アクティブタブが変更されたときに自動スクロールする
  useEffect(() => {
    if (!activeTabId || !tabListContainerRef.current) return;

    // アクティブタブの要素を探す
    const container = tabListContainerRef.current;
    const activeTabElement = container.querySelector(
      `[data-tab-id="${activeTabId}"]`
    ) as HTMLElement;

    if (activeTabElement) {
      // タブが見えているかどうかをチェック
      const containerRect = container.getBoundingClientRect();
      const tabRect = activeTabElement.getBoundingClientRect();

      // タブが左端より左にあるか、右端より右にあるか
      const isOutOfViewLeft = tabRect.left < containerRect.left;
      const isOutOfViewRight = tabRect.right > containerRect.right;

      if (isOutOfViewLeft || isOutOfViewRight) {
        // スムーズスクロールでタブを表示位置に移動
        activeTabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeTabId]);

  // DraggableTab moved to ./DraggableTab.tsx
  return (
    <div
      className="h-10 border-b flex items-center relative bg-muted border-border"
      style={{ background: colors.mutedBg, borderColor: colors.border, zIndex: 1 }}
    >
      {/* ペインメニューボタン */}
      <div className="flex items-center h-full pl-2 pr-1 gap-1 relative">
        <button
          className="p-1 rounded focus:outline-none focus:ring-2"
          style={{ background: paneMenuOpen ? colors.accentBg : undefined }}
          onClick={() => setPaneMenuOpen(open => !open)}
          title={t('tabBar.paneMenu')}
          onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
          onMouseLeave={e =>
            (e.currentTarget.style.background = paneMenuOpen ? colors.accentBg : '')
          }
        >
          <Menu size={20} color={colors.accentFg} />
        </button>

        {/* ペインメニュー */}
        {paneMenuOpen && (
          <div
            ref={paneMenuRef}
            className="absolute top-11 left-0 bg-card border border-border rounded-lg shadow-2xl z-20 min-w-[180px] py-2 px-1 flex flex-col gap-1"
            style={{ background: colors.cardBg, borderColor: colors.border }}
          >
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              onClick={() => {
                setPaneMenuOpen(false);
                handleRemovePane();
              }}
              title={t('tabBar.removePane')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Minus size={16} color={colors.red} />
              <span style={{ color: colors.foreground }}>{t('tabBar.removePane')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              onClick={() => {
                setPaneMenuOpen(false);
                splitPane(paneId, 'horizontal');
              }}
              title={t('tabBar.splitVertical')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <SplitSquareVertical size={16} color={colors.accentFg} />
              <span style={{ color: colors.foreground }}>{t('tabBar.splitVertical')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              onClick={() => {
                setPaneMenuOpen(false);
                splitPane(paneId, 'vertical');
              }}
              title={t('tabBar.splitHorizontal')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <SplitSquareHorizontal size={16} color={colors.accentFg} />
              <span style={{ color: colors.foreground }}>{t('tabBar.splitHorizontal')}</span>
            </button>
            <div className="h-px bg-border my-1" />
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              onClick={() => {
                setPaneMenuOpen(false);
                handleRemoveAllTabs();
              }}
              title={t('tabBar.removeAllTabs')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Trash2 size={16} color={colors.red} />
              <span style={{ color: colors.foreground }}>{t('tabBar.removeAllTabs')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              onClick={() => {
                setPaneMenuOpen(false);
                triggerAction('saveFile');
              }}
              title={t('common.save')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Save size={16} color={colors.primary} />
              <span style={{ color: colors.foreground }}>{t('common.save')}</span>
            </button>
          </div>
        )}
      </div>

      {/* タブリスト */}
      <div
        className="flex items-center overflow-x-auto flex-1 select-none"
        ref={node => {
          tabListContainerRef.current = node;
          if (node) containerDrop(node as any);
        }}
        onWheel={handleWheel}
      >
        {tabsMeta.map((tab, tabIndex) => (
          <DraggableTab
            key={`${paneId}-${tabIndex}-${tab.id}`}
            tab={tab as any}
            tabIndex={tabIndex}
            paneId={paneId}
            isActive={tab.id === activeTabId || globalActiveTab === tab.id}
            isDuplicate={(nameCount[tab.name] || 0) > 1}
            onClick={handleTabClick}
            onContextMenu={handleTabRightClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onClose={handleTabClose}
          />
        ))}
        <button
          className="h-full px-3 flex items-center justify-center flex-shrink-0 hover:bg-accent"
          onClick={handleAddTab}
        >
          <Plus size={16} color={colors.accentFg} />
        </button>
      </div>

      {/* タブコンテキストメニュー（タブの真下に固定） */}
      {tabContextMenu.isOpen && tabContextMenu.tabRect && (
        <div
          ref={tabContextMenuRef}
          className="fixed bg-card border border-border rounded shadow-lg z-50 min-w-[150px] p-2 select-none"
          style={{
            background: colors.cardBg,
            borderColor: colors.border,
            left: `${tabContextMenu.tabRect.left}px`,
            top: `${tabContextMenu.tabRect.bottom}px`,
          }}
        >
          {/* Markdownプレビュー */}
          {tabsMeta.find(t => t.id === tabContextMenu.tabId)?.name.toLowerCase().endsWith('.md') && (
            <button
              className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
              onClick={() => {
                // Pull the latest content at the time of user action
                const state = snapshot(tabState);
                const tab = state.panes.flatMap((p: any) => p.tabs || []).find((t: any) => t.id === tabContextMenu.tabId);
                if (tab) {
                  openTab(
                    { name: tab.name, path: tab.path, content: tab.content },
                    { kind: 'preview', paneId, targetPaneId: paneId }
                  );
                }
                setTabContextMenu({ isOpen: false, tabId: '', tabRect: null });
              }}
            >
              {t('tabBar.openPreview')}
            </button>
          )}
          <button
            className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
            onClick={() => {
              handleTabClose(tabContextMenu.tabId);
              setTabContextMenu({ isOpen: false, tabId: '', tabRect: null });
            }}
          >
            {t('tabBar.closeTab')}
          </button>
          {availablePanes.length > 1 && (
            <>
              <div className="text-xs text-muted-foreground px-2 py-1 mt-2">
                {t('tabBar.moveToPane')}
              </div>
              {availablePanes
                .filter(p => p.id !== paneId)
                .map(p => (
                  <button
                    key={p.id}
                    className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
                    onClick={() => handleMoveTabToPane(tabContextMenu.tabId, p.id)}
                  >
                    {p.name}
                  </button>
                ))}
            </>
          )}
        </div>
      )}

      {ConfirmationDialog}
    </div>
  );
}

// ペインをフラット化
function flattenPanes(panes: readonly EditorPane[]): EditorPane[] {
  const result: EditorPane[] = [];
  const traverse = (items: readonly EditorPane[]) => {
    for (const pane of items) {
      if (!pane.children || pane.children.length === 0) result.push(pane);
      if (pane.children) traverse(pane.children);
    }
  };
  traverse(panes);
  return result;
}
