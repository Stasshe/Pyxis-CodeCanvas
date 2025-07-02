import { FolderOpen } from 'lucide-react';
import { MenuTab, FileItem } from '../types';
import FileTree from './FileTree';
import SearchPanel from './SearchPanel';
import GitPanel from './GitPanel';

interface LeftSidebarProps {
  activeMenuTab: MenuTab;
  leftSidebarWidth: number;
  files: FileItem[];
  currentProject?: string;
  onFileOpen: (file: FileItem) => void;
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
  onResize,
  onGitRefresh,
  gitRefreshTrigger,
  onFileOperation,
  onGitStatusChange
}: LeftSidebarProps) {
  return (
    <>
      <div 
        data-sidebar="left"
        className="bg-card border-r border-border flex flex-col flex-shrink-0"
        style={{ 
          width: `${leftSidebarWidth}px`,
          minWidth: `${leftSidebarWidth}px`,
          maxWidth: `${leftSidebarWidth}px`,
        }}
      >
        <div className="h-8 bg-muted border-b border-border flex items-center px-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {activeMenuTab === 'files' && 'エクスプローラー'}
            {activeMenuTab === 'search' && '検索'}
            {activeMenuTab === 'git' && 'ソース管理'}
            {activeMenuTab === 'settings' && '設定'}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {activeMenuTab === 'files' && (
            <div className="p-2">
              <div className="flex items-center gap-2 mb-2">
                <FolderOpen size={14} />
                <span className="text-xs font-medium">./</span>
              </div>
              <FileTree items={files} onFileOpen={onFileOpen} />
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
                currentProject={currentProject} 
                onRefresh={onGitRefresh}
                gitRefreshTrigger={gitRefreshTrigger}
                onFileOperation={onFileOperation}
                onGitStatusChange={onGitStatusChange}
              />
            </div>
          )}
          {activeMenuTab === 'settings' && (
            <div className="p-4">
              <p className="text-sm text-muted-foreground">設定画面は準備中です</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Resizer */}
      <div
        className="resizer resizer-vertical flex-shrink-0"
        onMouseDown={onResize}
        onTouchStart={onResize}
      />
    </>
  );
}
