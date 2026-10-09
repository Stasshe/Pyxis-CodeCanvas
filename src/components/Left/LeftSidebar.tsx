import { FilePlus, FolderOpen, FolderPlus } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { fsClient, resolvePath } from '@/engine/core/fs';
import { useExtensionPanels } from '@/hooks/ui/useExtensionPanels';
import { pushLogMessage } from '@/stores/loggerStore';
import { getCurrentRootPath } from '@/stores/projectStore';
import type { FileItem, MenuTab, Project } from '@/types';
import FileTree from './FileTree';
import { fileTreeErrorMessage } from './FileTree/fileTreeErrors';

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
  onRefresh?: () => void; // ファイルツリー再読み込み用
  onGitStatusChange?: (changesCount: number) => void;
}

export default function LeftSidebar({
  activeMenuTab,
  leftSidebarWidth,
  files,
  currentProject,
  onResize,
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
        className="app-sidebar app-sidebar-left flex flex-col flex-shrink-0"
        style={
          {
            background: colors.cardBg,
            '--sidebar-width': `${leftSidebarWidth}px`,
            '--sidebar-border-color': colors.border,
          } as React.CSSProperties
        }
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
            {activeMenuTab === 'extensions' && t('menu.extensions')}
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
                {/* Create a file at the workspace root. */}
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
                    const fileName = prompt(t('leftSidebar.newFilePrompt'));
                    if (fileName) {
                      try {
                        const newFilePath = resolvePath(currentProject.rootPath, fileName);
                        if (await fsClient.exists(newFilePath)) {
                          throw new Error(
                            t('fileTree.alert.destinationExists', { params: { path: newFilePath } })
                          );
                        }
                        if (getCurrentRootPath() !== currentProject.rootPath) {
                          throw new Error(t('fileTree.alert.workspaceChanged'));
                        }
                        await fsClient.writeRange(newFilePath, new Uint8Array(), null, true, true);
                        if (onRefresh) setTimeout(onRefresh, 100);
                      } catch (error) {
                        reportCreationError(
                          t('fileTree.alert.operationFailed', {
                            params: {
                              action: t('fileTree.action.createFile'),
                              error: fileTreeErrorMessage(error, path =>
                                t('fileTree.alert.destinationExists', { params: { path } })
                              ),
                            },
                          })
                        );
                      }
                    }
                  }}
                >
                  <FilePlus size={16} color={colors.sidebarIconFg} />
                </button>
                {/* Create a folder at the workspace root. */}
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
                    const folderName = prompt(t('leftSidebar.newFolderPrompt'));
                    if (folderName) {
                      try {
                        const newFolderPath = resolvePath(currentProject.rootPath, folderName);
                        if (await fsClient.exists(newFolderPath)) {
                          throw new Error(
                            t('fileTree.alert.destinationExists', {
                              params: { path: newFolderPath },
                            })
                          );
                        }
                        if (getCurrentRootPath() !== currentProject.rootPath) {
                          throw new Error(t('fileTree.alert.workspaceChanged'));
                        }
                        await fsClient.mkdir(newFolderPath);
                        if (onRefresh) setTimeout(onRefresh, 100);
                      } catch (error) {
                        reportCreationError(
                          t('fileTree.alert.operationFailed', {
                            params: {
                              action: t('fileTree.action.createFolder'),
                              error: fileTreeErrorMessage(error, path =>
                                t('fileTree.alert.destinationExists', { params: { path } })
                              ),
                            },
                          })
                        );
                      }
                    }
                  }}
                >
                  <FolderPlus size={16} color={colors.sidebarIconFg} />
                </button>
              </div>
              {/* Virtualized file tree - scrolls independently */}
              <div className="flex-1 overflow-hidden">
                <FileTree
                  key={currentProject.rootPath}
                  items={files}
                  rootPath={currentProject.rootPath}
                  onRefresh={onRefresh}
                />
              </div>
            </div>
          )}
          {activeMenuTab === 'search' && (
            <div className="h-full">
              <Suspense fallback={null}>
                <SearchPanel files={files} rootPath={currentProject.rootPath} />
              </Suspense>
            </div>
          )}
          {activeMenuTab === 'git' && (
            <div className="h-full">
              <Suspense fallback={null}>
                <GitPanel
                  currentProject={currentProject.name}
                  rootPath={currentProject.rootPath}
                  project={currentProject}
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
        data-sidebar-resizer="left"
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

function reportCreationError(message: string): void {
  pushLogMessage(message, 'error', 'FileTree');
  alert(message);
}
