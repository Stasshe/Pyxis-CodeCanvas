import { FolderOpen, FilePlus, FolderPlus } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';
import { MenuTab, FileItem } from '@/types';
import type { Project } from '@/types';
import FileTree from './FileTree';
import SearchPanel from './SearchPanel';
import GitPanel from './GitPanel';
import RunPanel from './RunPanel';
import SettingsPanel from './SettingsPanel';
import { fileRepository } from '@/engine/core/fileRepository';

interface LeftSidebarProps {
  activeMenuTab: MenuTab;
  leftSidebarWidth: number;
  files: FileItem[];
  currentProject: Project;
  onFileOpen: (file: FileItem) => void;
  onFilePreview?: (file: FileItem) => void;
  onWebPreview?: (file: FileItem) => void;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  onGitRefresh?: () => void;
  gitRefreshTrigger?: number;
  onRefresh?: () => void; // [NEW ARCHITECTURE] ファイルツリー再読み込み用
  onGitStatusChange?: (changesCount: number) => void;
  onDiffFileClick?: (params: { commitId: string; filePath: string; editable?: boolean }) => void;
  onDiffAllFilesClick?: (params: { commitId: string; parentCommitId: string }) => void;
}

export default function LeftSidebar({
  activeMenuTab,
  leftSidebarWidth,
  files,
  currentProject,
  onFileOpen,
  onFilePreview,
  onWebPreview,
  onResize,
  onGitRefresh,
  gitRefreshTrigger,
  onRefresh,
  onGitStatusChange,
  onDiffFileClick,
  onDiffAllFilesClick,
}: LeftSidebarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

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
        <div
          className="h-8 flex items-center px-3"
          style={{ background: colors.mutedBg, borderBottom: `1px solid ${colors.border}` }}
        >
          <span
            className="text-xs font-medium uppercase tracking-wide select-none"
            style={{ color: colors.sidebarTitleFg }}
          >
            {activeMenuTab === 'files' && 'エクスプローラー'}
            {activeMenuTab === 'search' && '検索'}
            {activeMenuTab === 'git' && 'ソース管理'}
            {activeMenuTab === 'run' && '実行'}
            {activeMenuTab === 'settings' && '設定'}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {activeMenuTab === 'files' && (
            <div className="p-2 select-none">
              <div className="flex items-center gap-2 mb-2">
                <FolderOpen
                  size={14}
                  color={colors.sidebarIconFg}
                />
                <span
                  className="text-xs font-medium"
                  style={{ color: colors.sidebarTitleFg }}
                >
                  ./
                </span>
                {/* [NEW ARCHITECTURE] 新規ファイル作成 - fileRepository直接呼び出し */}
                <button
                  title={t('leftSidebar.createFile')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onClick={async () => {
                    const fileName = prompt('新しいファイル名を入力してください:');
                    if (fileName && currentProject?.id) {
                      const newFilePath = fileName.startsWith('/') ? fileName : '/' + fileName;
                      await fileRepository.createFile(currentProject.id, newFilePath, '', 'file');
                      if (onRefresh) setTimeout(onRefresh, 100);
                    }
                  }}
                >
                  <FilePlus
                    size={16}
                    color={colors.sidebarIconFg}
                  />
                </button>
                {/* [NEW ARCHITECTURE] 新規フォルダ作成 - fileRepository直接呼び出し */}
                <button
                  title={t('leftSidebar.createFolder')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onClick={async () => {
                    const folderName = prompt('新しいフォルダ名を入力してください:');
                    if (folderName && currentProject?.id) {
                      const newFolderPath = folderName.startsWith('/')
                        ? folderName
                        : '/' + folderName;
                      await fileRepository.createFile(
                        currentProject.id,
                        newFolderPath,
                        '',
                        'folder'
                      );
                      if (onRefresh) setTimeout(onRefresh, 100);
                    }
                  }}
                >
                  <FolderPlus
                    size={16}
                    color={colors.sidebarIconFg}
                  />
                </button>
              </div>
              <FileTree
                items={files}
                onFileOpen={onFileOpen}
                onFilePreview={onFilePreview}
                onWebPreview={onWebPreview}
                currentProjectName={currentProject?.name ?? ''}
                currentProjectId={currentProject?.id ?? ''}
                onRefresh={onRefresh}
              />
            </div>
          )}
          {activeMenuTab === 'search' && (
            <div className="h-full">
              <SearchPanel
                files={files}
                projectId={currentProject.id}
                onFileOpen={onFileOpen}
              />
            </div>
          )}
          {activeMenuTab === 'git' && (
            <div className="h-full">
              <GitPanel
                currentProject={currentProject.name}
                currentProjectId={currentProject.id}
                onRefresh={onGitRefresh}
                gitRefreshTrigger={gitRefreshTrigger}
                onGitStatusChange={onGitStatusChange}
                onDiffFileClick={onDiffFileClick}
                onDiffAllFilesClick={onDiffAllFilesClick}
              />
            </div>
          )}
          {activeMenuTab === 'run' && (
            <div className="h-full">
              <RunPanel
                currentProject={currentProject}
                files={files}
              />
            </div>
          )}
          {activeMenuTab === 'settings' && <SettingsPanel currentProject={currentProject} />}
        </div>
      </div>
      {/* Resizer */}
      <div
        className="resizer resizer-vertical flex-shrink-0"
        style={{
          background: colors.sidebarResizerBg,
          cursor: 'row-resize',
        }}
        onMouseDown={onResize}
        onTouchStart={onResize}
      />
    </>
  );
}
