import { FolderOpen } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { MenuTab, FileItem } from '@/types';
import type { Project } from '@/types';
import FileTree from './FileTree';
import SearchPanel from './SearchPanel';
import GitPanel from './GitPanel';
import RunPanel from './RunPanel';
import SettingsPanel from './SettingsPanel';

interface LeftSidebarProps {
  activeMenuTab: MenuTab;
  leftSidebarWidth: number;
  files: FileItem[];
  currentProject: Project;
  onFileOpen: (file: FileItem) => void;
  onFilePreview?: (file: FileItem) => void;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  onGitRefresh?: () => void;
  gitRefreshTrigger?: number;
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string) => Promise<void>;
  onGitStatusChange?: (changesCount: number) => void; // Git変更状態のコールバック
}

export default function LeftSidebar({ 
  activeMenuTab, 
  leftSidebarWidth, 
  files, 
  currentProject,
  onFileOpen,
  onFilePreview,
  onResize,
  onGitRefresh,
  gitRefreshTrigger,
  onFileOperation,
  onGitStatusChange
}: LeftSidebarProps) {
  const { colors } = useTheme();
  return (
    <>
      <div 
        data-sidebar="left"
        className="flex flex-col flex-shrink-0"
        style={{ 
          background: colors.cardBg,
          borderRight: `1px solid ${colors.border}`,
          width: `${leftSidebarWidth}px`,
          minWidth: `${leftSidebarWidth}px`,
          maxWidth: `${leftSidebarWidth}px`,
        }}
      >
        <div className="h-8 flex items-center px-3" style={{ background: colors.mutedBg, borderBottom: `1px solid ${colors.border}` }}>
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: colors.sidebarTitleFg }}>
            {activeMenuTab === 'files' && 'エクスプローラー'}
            {activeMenuTab === 'search' && '検索'}
            {activeMenuTab === 'git' && 'ソース管理'}
            {activeMenuTab === 'run' && '実行'}
            {activeMenuTab === 'settings' && '設定'}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {activeMenuTab === 'files' && (
            <div className="p-2">
              <div className="flex items-center gap-2 mb-2">
                <FolderOpen size={14} color={colors.sidebarIconFg} />
                <span className="text-xs font-medium" style={{ color: colors.sidebarTitleFg }}>./</span>
              </div>
              <FileTree items={files} onFileOpen={onFileOpen} onFilePreview={onFilePreview} currentProjectName={currentProject?.name ?? ''} onFileOperation={onFileOperation} />
            </div>
          )}
          {activeMenuTab === 'search' && (
            <div className="h-full">
              <SearchPanel files={files} onFileOpen={onFileOpen} />
            </div>
          )}
          {activeMenuTab === 'git' && (
            <div className="h-full">
              <GitPanel 
                currentProject={currentProject.name} 
                onRefresh={onGitRefresh}
                gitRefreshTrigger={gitRefreshTrigger}
                onFileOperation={onFileOperation}
                onGitStatusChange={onGitStatusChange}
              />
            </div>
          )}
          {activeMenuTab === 'run' && (
            <div className="h-full">
              <RunPanel 
                currentProject={currentProject.name}
                files={files}
                onFileOperation={onFileOperation}
              />
            </div>
          )}
          {activeMenuTab === 'settings' && (
            <SettingsPanel currentProject={currentProject} />
          )}
        </div>
      </div>
      {/* Resizer */}
      <div
        className="resizer resizer-vertical flex-shrink-0"
        // styleは既存のまま。ドラッグ・タップ時の青色はCSS/tailwindで維持
        onMouseDown={onResize}
        onTouchStart={onResize}
      />
    </>
  );
}
