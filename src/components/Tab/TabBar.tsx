// src/components/Tab/TabBar.tsx
'use client';
import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useTabContext } from '@/context/TabContext';
import { useTranslation } from '@/context/I18nContext';
import { useKeyBinding } from '@/hooks/useKeyBindings';
import { Menu, Plus, X, FileText, SplitSquareVertical, SplitSquareHorizontal } from 'lucide-react';
import { useTabCloseConfirmation } from './useTabCloseConfirmation';

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
  
  const {
    getPane,
    activateTab,
    closeTab,
    openTab,
    removePane,
    moveTab,
    splitPane,
    panes,
  } = useTabContext();

  const pane = getPane(paneId);
  if (!pane) return null;

  const tabs = pane.tabs;
  const activeTabId = pane.activeTabId;

  // メニューの開閉状態管理
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen, tabContextMenu.isOpen]);

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
    // TODO: ファイル選択モーダルを開く処理
    // とりあえずカスタムイベントを発火
    window.dispatchEvent(new CustomEvent('pyxis-open-file-selector', { detail: { paneId } }));
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

  // ショートカットキーの登録
  useKeyBinding(
    'newTab',
    () => {
      handleAddTab();
    },
    [paneId]
  );

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

  // ペインのリストを取得（タブ移動用）
  const flatPanes = flattenPanes(panes);
  const availablePanes = flatPanes.map((p, idx) => ({
    id: p.id,
    name: `Pane ${idx + 1}`,
  }));

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
            }}
          >
            {/* タブ管理ボタン */}
            <button
              className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
              onClick={() => {
                handleRemoveAllTabs();
                setMenuOpen(false);
              }}
            >
              {t('tabBar.closeAllTabs')}
            </button>
            <button
              className="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded"
              onClick={() => {
                handleRemovePane();
                setMenuOpen(false);
              }}
            >
              {t('tabBar.closePane')}
            </button>
            {/* 区切り線 */}
            <div className="h-px bg-border my-1" />
            {/* ペイン分割ボタン */}
            <button
              className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-accent rounded"
              onClick={() => {
                splitPane(paneId, 'horizontal');
                setMenuOpen(false);
              }}
              title={t('tabBar.splitVertical')}
            >
              <SplitSquareVertical size={16} color={colors.accentFg} />
              <span>{t('tabBar.splitVertical')}</span>
            </button>
            <button
              className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-accent rounded"
              onClick={() => {
                splitPane(paneId, 'vertical');
                setMenuOpen(false);
              }}
              title={t('tabBar.splitHorizontal')}
            >
              <SplitSquareHorizontal size={16} color={colors.accentFg} />
              <span>{t('tabBar.splitHorizontal')}</span>
            </button>


          </div>
        )}
      </div>

      {/* タブリスト */}
      <div className="flex items-center overflow-x-auto flex-1">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isDuplicate = nameCount[tab.name] > 1;
          const displayName = isDuplicate ? `${tab.name} (${tab.path})` : tab.name;

          return (
            <div
              key={tab.id}
              className="h-full px-3 flex items-center gap-2 cursor-pointer flex-shrink-0 border-r"
              style={{
                background: isActive ? colors.background : colors.mutedBg,
                borderColor: colors.border,
                minWidth: '120px',
                maxWidth: '200px',
              }}
              onClick={() => handleTabClick(tab.id)}
              onContextMenu={(e) => handleTabRightClick(e, tab.id)}
            >
              <FileText size={14} color={colors.fg} />
              <span
                className="text-sm truncate flex-1"
                style={{ color: colors.fg }}
                title={displayName}
              >
                {displayName}
              </span>
              {(tab as any).isDirty && (
                <span className="w-2 h-2 rounded-full bg-accent" />
              )}
              <button
                className="hover:bg-accent rounded p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTabClose(tab.id);
                }}
              >
                <X size={14} color={colors.fg} />
              </button>
            </div>
          );
        })}

        {/* 新しいタブを追加ボタン */}
        <button
          className="h-full px-3 flex items-center justify-center flex-shrink-0 hover:bg-accent"
          onClick={handleAddTab}
        >
          <Plus size={16} color={colors.accentFg} />
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
          }}
        >
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
