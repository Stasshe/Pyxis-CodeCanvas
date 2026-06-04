import { FilePlus, FolderOpen, FolderPlus } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { fileRepository } from '@/engine/core/fileRepository';
import { useExtensionPanels } from '@/hooks/ui/useExtensionPanels';
import type { FileItem, MenuTab, Project } from '@/types';
import FileTree from './FileTree';

const ExtensionPanelRenderer = lazy(() => import('./ExtensionPanelRenderer'));
const ExtensionsPanel = lazy(() => import('./ExtensionsPanel'));
const GitPanel = lazy(() => import('./GitPanel'));
const RunPanel = lazy(() => import('./RunPanel'));
const SearchPanel = lazy(() => import('./SearchPanel'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));

interface LeftSidebarProps {
  activeMenuTab: MenuTab;
  leftSidebarWidth: number;
  files: FileItem[];
  currentProject: Project;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  onGitRefresh?: () => void;
  onRefresh?: () => void; // ファイルツリー再読み込み用
  onGitStatusChange?: (changesCount: number) => void;
}

export default function LeftSidebar({
  activeMenuTab,
  leftSidebarWidth,
  files,
  currentProject,
  onResize,
  onGitRefresh,
  onRefresh,
  onGitStatusChange,
}: LeftSidebarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const extensionPanels = useExtensionPanels();

  // 拡張パネルがアクティブかチェック
  const activeExtensionPanel = extensionPanels.find(
    panel => `extension:${panel.extensionId}.${panel.panelId}` === activeMenuTab
  );

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
            {activeMenuTab === 'files' && 'Explorer'}
            {activeMenuTab === 'search' && 'Search'}
            {activeMenuTab === 'git' && 'Git'}
            {activeMenuTab === 'run' && 'Run'}
            {activeMenuTab === 'extensions' && 'Extensions'}
            {activeMenuTab === 'settings' && 'Settings'}
            {activeExtensionPanel?.title}
          </span>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeMenuTab === 'files' && (
            <div className="flex-1 flex flex-col select-none overflow-hidden">
              {/* Fixed header with file creation icons - does not scroll */}
              <div
                className="flex items-center gap-2 p-2 flex-shrink-0"
                style={{
                  background: colors.cardBg,
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                <FolderOpen size={14} color={colors.sidebarIconFg} />
                <span className="text-xs font-medium" style={{ color: colors.sidebarTitleFg }}>
                  ./
                </span>
                {/* 新規ファイル作成 - fileRepository直接呼び出し */}
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
                      const newFilePath = fileName.startsWith('/') ? fileName : `/${fileName}`;
                      await fileRepository.createFile(currentProject.id, newFilePath, '', 'file');
                      if (onRefresh) setTimeout(onRefresh, 100);
                    }
                  }}
                >
                  <FilePlus size={16} color={colors.sidebarIconFg} />
                </button>
                {/* 新規フォルダ作成 - fileRepository直接呼び出し */}
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
                        : `/${folderName}`;
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
                  <FolderPlus size={16} color={colors.sidebarIconFg} />
                </button>
              </div>
              {/* Virtualized file tree - scrolls independently */}
              <div className="flex-1 overflow-hidden">
                <FileTree
                  items={files}
                  currentProjectName={currentProject?.name ?? ''}
                  currentProjectId={currentProject?.id ?? ''}
                  onRefresh={onRefresh}
                />
              </div>
            </div>
          )}
          {activeMenuTab === 'search' && (
            <div className="h-full">
              <Suspense fallback={null}>
                <SearchPanel files={files} projectId={currentProject.id} />
              </Suspense>
            </div>
          )}
          {activeMenuTab === 'git' && (
            <div className="h-full">
              <Suspense fallback={null}>
                <GitPanel
                  currentProject={currentProject.name}
                  currentProjectId={currentProject.id}
                  onRefresh={onGitRefresh}
                  onGitStatusChange={onGitStatusChange}
                />
              </Suspense>
            </div>
          )}
          {activeMenuTab === 'run' && (
            <div className="h-full">
              <Suspense fallback={null}>
                <RunPanel currentProject={currentProject} files={files} />
              </Suspense>
            </div>
          )}
          {activeMenuTab === 'extensions' && (
            <div className="h-full">
              <Suspense fallback={null}>
                <ExtensionsPanel />
              </Suspense>
            </div>
          )}
          {activeMenuTab === 'settings' && (
            <Suspense fallback={null}>
              <SettingsPanel currentProject={currentProject} />
            </Suspense>
          )}
          {/* 拡張パネルを全て表示（アクティブなものだけを表示） */}
          {extensionPanels.map(panel => {
            const panelMenuTab = `extension:${panel.extensionId}.${panel.panelId}`;
            if (activeMenuTab === panelMenuTab) {
              return (
                <Suspense fallback={null} key={panelMenuTab}>
                  <ExtensionPanelRenderer
                    extensionId={panel.extensionId}
                    panelId={panel.panelId}
                    isActive={true}
                  />
                </Suspense>
              );
            }
            return null;
          })}
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
