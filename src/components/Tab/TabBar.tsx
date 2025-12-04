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
  MoreVertical,
} from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';
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

/**
 * TabBar: 完全に自律的なタブバーコンポーネント
 * - page.tsxからのpropsは不要
 * - TabContextを通じて直接タブ操作
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

  // メニューの開閉状態管理
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // メニューを閉じるヘルパー
  const closeMenu = () => setMenuOpen(false);

  // タブコンテキストメニューの状態管理
  const [tabContextMenu, setTabContextMenu] = useState<{
    isOpen: boolean;
    tabId: string;
    x: number;
    y: number;
  }>({ isOpen: false, tabId: '', x: 0, y: 0 });
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  // メニュー外クリック/タッチで閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (
        tabContextMenu.isOpen &&
        tabContextMenuRef.current &&
        !tabContextMenuRef.current.contains(event.target as Node)
      ) {
        setTabContextMenu({ isOpen: false, tabId: '', x: 0, y: 0 });
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [menuOpen, tabContextMenu.isOpen]);

  // タッチタイマーのクリーンアップ
  useEffect(() => {
    return () => {
      if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
      }
    };
  }, []);

  // 同名ファイルの重複チェック
  const nameCount: Record<string, number> = {};
  tabs.forEach(tab => {
    nameCount[tab.name] = (nameCount[tab.name] || 0) + 1;
  });

  // タブクリックハンドラ
  const handleTabClick = (tabId: string) => {
    activateTab(paneId, tabId);
  };

  // タブ閉じるハンドラ
  const handleTabClose = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      requestClose(tabId, (tab as any).isDirty || false, () => closeTab(paneId, tabId));
    }
  };

  // 新しいタブを追加（ファイル選択モーダルを開く）
  const handleAddTab = () => {
    openFileSelector(paneId);
  };

  // ペインを削除
  const handleRemovePane = () => {
    // ペインが1つだけなら削除しない
    const flatPanes = flattenPanes(panes);
    if (flatPanes.length <= 1) return;
    removePane(paneId);
  };

  // 全タブを閉じる
  const handleRemoveAllTabs = () => {
    tabs.forEach(tab => closeTab(paneId, tab.id));
  };

  // タブをペインに移動
  const handleMoveTabToPane = (tabId: string, targetPaneId: string) => {
    moveTab(paneId, targetPaneId, tabId);
    setTabContextMenu({ isOpen: false, tabId: '', x: 0, y: 0 });
  };

  // タブ右クリックハンドラ（デスクトップ用）
  const handleTabRightClick = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({
      isOpen: true,
      tabId,
      x: e.clientX,
      y: e.clientY,
    });
  };

  // タッチデバイス用: タップで右クリックメニューを表示（長押しではなく）
  // タブの選択は通常のクリックで行い、タップ後の小さなボタンでコンテキストメニューを開く
  const touchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // 長押しはもう使わないが、D&D用に残す
  const handleTouchStart = (_e: React.TouchEvent, _tabId: string) => {
    // タップでコンテキストメニューは開かない（右クリック操作と専用ボタンに任せる）
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  };

  const handleTouchMove = () => {
    // タッチ移動時はキャンセル
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  // ショートカットキーの登録
  useKeyBinding(
    'newTab',
    () => {
      handleAddTab();
    },
    [paneId]
  );

  // 個々のタブを分離したコンポーネントにして、そこにhooksを置く
  function DraggableTab({
    tab,
    tabIndex,
  }: {
    tab: any;
    tabIndex: number;
  }) {
    const isActive = tab.id === activeTabId;
    const isDuplicate = nameCount[tab.name] > 1;
    const displayName = isDuplicate ? `${tab.name} (${tab.path})` : tab.name;

    const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    // Drag source
    const [{ isDragging }, dragRef] = useDrag(
      () => ({
        type: DND_TAB,
        item: { type: DND_TAB, tabId: tab.id, fromPaneId: paneId, index: tabIndex },
        collect: (monitor: any) => ({
          isDragging: monitor.isDragging(),
        }),
      }),
      [tab.id, paneId, tabIndex]
    );

    // Drop target on each tab
    const [{ isOver }, tabDrop] = useDrop(
      () => ({
        accept: DND_TAB,
        drop: (item: any, monitor: any) => {
          if (!item || !item.tabId) return;
          if (monitor && typeof monitor.isOver === 'function' && !monitor.isOver({ shallow: true })) return;
          
          const fromPane = item.fromPaneId;
          const draggedId = item.tabId;
          
          // Calculate target index based on side
          let targetIndex = tabIndex;
          if (dragOverSide === 'right') {
            targetIndex = tabIndex + 1;
          }
          
          // Adjust index if moving within same pane and target is after source
          // (This logic is usually handled by the store or array splice logic, but let's be safe)
          // Actually, moveTabToIndex usually handles "insert at index".
          
          if (draggedId === tab.id) return;

          try {
            // @ts-ignore
            moveTabToIndex(fromPane, paneId, draggedId, targetIndex);
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
            
            const hoverBoundingRect = ref.current.getBoundingClientRect();
            const hoverClientX = (monitor.getClientOffset() as any).x;
            const hoverClientY = (monitor.getClientOffset() as any).y;
            
            const hoverMiddleX = (hoverBoundingRect.right - hoverBoundingRect.left) / 2;
            const hoverClientXRelative = hoverClientX - hoverBoundingRect.left;
            
            if (hoverClientXRelative < hoverMiddleX) {
                setDragOverSide('left');
            } else {
                setDragOverSide('right');
            }
        },
        collect: (monitor) => ({
            isOver: monitor.isOver({ shallow: true }),
        }),
      }),
      [paneId, tabIndex, dragOverSide]
    );

    const opacity = isDragging ? 0.4 : 1;

    // Connect refs
    dragRef(tabDrop(ref));

    // コンテキストメニューを開くボタンのクリックハンドラ
    const handleContextMenuButton = (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setTabContextMenu({
        isOpen: true,
        tabId: tab.id,
        x: rect.left,
        y: rect.bottom + 4,
      });
    };

    return (
      <div
        key={tab.id}
        ref={ref}
        className={`h-full px-3 flex items-center gap-2 flex-shrink-0 border-r relative ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          background: isActive ? colors.background : colors.mutedBg,
          borderColor: colors.border,
          minWidth: '120px',
          maxWidth: '200px',
          opacity,
        }}
        onClick={() => handleTabClick(tab.id)}
        onContextMenu={e => handleTabRightClick(e, tab.id)}
        onTouchStart={e => handleTouchStart(e, tab.id)}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        {/* Insertion Indicator */}
        {isOver && dragOverSide === 'left' && (
            <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '2px',
                backgroundColor: colors.accentFg || '#007acc',
                zIndex: 10
            }} />
        )}
        {isOver && dragOverSide === 'right' && (
            <div style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: '2px',
                backgroundColor: colors.accentFg || '#007acc',
                zIndex: 10
            }} />
        )}

        <TabIcon kind={tab.kind} filename={tab.name} size={14} color={colors.foreground} />
        <span className="text-sm truncate flex-1" style={{ color: colors.foreground }} title={displayName}>
          {displayName}
        </span>
        
        {/* コンテキストメニューボタン (タッチデバイス/デスクトップ共通) */}
        <button
          className="hover:bg-accent rounded p-0.5 flex items-center justify-center"
          onClick={handleContextMenuButton}
          onTouchEnd={handleContextMenuButton}
          title={t('tabBar.moreActions') || 'More actions'}
        >
          <MoreVertical size={14} color={colors.foreground} />
        </button>
        
        {(tab as any).isDirty ? (
          <button
            className="hover:bg-accent rounded p-0.5 flex items-center justify-center"
            onClick={e => {
              e.stopPropagation();
              handleTabClose(tab.id);
            }}
            title={t('tabBar.unsavedChanges')}
          >
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.foreground }} />
          </button>
        ) : (
          <button
            className="hover:bg-accent rounded p-0.5"
            onClick={e => {
              e.stopPropagation();
              handleTabClose(tab.id);
            }}
          >
            <X size={14} color={colors.foreground} />
          </button>
        )}
      </div>
    );
  }

  useKeyBinding(
    'closeTab',
    () => {
      if (activeTabId) {
        handleTabClose(activeTabId);
      }
    },
    [activeTabId, paneId]
  );

  useKeyBinding(
    'removeAllTabs',
    () => {
      handleRemoveAllTabs();
    },
    [tabs, paneId]
  );

  useKeyBinding(
    'nextTab',
    () => {
      if (tabs.length === 0) return;
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      const nextIndex = (currentIndex + 1) % tabs.length;
      activateTab(paneId, tabs[nextIndex].id);
    },
    [tabs, activeTabId, paneId]
  );

  useKeyBinding(
    'prevTab',
    () => {
      if (tabs.length === 0) return;
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      activateTab(paneId, tabs[prevIndex].id);
    },
    [tabs, activeTabId, paneId]
  );

  // Markdown を現在開いているタブのプレビューを別のペインで開く
  useKeyBinding(
    'openMdPreview',
    () => {
      // アクティブなペインのみ処理する
      if (useTabStore.getState().activePane !== paneId) return;

      const activeTab = tabs.find(t => t.id === activeTabId);
      if (!activeTab) return;

      const name = activeTab.name || '';
      const ext = name.split('.').pop()?.toLowerCase() || '';
      if (!(ext === 'md' || ext === 'mdx')) return;

      const leafPanes = flattenPanes(panes);

      // 1つだけのペインなら、横に分割してプレビューを開く
      if (leafPanes.length === 1) {
        // ここでは横幅（side-by-side）に追加するために 'vertical' を指定
        splitPane(paneId, 'vertical');

        // splitPaneは同期的にストアを更新するため、直後に取得して子ペインを探索する
        const parent = getPane(paneId);
        if (!parent || !parent.children || parent.children.length === 0) return;

        // 空のタブリストを持つ子ペインを新規作成ペインとして想定
        let newPane = parent.children.find(c => !c.tabs || c.tabs.length === 0);
        if (!newPane) {
          // フォールバックとして二番目の子を採用
          newPane = parent.children[1] || parent.children[0];
        }

        if (newPane) {
          openTab(
            { name: activeTab.name, path: activeTab.path, content: (activeTab as any).content },
            { kind: 'preview', paneId: newPane.id, targetPaneId: newPane.id }
          );
        }
        return;
      }

      // 複数ペインの場合は、自分以外のペインのうちランダムなペインで開く
      const other = leafPanes.filter(p => p.id !== paneId);
      if (other.length === 0) return;
      // Prefer an empty pane if available for preview; else random
      const emptyOther = other.find(p => !p.tabs || p.tabs.length === 0);
      const randomPane = emptyOther || other[Math.floor(Math.random() * other.length)];
      openTab(
        { name: activeTab.name, path: activeTab.path, content: (activeTab as any).content },
        { kind: 'preview', paneId: randomPane.id, targetPaneId: randomPane.id }
      );
    },
    [paneId, activeTabId, tabs, panes]
  );

  // ペインのリストを取得（タブ移動用）
  const flatPanes = flattenPanes(panes);
  const availablePanes = flatPanes.map((p, idx) => ({
    id: p.id,
    name: `Pane ${idx + 1}`,
  }));

  // タブリストのコンテナ参照とホイールハンドラ（縦スクロールを横スクロールに変換）
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // 主に縦スクロールを横スクロールに変換する
    // （タッチパッドやマウスホイールで縦方向の入力が来たときに横にスクロールする）
    try {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // deltaY を横方向に適用
        (e.currentTarget as HTMLDivElement).scrollBy({ left: e.deltaY, behavior: 'auto' });
        e.preventDefault();
      }
    } catch (err) {
      // 万が一のためフォールバックとして直接調整
      (e.currentTarget as HTMLDivElement).scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  // コンテナ自体もドロップ可能（末尾に追加）
  const [, containerDrop] = useDrop(
    () => ({
      accept: DND_TAB,
      drop: (item: any, monitor: any) => {
        if (!item || !item.tabId) return;
        // ドロップ先はこのペインの末尾
        if (item.fromPaneId === paneId) return; // 同じペインであれば無視（個別タブ上で処理）
        moveTab(item.fromPaneId, paneId, item.tabId);
      },
    }),
    [paneId]
  );

  return (
    <div
      className="h-10 border-b flex items-center relative bg-muted border-border"
      style={{
        background: colors.mutedBg,
        borderColor: colors.border,
      }}
    >
      {/* メニューボタン */}
      <div className="flex items-center h-full pl-2 pr-1 gap-1 relative">
        <button
          className="p-1 rounded focus:outline-none focus:ring-2"
          style={{
            background: menuOpen ? colors.accentBg : undefined,
          }}
          onClick={() => setMenuOpen(open => !open)}
          title={t('tabBar.paneMenu')}
          onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
          onMouseLeave={e => (e.currentTarget.style.background = menuOpen ? colors.accentBg : '')}
        >
          <Menu
            size={20}
            color={colors.accentFg}
          />
        </button>

        {/* メニュー表示 */}
        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute top-11 left-0 bg-card border border-border rounded-lg shadow-2xl z-20 min-w-[180px] py-2 px-1 flex flex-col gap-1"
            style={{
              background: colors.cardBg,
              borderColor: colors.border,
            }}
          >
            {/* タブ管理ボタン (dev ブランチに合わせた見た目/順序) */}
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: colors.red }}
              onClick={() => {
                closeMenu();
                handleRemovePane();
              }}
              title={t('tabBar.removePane')}
              onMouseEnter={e => (e.currentTarget.style.background = (colors as any).accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Minus
                size={16}
                color={(colors as any).red}
              />
              <span style={{ color: (colors as any).foreground }}>{t('tabBar.removePane')}</span>
            </button>
            {/* ペイン分割 (dev と同じスタイルと順序) */}
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: colors.accentFg }}
              onClick={() => {
                closeMenu();
                splitPane(paneId, 'horizontal');
              }}
              title={t('tabBar.splitVertical')}
              onMouseEnter={e => (e.currentTarget.style.background = (colors as any).accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <SplitSquareVertical
                size={16}
                color={colors.accentFg}
              />
              <span style={{ color: (colors as any).foreground }}>{t('tabBar.splitVertical')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: colors.accentFg }}
              onClick={() => {
                closeMenu();
                splitPane(paneId, 'vertical');
              }}
              title={t('tabBar.splitHorizontal')}
              onMouseEnter={e => (e.currentTarget.style.background = (colors as any).accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <SplitSquareHorizontal
                size={16}
                color={colors.accentFg}
              />
              <span style={{ color: (colors as any).foreground }}>
                {t('tabBar.splitHorizontal')}
              </span>
            </button>
            {/* 区切り線 */}
            <div className="h-px bg-border my-1" />
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: (colors as any).red }}
              onClick={() => {
                closeMenu();
                handleRemoveAllTabs();
              }}
              title={t('tabBar.removeAllTabs')}
              onMouseEnter={e => (e.currentTarget.style.background = (colors as any).accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Trash2
                size={16}
                color={(colors as any).red}
              />
              <span style={{ color: (colors as any).foreground }}>{t('tabBar.removeAllTabs')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: (colors as any).primary }}
              onClick={() => {
                closeMenu();
                // 保存して再起動 (dev に合わせる)
                window.dispatchEvent(new CustomEvent('pyxis-save-restart'));
              }}
              title={t('tabBar.saveRestart')}
              onMouseEnter={e => (e.currentTarget.style.background = (colors as any).accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Save
                size={16}
                color={(colors as any).primary}
              />
              <span style={{ color: (colors as any).foreground }}>{t('tabBar.saveRestart')}</span>
            </button>
          </div>
        )}
      </div>

      {/* タブリスト */}
      <div
        className="flex items-center overflow-x-auto flex-1 select-none"
        ref={node => {
          tabsContainerRef.current = node;
          // container にドロップリファレンスを繋ぐ
          if (node) containerDrop(node as any);
        }}
        onWheel={handleWheel}
      >
        {tabs.map((tab, tabIndex) => (
          <DraggableTab key={`${paneId}-${tabIndex}-${tab.id}`} tab={tab} tabIndex={tabIndex} />
        ))}

        {/* 新しいタブを追加ボタン */}
        <button
          className="h-full px-3 flex items-center justify-center flex-shrink-0 hover:bg-accent"
          onClick={handleAddTab}
        >
          <Plus
            size={16}
            color={colors.accentFg}
          />
        </button>
      </div>

      {/* タブコンテキストメニュー */}
      {tabContextMenu.isOpen && (
        <div
          ref={tabContextMenuRef}
          className="fixed bg-card border border-border rounded shadow-lg z-50 min-w-[150px] p-2 select-none"
          style={{
            background: colors.cardBg,
            borderColor: colors.border,
            left: `${tabContextMenu.x}px`,
            top: `${tabContextMenu.y}px`,
          }}
        >
          {/* mdファイルの場合、プレビューを開くボタンを表示 */}
          {(() => {
            const tab = tabs.find(t => t.id === tabContextMenu.tabId);
            const isMdFile = tab?.name.toLowerCase().endsWith('.md');
            return (
              isMdFile && (
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
                    setTabContextMenu({ isOpen: false, tabId: '', x: 0, y: 0 });
                  }}
                >
                  {t('tabBar.openPreview')}
                </button>
              )
            );
          })()}

          <button
            className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
            onClick={() => {
              handleTabClose(tabContextMenu.tabId);
              setTabContextMenu({ isOpen: false, tabId: '', x: 0, y: 0 });
            }}
          >
            {t('tabBar.closeTab')}
          </button>

          {/* ペイン移動メニュー */}
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

// ペインをフラット化するヘルパー関数
function flattenPanes(panes: any[]): any[] {
  const result: any[] = [];
  const traverse = (panes: any[]) => {
    for (const pane of panes) {
      if (!pane.children || pane.children.length === 0) {
        result.push(pane);
      }
      if (pane.children) {
        traverse(pane.children);
      }
    }
  };
  traverse(panes);
  return result;
}
