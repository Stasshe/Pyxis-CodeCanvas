import { FileText, Search, GitBranch, Settings, FolderOpen, Play } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import clsx from 'clsx';
import { MenuTab } from '../types';

interface MenuBarProps {
  activeMenuTab: MenuTab;
  onMenuTabClick: (tab: MenuTab) => void;
  onProjectClick: () => void;
  gitChangesCount?: number; // Git変更ファイル数
}

export default function MenuBar({ activeMenuTab, onMenuTabClick, onProjectClick, gitChangesCount = 0 }: MenuBarProps) {
  const { colors } = useTheme();
  return (
    <div style={{
      width: '3rem',
      background: colors.mutedBg,
      borderRight: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      height: '100vh', // 画面全体の高さに変更
    }}>
      {/* 上部のメニューボタン */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {['files', 'search', 'git', 'run', 'settings'].map(tab => {
          const Icon = tab === 'files' ? FileText
            : tab === 'search' ? Search
            : tab === 'git' ? GitBranch
            : tab === 'run' ? Play
            : Settings;
          const isActive = activeMenuTab === tab;
          return (
            <button
              key={tab}
              style={{
                height: '3rem',
                width: '3rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isActive ? colors.accentBg : 'transparent',
                color: isActive ? colors.accentFg : colors.sidebarIconFg,
                position: tab === 'git' ? 'relative' : undefined,
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={() => onMenuTabClick(tab as MenuTab)}
              title={tab === 'files' ? 'ファイル' : tab === 'search' ? '検索' : tab === 'git' ? 'Git' : tab === 'run' ? '実行' : '設定'}
            >
              <Icon size={20} />
              {tab === 'git' && gitChangesCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    right: '0.25rem',
                    bottom: '0.125rem',
                    background: colors.red,
                    color: 'white',
                    fontSize: '0.75rem',
                    borderRadius: '9999px',
                    minWidth: '16px',
                    height: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingLeft: '0.25rem',
                    paddingRight: '0.25rem',
                  }}
                >
                  {gitChangesCount > 99 ? '99+' : gitChangesCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* 伸縮領域 */}
      <div style={{ flex: 1, minHeight: 0 }}></div>
      {/* プロジェクトボタン（下部に固定、安全領域対応） */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderTop: `1px solid ${colors.border}`,
          paddingBottom: 'env(safe-area-inset-bottom, 1rem)',
        }}
      >
        <button
          style={{
            height: '3rem',
            width: '3rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: colors.sidebarIconFg,
            border: 'none',
            cursor: 'pointer',
            marginBottom: '1rem', // 追加余白
          }}
          onClick={onProjectClick}
          title="プロジェクト管理"
        >
          <FolderOpen size={20} />
        </button>
      </div>
    </div>
  );
}
