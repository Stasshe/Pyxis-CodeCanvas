import { X, Plus, Menu, Trash2, Save, SplitSquareVertical, SplitSquareHorizontal, Minus } from 'lucide-react';
import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { useTabCloseConfirmation } from './useTabCloseConfirmation';
import { Tab } from '@/types';
import { FILE_CHANGE_EVENT } from '@/engine/fileWatcher';
import { useTheme } from '@/context/ThemeContext';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  isBottomPanelVisible: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onToggleBottomPanel: () => void;
  onAddTab?: () => void;
  removeEditorPane: () => void;
  toggleEditorLayout: () => void;
  editorLayout: string;
  editorId: string;
  removeAllTabs: () => void;
  // 新しく追加: タブをペイン間で移動する機能
  availablePanes?: Array<{ id: string; name: string }>;
  onMoveTabToPane?: (tabId: string, targetPaneId: string) => void;
  // ペイン分割機能
  onSplitPane?: (direction: 'vertical' | 'horizontal') => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onAddTab,
  removeEditorPane,
  editorId,
  removeAllTabs,
  availablePanes = [],
  onMoveTabToPane,
  onSplitPane,
}: TabBarProps) {
  const { colors } = useTheme();
  const { requestClose, ConfirmationDialog } = useTabCloseConfirmation();
  // メニューの開閉状態管理
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // メニューを閉じる関数
  const closeMenu = () => setMenuOpen(false);

  // タブコンテキストメニューの状態管理
  const [tabContextMenu, setTabContextMenu] = useState<{
    isOpen: boolean;
    tabId: string;
    x: number;
    y: number;
  }>({ isOpen: false, tabId: '', x: 0, y: 0 });
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  // メニュー外クリックで閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      // メニュー
      if (menuOpen && menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
      // タブコンテキストメニュー
      if (tabContextMenu.isOpen && tabContextMenuRef.current && !tabContextMenuRef.current.contains(event.target as Node)) {
        setTabContextMenu({ isOpen: false, tabId: '', x: 0, y: 0 });
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen, tabContextMenu.isOpen]);

  // 同名ファイルの重複チェック
  const nameCount: Record<string, number> = {};
  tabs.forEach(tab => {
    nameCount[tab.name] = (nameCount[tab.name] || 0) + 1;
  });

  // 保存再起動用: window.dispatchEventでカスタムイベントを発火
  const handleSaveRestart = () => {
    setMenuOpen(false);
    // カスタムイベントで保存再起動を通知
    window.dispatchEvent(new CustomEvent('pyxis-save-restart'));
  };

  // Ctrl+S で保存再起動
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveRestart();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // タブ右クリックハンドラ
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

  // タブ長押しハンドラ（iPad等）
  const handleTabLongPress = (e: React.TouchEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    setTabContextMenu({
      isOpen: true,
      tabId,
      x: touch.clientX,
      y: touch.clientY,
    });
  };

  // タブをペインに移動
  const handleMoveToPane = (tabId: string, targetPaneId: string) => {
    if (onMoveTabToPane) {
      onMoveTabToPane(tabId, targetPaneId);
    }
    setTabContextMenu({ isOpen: false, tabId: '', x: 0, y: 0 });
  };

  // ファイル削除イベントを受けて、該当ファイルのタブを閉じる
  useEffect(() => {
    const handleFileChange = (event: Event) => {
      const custom = event as CustomEvent<any>;
      const change = custom.detail;
      if (!change) return;
      if (change.type === 'delete') {
        const deletedPath: string = change.path;
        // 該当ファイルに対応するタブを全て閉じる
        const tabsToClose = tabs.filter(t => t.path === deletedPath || t.path === deletedPath);
        if (tabsToClose.length > 0) {
          // それぞれのタブを閉じる（onTabCloseに処理を委ねる）
          tabsToClose.forEach(t => {
            try {
              onTabClose(t.id);
            } catch (err) {
              console.error('[TabBar] Error closing tab for deleted file:', err);
            }
          });
        }
      }
    };

    window.addEventListener(FILE_CHANGE_EVENT, handleFileChange as EventListener);
    return () => {
      window.removeEventListener(FILE_CHANGE_EVENT, handleFileChange as EventListener);
    };
  }, [tabs, onTabClose]);

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
            boxShadow: menuOpen ? `0 2px 8px 0 ${colors.border}` : undefined,
          }}
          onClick={() => setMenuOpen(open => !open)}
          title="ペインメニュー"
          onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
          onMouseLeave={e => (e.currentTarget.style.background = menuOpen ? colors.accentBg : '')}
        >
          <Menu size={20} color={colors.accentFg} />
        </button>
        {/* メニュー表示 */}
        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute top-11 left-0 bg-card border border-border rounded-lg shadow-2xl z-20 min-w-[180px] py-2 px-1 flex flex-col gap-1"
            style={{
              background: colors.cardBg,
              borderColor: colors.border,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none',
              touchAction: 'manipulation',
            }}
          >
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: colors.red }}
              onClick={() => {
                closeMenu();
                removeEditorPane();
              }}
              title="ペイン削除"
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Minus size={16} color={colors.red} />
              <span style={{ color: colors.foreground }}>ペイン削除</span>
            </button>
            {onSplitPane && (
              <>
                <button
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
                  style={{ color: colors.accentFg }}
                  onClick={() => {
                    closeMenu();
                    onSplitPane('vertical');
                  }}
                  title="縦分割"
                  onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <SplitSquareVertical size={16} color={colors.accentFg} />
                  <span style={{ color: colors.foreground }}>縦分割</span>
                </button>
                <button
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
                  style={{ color: colors.accentFg }}
                  onClick={() => {
                    closeMenu();
                    onSplitPane('horizontal');
                  }}
                  title="横分割"
                  onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <SplitSquareHorizontal size={16} color={colors.accentFg} />
                  <span style={{ color: colors.foreground }}>横分割</span>
                </button>
              </>
            )}
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: colors.red }}
              onClick={() => {
                closeMenu();
                removeAllTabs();
              }}
              title="タブ全削除"
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Trash2 size={16} color={colors.red} />
              <span style={{ color: colors.foreground }}>タブ全削除</span>
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: colors.primary }}
              onClick={handleSaveRestart}
              title="保存再起動"
              onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <Save size={16} color={colors.primary} />
              <span style={{ color: colors.foreground }}>保存 & 再起動</span>
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center overflow-x-auto flex-1">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={clsx(
              'h-full flex items-center px-3 border-r cursor-pointer min-w-0 flex-shrink-0',
              tab.id === activeTabId ? 'tab-active' : 'tab-inactive'
            )}
            style={{
              borderRight: `1px solid ${colors.border}`,
              background: tab.id === activeTabId ? colors.cardBg : 'transparent',
              color: tab.id === activeTabId ? colors.foreground : colors.mutedFg,
            }}
            onClick={() => onTabClick(tab.id)}
            onContextMenu={e => handleTabRightClick(e, tab.id)}
            onTouchStart={e => {
              // 長押し検出のためのタイマー設定
              const timer = setTimeout(() => {
                handleTabLongPress(e, tab.id);
              }, 500); // 500msで長押し判定

              const handleTouchEnd = () => {
                clearTimeout(timer);
                document.removeEventListener('touchend', handleTouchEnd);
                document.removeEventListener('touchmove', handleTouchMove);
              };

              const handleTouchMove = () => {
                clearTimeout(timer);
                document.removeEventListener('touchend', handleTouchEnd);
                document.removeEventListener('touchmove', handleTouchMove);
              };

              document.addEventListener('touchend', handleTouchEnd);
              document.addEventListener('touchmove', handleTouchMove);
            }}
          >
            <span
              className="tab-label"
              style={{
                color: tab.isDirty ? colors.accent : colors.foreground,
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none',
                touchAction: 'manipulation',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
              }}
            >
              <span>
                {tab.preview && (
                  <span
                    style={{
                      fontSize: '0.7em',
                      opacity: 0.7,
                      marginRight: '4px',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      MozUserSelect: 'none',
                      msUserSelect: 'none',
                    }}
                  >
                    (Preview)
                  </span>
                )}
                {tab.aiReviewProps && (
                  <span
                    style={{
                      fontSize: '0.7em',
                      opacity: 0.7,
                      marginRight: '4px',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      MozUserSelect: 'none',
                      msUserSelect: 'none',
                    }}
                  >
                    🤖
                  </span>
                )}
                {tab.name}
              </span>
              {/* パス表示（同名ファイルが複数ある場合のみ） */}
              {nameCount[tab.name] > 1 && tab.path && (
                <span style={{ fontSize: '0.7em', opacity: 0.7, marginTop: '2px' }}>
                  {tab.path}
                </span>
              )}
            </span>
            {tab.isDirty && (
              <span
                className="ml-1 text-xs"
                style={{ color: colors.red }}
              >
                ●
              </span>
            )}
            <button
              className="ml-2 p-1 rounded hover:bg-accent"
              style={{ background: undefined }}
              onClick={e => {
                e.stopPropagation();
                requestClose(tab.id, tab.isDirty, onTabClose);
              }}
            >
              <X
                size={12}
                color={colors.mutedFg}
              />
            </button>
          </div>
        ))}
        <button
          className="h-full px-3 flex items-center justify-center flex-shrink-0 hover:bg-accent"
          style={{ background: undefined }}
          onClick={onAddTab}
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
          className="fixed bg-card border border-border rounded shadow-lg z-50 min-w-[150px] p-2"
          style={{
            background: colors.cardBg,
            borderColor: colors.border,
            left: `${tabContextMenu.x}px`,
            top: `${tabContextMenu.y}px`,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none',
            touchAction: 'manipulation',
          }}
        >
          <div className="text-xs text-muted-foreground mb-2 px-2">タブアクション</div>
          <button
            className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
            onClick={() => {
              const tab = tabs.find(t => t.id === tabContextMenu.tabId);
              if (tab) {
                requestClose(tab.id, tab.isDirty, onTabClose);
              }
              setTabContextMenu({ isOpen: false, tabId: '', x: 0, y: 0 });
            }}
          >
            タブを閉じる
          </button>

          {/* ペイン移動メニュー */}
          {availablePanes.length > 1 && (
            <>
              <div className="text-xs text-muted-foreground mt-3 mb-2 px-2">ペインに移動</div>
              {availablePanes
                .filter(pane => pane.id !== editorId) // 現在のペインは除外
                .map(pane => (
                  <button
                    key={pane.id}
                    className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
                    onClick={() => handleMoveToPane(tabContextMenu.tabId, pane.id)}
                  >
                    {pane.name}
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
