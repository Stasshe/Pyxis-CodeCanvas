'use client';

import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useTabContext } from '@/context/TabContext';
import useGlobalScrollLock from '@/hooks/useGlobalScrollLock';
import { useKeyBinding } from '@/hooks/useKeyBindings';
import MenuBar from '@/components/MenuBar';
import LeftSidebar from '@/components/Left/LeftSidebar';
import PaneContainer from '@/components/PaneContainer';
import BottomPanel from '@/components/Bottom/BottomPanel';
import ProjectModal from '@/components/ProjectModal';
import {
  useLeftSidebarResize,
  useBottomPanelResize,
  useRightSidebarResize,
} from '@/engine/helper/resize';
import { useProject } from '@/engine/core/project';
import initFileWatcherBridge from '@/engine/fileWatcherBridge';
import { Project } from '@/types';
import type { FileItem, MenuTab } from '@/types';
import RightSidebar from '@/components/Right/RightSidebar';
import TopBar from '@/components/TopBar';
import BottomStatusBar from '@/components/BottomStatusBar';
import OperationWindow from '@/components/OperationWindow';
import { LOCALSTORAGE_KEY } from '@/context/config';

/**
 * Home: 新アーキテクチャのメインページ
 * - タブ・ペイン管理は全てTabContext経由
 * - page.tsxは単なるレイアウトコンテナ
 * - 各コンポーネントが自律的に動作
 */
export default function Home() {
  const [activeMenuTab, setActiveMenuTab] = useState<MenuTab>('files');
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(240);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(240);
  const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(true);
  const [isLeftSidebarVisible, setIsLeftSidebarVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isOperationWindowVisible, setIsOperationWindowVisible] = useState(false);
  const [gitRefreshTrigger, setGitRefreshTrigger] = useState(0);
  const [gitChangesCount, setGitChangesCount] = useState(0);
  const [nodeRuntimeOperationInProgress, setNodeRuntimeOperationInProgress] = useState(false);

  const { colors } = useTheme();
  const { panes, openTab, setPanes } = useTabContext();

  // プロジェクト管理
  const { currentProject, projectFiles, loadProject, createProject, refreshProjectFiles } =
    useProject();

  // リサイズハンドラ
  const handleLeftResize = useLeftSidebarResize(leftSidebarWidth, setLeftSidebarWidth);
  const handleBottomResize = useBottomPanelResize(bottomPanelHeight, setBottomPanelHeight);
  const handleRightResize = useRightSidebarResize(rightSidebarWidth, setRightSidebarWidth);

  // グローバルスクロールロック
  useGlobalScrollLock();

  // 初期化: FileWatcherブリッジ
  useEffect(() => {
    if (typeof window !== 'undefined') {
      initFileWatcherBridge();
    }
  }, []);

  // UI状態のlocalStorage永続化
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const uiState = {
          isLeftSidebarVisible,
          isRightSidebarVisible,
          isBottomPanelVisible,
          leftSidebarWidth,
          rightSidebarWidth,
          bottomPanelHeight,
        };
        window.localStorage.setItem(LOCALSTORAGE_KEY.UI_STATE, JSON.stringify(uiState));
      } catch (e) {
        console.error('[page.tsx] Failed to save UI state:', e);
      }
    }
  }, [
    isLeftSidebarVisible,
    isRightSidebarVisible,
    isBottomPanelVisible,
    leftSidebarWidth,
    rightSidebarWidth,
    bottomPanelHeight,
  ]);

  // UI状態の復元
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(LOCALSTORAGE_KEY.UI_STATE);
        if (saved) {
          const uiState = JSON.parse(saved);
          if (typeof uiState.isLeftSidebarVisible === 'boolean')
            setIsLeftSidebarVisible(uiState.isLeftSidebarVisible);
          if (typeof uiState.isRightSidebarVisible === 'boolean')
            setIsRightSidebarVisible(uiState.isRightSidebarVisible);
          if (typeof uiState.isBottomPanelVisible === 'boolean')
            setIsBottomPanelVisible(uiState.isBottomPanelVisible);
          if (typeof uiState.leftSidebarWidth === 'number')
            setLeftSidebarWidth(uiState.leftSidebarWidth);
          if (typeof uiState.rightSidebarWidth === 'number')
            setRightSidebarWidth(uiState.rightSidebarWidth);
          if (typeof uiState.bottomPanelHeight === 'number')
            setBottomPanelHeight(uiState.bottomPanelHeight);
        }
      } catch (e) {
        console.error('[page.tsx] Failed to restore UI state:', e);
      }
    }
  }, []);

  // Git状態監視（簡易版）
  useEffect(() => {
    if (!currentProject) return;
    // TODO: Git状態監視のロジックをフックに移動
    const interval = setInterval(() => {
      if (refreshProjectFiles) {
        refreshProjectFiles();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [currentProject, refreshProjectFiles]);

  // メニュータブクリック
  const handleMenuTabClick = (tab: MenuTab) => {
    if (activeMenuTab === tab && isLeftSidebarVisible) {
      setIsLeftSidebarVisible(false);
    } else {
      setActiveMenuTab(tab);
      setIsLeftSidebarVisible(true);
    }
  };

  const toggleBottomPanel = () => setIsBottomPanelVisible(!isBottomPanelVisible);
  const toggleRightSidebar = () => setIsRightSidebarVisible(!isRightSidebarVisible);
  const toggleOperationWindow = () => setIsOperationWindowVisible(!isOperationWindowVisible);

  // ファイルを開く（新アーキテクチャ）
  const handleFileOpen = (file: FileItem, line?: number, column?: number) => {
    // 最新のプロジェクトファイルからコンテンツを取得
    let fileToOpen = file;
    if (currentProject && projectFiles.length > 0) {
      const latestFile = projectFiles.find(f => f.path === file.path);
      if (latestFile) {
        fileToOpen = {
          ...file,
          content: latestFile.content,
          isBufferArray: (latestFile as any).isBufferArray,
          bufferContent: (latestFile as any).bufferContent,
        };
      }
    }

    openTab(fileToOpen, {
      kind: 'editor',
      jumpToLine: line,
      jumpToColumn: column,
    });
  };

  // プロジェクト選択
  const handleProjectSelect = async (project: Project) => {
    // タブを全てクリア
    setPanes([{ id: 'pane-1', tabs: [], activeTabId: '' }]);
    setIsLeftSidebarVisible(true);
    await loadProject(project);
  };

  // プロジェクト作成
  const handleProjectCreate = async (name: string, description?: string) => {
    if (createProject) {
      // タブを全てクリア
      setPanes([{ id: 'pane-1', tabs: [], activeTabId: '' }]);
      setIsLeftSidebarVisible(true);
      await createProject(name, description);
    }
  };

  // ショートカットキーの登録
  useKeyBinding('quickOpen', () => setIsOperationWindowVisible(true), []);
  useKeyBinding('toggleLeftSidebar', () => setIsLeftSidebarVisible(prev => !prev), []);
  useKeyBinding('toggleRightSidebar', () => setIsRightSidebarVisible(prev => !prev), []);
  useKeyBinding('toggleBottomPanel', () => setIsBottomPanelVisible(prev => !prev), []);
  useKeyBinding(
    'openSettings',
    () => {
      setActiveMenuTab('settings');
      setIsLeftSidebarVisible(true);
    },
    []
  );
  useKeyBinding(
    'openShortcutKeys',
    () => {
      openTab(
        { name: 'Shortcut Keys', path: 'settings/shortcuts', settingsType: 'shortcuts' } as any,
        { kind: 'settings' }
      );
    },
    []
  );
  useKeyBinding(
    'openGit',
    () => {
      setActiveMenuTab('git');
      setIsLeftSidebarVisible(true);
    },
    []
  );
  useKeyBinding('openTerminal', () => setIsBottomPanelVisible(true), []);
  useKeyBinding('openProject', () => setIsProjectModalOpen(true), []);
  useKeyBinding(
    'globalSearch',
    () => {
      setActiveMenuTab('search');
      setIsLeftSidebarVisible(true);
    },
    []
  );
  useKeyBinding(
    'runFile',
    () => {
      setActiveMenuTab('run');
      setIsLeftSidebarVisible(true);
    },
    []
  );

  // ファイル選択モーダルのイベントリスナー
  useEffect(() => {
    const handleOpenFileSelector = (e: Event) => {
      const custom = e as CustomEvent<{ paneId: string }>;
      setIsOperationWindowVisible(true);
    };
    window.addEventListener('pyxis-open-file-selector', handleOpenFileSelector);
    return () => {
      window.removeEventListener('pyxis-open-file-selector', handleOpenFileSelector);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TopBar
        isOperationWindowVisible={isOperationWindowVisible}
        toggleOperationWindow={toggleOperationWindow}
        isBottomPanelVisible={isBottomPanelVisible}
        toggleBottomPanel={toggleBottomPanel}
        isRightSidebarVisible={isRightSidebarVisible}
        toggleRightSidebar={toggleRightSidebar}
        colors={colors}
        currentProjectName={currentProject?.name}
      />

      <div
        className="flex-1 w-full flex overflow-hidden"
        style={{
          background: colors.background,
          position: 'relative',
        }}
      >
        <MenuBar
          activeMenuTab={activeMenuTab}
          onMenuTabClick={handleMenuTabClick}
          onProjectClick={() => setIsProjectModalOpen(true)}
          gitChangesCount={gitChangesCount}
        />

        {isLeftSidebarVisible && (
          <LeftSidebar
            activeMenuTab={activeMenuTab}
            leftSidebarWidth={leftSidebarWidth}
            files={projectFiles}
            currentProject={currentProject!}
            onFileOpen={handleFileOpen}
            onFilePreview={file => {
              openTab(file, { kind: 'preview' });
            }}
            onWebPreview={(file: FileItem) => {
              openTab(file, { kind: 'webPreview' });
            }}
            onResize={handleLeftResize}
            onGitRefresh={() => {
              if (currentProject && loadProject) {
                loadProject(currentProject);
              }
            }}
            gitRefreshTrigger={gitRefreshTrigger}
            onGitStatusChange={setGitChangesCount}
            onRefresh={() => {
              if (refreshProjectFiles) {
                refreshProjectFiles().then(() => {
                  setGitRefreshTrigger(prev => prev + 1);
                });
              }
            }}
            onDiffFileClick={file => {
              // TODO: Diff機能の実装
              console.log('[TODO] Diff file:', file);
            }}
            onDiffAllFilesClick={() => {
              // TODO: Diff All機能の実装
              console.log('[TODO] Diff all files');
            }}
            onOpenShortcutKeys={() => {
              openTab(
                {
                  name: 'Shortcut Keys',
                  path: 'settings/shortcuts',
                  settingsType: 'shortcuts',
                } as any,
                { kind: 'settings' }
              );
            }}
          />
        )}

        <div
          className="flex-1 flex flex-row overflow-hidden min-h-0"
          style={{ position: 'relative' }}
        >
          {/* メインエディタエリア */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden">
              {panes.map(pane => (
                <PaneContainer
                  key={pane.id}
                  pane={pane}
                />
              ))}
            </div>

            {isBottomPanelVisible && (
              <BottomPanel
                height={bottomPanelHeight}
                currentProject={currentProject?.name}
                currentProjectId={currentProject?.id || ''}
                projectFiles={projectFiles}
                onResize={handleBottomResize}
              />
            )}
          </div>

          {/* 右サイドバー */}
          {isRightSidebarVisible && (
            <>
              <div
                className="resizer resizer-vertical flex-shrink-0"
                onMouseDown={handleRightResize}
                onTouchStart={handleRightResize}
                style={{
                  background: colors.sidebarResizerBg,
                  cursor: 'col-resize',
                }}
              />
              <RightSidebar
                rightSidebarWidth={rightSidebarWidth}
                onResize={() => {}}
                projectFiles={projectFiles}
                currentProject={currentProject}
                currentProjectId={currentProject?.id || ''}
              />
            </>
          )}
        </div>

        <ProjectModal
          isOpen={isProjectModalOpen}
          onClose={() => setIsProjectModalOpen(false)}
          onProjectSelect={handleProjectSelect}
          onProjectCreate={handleProjectCreate}
          currentProject={currentProject}
        />

        <OperationWindow
          isVisible={isOperationWindowVisible}
          onClose={() => setIsOperationWindowVisible(false)}
          projectFiles={projectFiles}
          editors={panes}
          setEditors={update => {
            if (typeof update === 'function') {
              setPanes(update(panes));
            } else {
              setPanes(update);
            }
          }}
          setFileSelectState={() => {}}
          currentPaneIndex={0}
        />
      </div>

      <BottomStatusBar
        height={22}
        currentProjectName={currentProject?.name}
        gitChangesCount={gitChangesCount}
        nodeRuntimeBusy={nodeRuntimeOperationInProgress}
        colors={colors}
      />
    </div>
  );
}
