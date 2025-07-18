import { useTheme } from '../context/ThemeContext';
import { FolderOpen } from 'lucide-react';
import { MenuTab, FileItem } from '../types';
import FileTree from './FileTree';
import SearchPanel from './SearchPanel';
import GitPanel from './GitPanel';
import RunPanel from './RunPanel';
import SettingsPanel from './SettingsPanel';
import type { Project } from '../types';

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
        style={{ 
          background: colors.cardBg,
          borderRight: `1px solid ${colors.border}`,
          width: `${leftSidebarWidth}px`,
          minWidth: `${leftSidebarWidth}px`,
          maxWidth: `${leftSidebarWidth}px`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div style={{
          height: '2rem',
          background: colors.mutedBg,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '0.75rem',
          paddingRight: '0.75rem',
        }}>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: colors.sidebarTitleFg,
          }}>
            {activeMenuTab === 'files' && 'エクスプローラー'}
            {activeMenuTab === 'search' && '検索'}
            {activeMenuTab === 'git' && 'ソース管理'}
            {activeMenuTab === 'run' && '実行'}
            {activeMenuTab === 'settings' && '設定'}
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {activeMenuTab === 'files' && (
            <div style={{ padding: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <FolderOpen size={14} color={colors.sidebarIconFg} />
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: colors.sidebarTitleFg }}>./</span>
              </div>
              <FileTree items={files} onFileOpen={onFileOpen} onFilePreview={onFilePreview} />
            </div>
          )}
          {activeMenuTab === 'search' && (
            <div style={{ height: '100%' }}>
              <SearchPanel files={files} onFileOpen={onFileOpen} />
            </div>
          )}
          {activeMenuTab === 'git' && (
            <div style={{ height: '100%' }}>
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
            <div style={{ height: '100%' }}>
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
        style={{ background: colors.sidebarResizerBg }}
        onMouseDown={onResize}
        onTouchStart={onResize}
      />
    </>
  );
}
