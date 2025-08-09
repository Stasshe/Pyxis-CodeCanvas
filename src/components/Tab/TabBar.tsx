import { X, Plus, Menu } from 'lucide-react';
import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { Tab } from '@/types';
import { useTheme } from '@/context/ThemeContext';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  isBottomPanelVisible: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onToggleBottomPanel: () => void;
  onAddTab?: () => void;
  addEditorPane: () => void;
  removeEditorPane: () => void;
  toggleEditorLayout: () => void;
  editorLayout: string;
  editorId: string;
  removeAllTabs: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  isBottomPanelVisible,
  onTabClick,
  onTabClose,
  onToggleBottomPanel,
  onAddTab,
  addEditorPane,
  removeEditorPane,
  toggleEditorLayout,
  editorLayout,
  editorId,
  removeAllTabs
}: TabBarProps) {
  const { colors } = useTheme();
  // メニューの開閉状態管理
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef < HTMLDivElement > (null);

  // メニュー外クリックで閉じる
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  // 同名ファイルの重複チェック
  const nameCount: Record<string, number> = {};
  tabs.forEach(tab => {
    nameCount[tab.name] = (nameCount[tab.name] || 0) + 1;
  });

  // repoName抽出（projects/{repoName}/以降を表示）
  function getDisplayPath(fullPath: string) {
    const idx = fullPath.indexOf('projects/');
    if (idx >= 0) {
      return fullPath.substring(idx + 'projects/'.length);
    }
    return fullPath;
  }

  // 保存再起動用: window.dispatchEventでカスタムイベントを発火
  const handleSaveRestart = () => {
    setMenuOpen(false);
    // カスタムイベントで保存再起動を通知
    window.dispatchEvent(new CustomEvent('pyxis-save-restart'));
  };

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
          className="p-1 rounded hover:bg-accent"
          style={{ background: undefined }}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Menu size={20} color={colors.accentFg} />
        </button>
        {/* メニュー表示 */}
        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute top-10 left-0 bg-card border border-border rounded shadow-lg z-10 min-w-[120px] p-2 flex flex-col gap-2"
            style={{
              background: colors.cardBg,
              borderColor: colors.border,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none',
              touchAction: 'manipulation'
            }}
          >
            <div className="flex gap-1 ml-2">
              <button className="px-2 py-1 text-xs bg-accent rounded" onClick={() => { setMenuOpen(false); addEditorPane(); }} title="ペイン追加">＋</button>
              <button className="px-2 py-1 text-xs bg-destructive rounded" onClick={() => { setMenuOpen(false); removeEditorPane(); }} title="ペイン削除">－</button>
              <button className="px-2 py-1 text-xs bg-muted rounded" onClick={() => { setMenuOpen(false); toggleEditorLayout(); }} title="分割方向切替">⇄</button>
              <button className="px-2 py-1 text-xs bg-warning rounded" onClick={() => { setMenuOpen(false); removeAllTabs(); }} title="タブ全削除">🗑️</button>
              <button className="px-2 py-1 text-xs bg-primary rounded" onClick={handleSaveRestart} title="保存再起動">💾</button>
            </div>
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
          >
            <span className="tab-label" style={{
              color: tab.isDirty ? colors.accent : colors.foreground,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none',
              touchAction: 'manipulation',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start'
            }}>
              <span>
                {tab.preview && (
                  <span style={{
                    fontSize: '0.7em',
                    opacity: 0.7,
                    marginRight: '4px',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    MozUserSelect: 'none',
                    msUserSelect: 'none'
                  }}>(Preview)</span>
                )}
                {tab.aiReviewProps && (
                  <span style={{
                    fontSize: '0.7em',
                    opacity: 0.7,
                    marginRight: '4px',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    MozUserSelect: 'none',
                    msUserSelect: 'none'
                  }}>🤖</span>
                )}
                {tab.name}
              </span>
              {/* パス表示（同名ファイルが複数ある場合のみ） */}
              {nameCount[tab.name] > 1 && tab.fullPath && (
                <span style={{ fontSize: '0.7em', opacity: 0.7, marginTop: '2px' }}>
                  {getDisplayPath(tab.fullPath)}
                </span>
              )}
            </span>
            {tab.isDirty && <span className="ml-1 text-xs" style={{ color: colors.red }}>●</span>}
            <button
              className="ml-2 p-1 rounded hover:bg-accent"
              style={{ background: undefined }}
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
            >
              <X size={12} color={colors.mutedFg} />
            </button>
          </div>
        ))}
        <button
          className="h-full px-3 flex items-center justify-center flex-shrink-0 hover:bg-accent"
          style={{ background: undefined }}
          onClick={onAddTab}
        >
          <Plus size={16} color={colors.accentFg} />
        </button>
      </div>
    </div>
  );
}
