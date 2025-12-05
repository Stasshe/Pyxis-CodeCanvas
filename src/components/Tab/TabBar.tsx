// src/components/Tab/TabBar.tsx
'use client';
import {
  Menu,
  Plus,
  X,
  SplitSquareVertical,
  SplitSquareHorizontal,
  Trash2,
  Save,
  Minus,
} from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDrag, useDrop } from 'react-dnd';

import { TabIcon } from './TabIcon';
import { useTabCloseConfirmation } from './useTabCloseConfirmation';

import { DND_TAB } from '@/constants/dndTypes';
import { useFileSelector } from '@/context/FileSelectorContext';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { useKeyBinding } from '@/hooks/useKeyBindings';
import { useTabStore } from '@/stores/tabStore';

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

  const { getPane, activateTab, closeTab, openTab, removePane, moveTab, moveTabToIndex, splitPane, panes } =
    useTabStore();

  const pane = getPane(paneId);
  if (!pane) return null;

  const tabs = pane.tabs;
  const activeTabId = pane.activeTabId;

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
      if (paneMenuOpen && paneMenuRef.current && !paneMenuRef.current.contains(event.target as Node)) {
        setPaneMenuOpen(false);
      }
      if (tabContextMenu.isOpen && tabContextMenuRef.current && !tabContextMenuRef.current.contains(event.target as Node)) {
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

  // 同名ファイルの重複チェック
  const nameCount: Record<string, number> = {};
  tabs.forEach(tab => {
    nameCount[tab.name] = (nameCount[tab.name] || 0) + 1;
  });

  // タブを閉じる
  const handleTabClose = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      requestClose(tabId, (tab as any).isDirty || false, () => closeTab(paneId, tabId));
    }
  }, [tabs, requestClose, closeTab, paneId]);

  // 新しいタブを追加
  const handleAddTab = useCallback(() => {
    openFileSelector(paneId);
  }, [openFileSelector, paneId]);

  // ペインを削除
  const handleRemovePane = useCallback(() => {
    const flatPanes = flattenPanes(panes);
    if (flatPanes.length <= 1) return;
    removePane(paneId);
  }, [panes, removePane, paneId]);

  // 全タブを閉じる
  const handleRemoveAllTabs = useCallback(() => {
    tabs.forEach(tab => closeTab(paneId, tab.id));
  }, [tabs, closeTab, paneId]);

  // タブをペインに移動
  const handleMoveTabToPane = useCallback((tabId: string, targetPaneId: string) => {
    moveTab(paneId, targetPaneId, tabId);
    setTabContextMenu({ isOpen: false, tabId: '', tabRect: null });
  }, [moveTab, paneId]);

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
  const handleTabClick = useCallback((e: React.MouseEvent, tabId: string) => {
    const target = e.target as HTMLElement;
    // 閉じるボタンがクリックされた場合は無視
    if (target.closest('[data-close-button]')) {
      return;
    }
    activateTab(paneId, tabId);
  }, [activateTab, paneId]);

  // タブ右クリック = コンテキストメニューを表示
  const handleTabRightClick = useCallback((e: React.MouseEvent, tabId: string, tabElement: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    openTabContextMenu(tabId, tabElement);
  }, [openTabContextMenu]);

  // タッチ開始 = タッチ位置を記録
  const handleTouchStart = useCallback((e: React.TouchEvent, tabId: string, tabElement: HTMLElement) => {
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    isLongPressRef.current = false;
  }, []);

  // タッチ終了 = モバイルではタブをアクティブにする（コンテキストメニューは表示しない）
  // 注意: e.preventDefault()を呼ぶとreact-dndのドロップイベントがブロックされるため呼ばない
  const handleTouchEnd = useCallback((e: React.TouchEvent, tabId: string, tabElement: HTMLElement) => {
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
  }, []);

  // タッチ移動 = タップキャンセル
  const handleTouchMove = useCallback(() => {
    touchStartPosRef.current = null;
  }, []);

  // ショートカットキー
  useKeyBinding('newTab', handleAddTab, [paneId]);

  useKeyBinding('closeTab', () => {
    if (useTabStore.getState().activePane !== paneId) return;
    if (activeTabId) handleTabClose(activeTabId);
  }, [activeTabId, paneId]);

  useKeyBinding('removeAllTabs', () => {
    if (useTabStore.getState().activePane !== paneId) return;
    handleRemoveAllTabs();
  }, [tabs, paneId]);

  useKeyBinding('nextTab', () => {
    if (useTabStore.getState().activePane !== paneId) return;
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    const nextIndex = (currentIndex + 1) % tabs.length;
    activateTab(paneId, tabs[nextIndex].id);
  }, [tabs, activeTabId, paneId]);

  useKeyBinding('prevTab', () => {
    if (useTabStore.getState().activePane !== paneId) return;
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    activateTab(paneId, tabs[prevIndex].id);
  }, [tabs, activeTabId, paneId]);

  useKeyBinding('openMdPreview', () => {
    if (useTabStore.getState().activePane !== paneId) return;
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) return;

    const ext = activeTab.name.split('.').pop()?.toLowerCase() || '';
    if (!(ext === 'md' || ext === 'mdx')) return;

    const leafPanes = flattenPanes(panes);

    if (leafPanes.length === 1) {
      splitPane(paneId, 'vertical');
      const parent = getPane(paneId);
      if (!parent?.children?.length) return;

      const newPane = parent.children.find(c => !c.tabs || c.tabs.length === 0) || parent.children[1] || parent.children[0];
      if (newPane) {
        openTab(
          { name: activeTab.name, path: activeTab.path, content: (activeTab as any).content },
          { kind: 'preview', paneId: newPane.id, targetPaneId: newPane.id }
        );
      }
      return;
    }

    const other = leafPanes.filter(p => p.id !== paneId);
    if (other.length === 0) return;
    const emptyOther = other.find(p => !p.tabs || p.tabs.length === 0);
    const randomPane = emptyOther || other[Math.floor(Math.random() * other.length)];
    openTab(
      { name: activeTab.name, path: activeTab.path, content: (activeTab as any).content },
      { kind: 'preview', paneId: randomPane.id, targetPaneId: randomPane.id }
    );
  }, [paneId, activeTabId, tabs, panes]);

  // ペインリスト（タブ移動用）
  const flatPanes = flattenPanes(panes);
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

  // ドラッグ可能なタブコンポーネント
  function DraggableTab({ tab, tabIndex }: { tab: any; tabIndex: number }) {
    const isActive = tab.id === activeTabId;
    const isDuplicate = nameCount[tab.name] > 1;
    const displayName = isDuplicate ? `${tab.name} (${tab.path})` : tab.name;

    const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | null>(null);
    const dragOverSideRef = useRef<'left' | 'right' | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    // dragOverSideが変更されたらrefも更新
    useEffect(() => {
      dragOverSideRef.current = dragOverSide;
    }, [dragOverSide]);

    const [{ isDragging }, dragRef] = useDrag(
      () => ({
        type: DND_TAB,
        item: { type: DND_TAB, tabId: tab.id, fromPaneId: paneId, index: tabIndex, tabName: tab.name },
        collect: (monitor: any) => ({ isDragging: monitor.isDragging() }),
      }),
      [tab.id, paneId, tabIndex, tab.name]
    );

    const [{ isOver }, tabDrop] = useDrop(
      () => ({
        accept: DND_TAB,
        drop: (item: any, monitor: any) => {
          if (!item?.tabId) return;
          if (monitor && !monitor.isOver({ shallow: true })) return;
          if (item.tabId === tab.id) return;

          const fromPane = item.fromPaneId;
          let targetIndex = tabIndex;
          // refを使用して最新の値を取得
          if (dragOverSideRef.current === 'right') targetIndex = tabIndex + 1;

          try {
            moveTabToIndex(fromPane, paneId, item.tabId, targetIndex);
            item.fromPaneId = paneId;
            item.index = targetIndex;
          } catch (err) {
            // ignore
          }
          setDragOverSide(null);
        },
        hover: (item, monitor) => {
          if (!ref.current) return;
          if (!monitor.isOver({ shallow: true })) {
            setDragOverSide(null);
            return;
          }

          const rect = ref.current.getBoundingClientRect();
          const clientX = (monitor.getClientOffset() as any).x;
          const middleX = (rect.right - rect.left) / 2;
          const relativeX = clientX - rect.left;

          setDragOverSide(relativeX < middleX ? 'left' : 'right');
        },
        collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) }),
      }),
      [paneId, tabIndex, tab.id]
    );

    dragRef(tabDrop(ref));

    return (
      <div
        ref={ref}
        className={`h-full px-3 flex items-center gap-2 flex-shrink-0 border-r relative ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
        style={{
          background: isActive ? colors.background : colors.mutedBg,
          borderColor: colors.border,
          minWidth: '120px',
          maxWidth: '200px',
          opacity: isDragging ? 0.4 : 1,
        }}
        onClick={e => handleTabClick(e, tab.id)}
        onContextMenu={e => {
          if (ref.current) handleTabRightClick(e, tab.id, ref.current);
        }}
        onTouchStart={e => {
          if (ref.current) handleTouchStart(e, tab.id, ref.current);
        }}
        onTouchEnd={e => {
          if (ref.current) handleTouchEnd(e, tab.id, ref.current);
        }}
        onTouchMove={handleTouchMove}
      >
        {/* ドロップインジケーター */}
        {isOver && dragOverSide === 'left' && (
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: '2px',
            backgroundColor: colors.accentFg || '#007acc', zIndex: 10
          }} />
        )}
        {isOver && dragOverSide === 'right' && (
          <div style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: '2px',
            backgroundColor: colors.accentFg || '#007acc', zIndex: 10
          }} />
        )}

        <TabIcon kind={tab.kind} filename={tab.name} size={14} color={colors.foreground} />
        <span className="text-sm truncate flex-1" style={{ color: colors.foreground }} title={displayName}>
          {displayName}
        </span>

        {(tab as any).isDirty ? (
          <button
            data-close-button="true"
            className="hover:bg-accent rounded p-0.5 flex items-center justify-center"
            onClick={e => { e.stopPropagation(); handleTabClose(tab.id); }}
            title={t('tabBar.unsavedChanges')}
          >
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.foreground }} />
          </button>
        ) : (
          <button
            data-close-button="true"
            className="hover:bg-accent rounded p-0.5"
            onClick={e => { e.stopPropagation(); handleTabClose(tab.id); }}
          >
            <X size={14} color={colors.foreground} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="h-10 border-b flex items-center relative bg-muted border-border"
      style={{ background: colors.mutedBg, borderColor: colors.border }}
    >
      {/* ペインメニューボタン */}
      <div className="flex items-center h-full pl-2 pr-1 gap-1 relative">
        <button
          className="p-1 rounded focus:outline-none focus:ring-2"
          style={{ background: paneMenuOpen ? colors.accentBg : undefined }}
          onClick={() => setPaneMenuOpen(open => !open)}
          title={t('tabBar.paneMenu')}
          onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
          onMouseLeave={e => (e.currentTarget.style.background = paneMenuOpen ? colors.accentBg : '')}
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
              onClick={() => { setPaneMenuOpen(false); handleRemovePane(); }}
              title={t('tabBar.removePane')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Minus size={16} color={colors.red} />
              <span style={{ color: colors.foreground }}>{t('tabBar.removePane')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              onClick={() => { setPaneMenuOpen(false); splitPane(paneId, 'horizontal'); }}
              title={t('tabBar.splitVertical')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <SplitSquareVertical size={16} color={colors.accentFg} />
              <span style={{ color: colors.foreground }}>{t('tabBar.splitVertical')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              onClick={() => { setPaneMenuOpen(false); splitPane(paneId, 'vertical'); }}
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
              onClick={() => { setPaneMenuOpen(false); handleRemoveAllTabs(); }}
              title={t('tabBar.removeAllTabs')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Trash2 size={16} color={colors.red} />
              <span style={{ color: colors.foreground }}>{t('tabBar.removeAllTabs')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              onClick={() => { setPaneMenuOpen(false); window.dispatchEvent(new CustomEvent('pyxis-save-restart')); }}
              title={t('tabBar.saveRestart')}
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Save size={16} color={colors.primary} />
              <span style={{ color: colors.foreground }}>{t('tabBar.saveRestart')}</span>
            </button>
          </div>
        )}
      </div>

      {/* タブリスト */}
      <div
        className="flex items-center overflow-x-auto flex-1 select-none"
        ref={node => { if (node) containerDrop(node as any); }}
        onWheel={handleWheel}
      >
        {tabs.map((tab, tabIndex) => (
          <DraggableTab key={`${paneId}-${tabIndex}-${tab.id}`} tab={tab} tabIndex={tabIndex} />
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
          {tabs.find(t => t.id === tabContextMenu.tabId)?.name.toLowerCase().endsWith('.md') && (
            <button
              className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
              onClick={() => {
                const tab = tabs.find(t => t.id === tabContextMenu.tabId);
                if (tab) {
                  openTab(
                    { name: tab.name, path: tab.path, content: (tab as any).content },
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
              {availablePanes.filter(p => p.id !== paneId).map(p => (
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
function flattenPanes(panes: any[]): any[] {
  const result: any[] = [];
  const traverse = (panes: any[]) => {
    for (const pane of panes) {
      if (!pane.children || pane.children.length === 0) result.push(pane);
      if (pane.children) traverse(pane.children);
    }
  };
  traverse(panes);
  return result;
}
