import { FileText, Search, GitBranch, Settings, FolderOpen, Play } from 'lucide-react';
import clsx from 'clsx';
import { MenuTab } from '../types';

interface MenuBarProps {
  activeMenuTab: MenuTab;
  onMenuTabClick: (tab: MenuTab) => void;
  onProjectClick: () => void;
  gitChangesCount?: number; // Git変更ファイル数
}

export default function MenuBar({ activeMenuTab, onMenuTabClick, onProjectClick, gitChangesCount = 0 }: MenuBarProps) {
  return (
    <div className="w-12 bg-muted border-r border-border flex flex-col flex-shrink-0 h-full">
      {/* 上部のメニューボタン */}
      <div className="flex flex-col">
        <button
          className={clsx(
            'h-12 w-12 flex items-center justify-center hover:bg-accent',
            activeMenuTab === 'files' && 'bg-accent text-primary'
          )}
          onClick={() => onMenuTabClick('files')}
          title="ファイル"
        >
          <FileText size={20} />
        </button>
        <button
          className={clsx(
            'h-12 w-12 flex items-center justify-center hover:bg-accent',
            activeMenuTab === 'search' && 'bg-accent text-primary'
          )}
          onClick={() => onMenuTabClick('search')}
          title="検索"
        >
          <Search size={20} />
        </button>
        <button
          className={clsx(
            'h-12 w-12 flex items-center justify-center hover:bg-accent relative',
            activeMenuTab === 'git' && 'bg-accent text-primary'
          )}
          onClick={() => onMenuTabClick('git')}
          title="Git"
        >
          <GitBranch size={20} />
          {gitChangesCount > 0 && (
            <span
              className="absolute"
              style={{
              right: '0.25rem',
              bottom: '0.125rem',
              background: '#ef4444', // bg-red-500
              color: 'white',
              fontSize: '0.75rem', // text-xs
              borderRadius: '9999px', // rounded-full
              minWidth: '16px',
              height: '1rem', // h-4
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              paddingLeft: '0.25rem', // px-1
              paddingRight: '0.25rem',
              }}
            >
              {gitChangesCount > 99 ? '99+' : gitChangesCount}
            </span>
          )}
        </button>
        <button
          className={clsx(
            'h-12 w-12 flex items-center justify-center hover:bg-accent',
            activeMenuTab === 'run' && 'bg-accent text-primary'
          )}
          onClick={() => onMenuTabClick('run')}
          title="実行"
        >
          <Play size={20} />
        </button>
        <button
          className={clsx(
            'h-12 w-12 flex items-center justify-center hover:bg-accent',
            activeMenuTab === 'settings' && 'bg-accent text-primary'
          )}
          onClick={() => onMenuTabClick('settings')}
          title="設定"
        >
          <Settings size={20} />
        </button>
      </div>
      
      {/* 伸縮領域 */}
      <div className="flex-1 min-h-0"></div>
      
      {/* プロジェクトボタン（下部に固定） */}
      <div className="flex flex-col border-t border-border">
        <button
          className="h-12 w-12 flex items-center justify-center hover:bg-accent"
          onClick={onProjectClick}
          title="プロジェクト管理"
        >
          <FolderOpen size={20} />
        </button>
      </div>
    </div>
  );
}
