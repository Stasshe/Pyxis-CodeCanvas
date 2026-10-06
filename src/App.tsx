import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useSnapshot } from 'valtio';

import BottomPanel from '@/components/Bottom/BottomPanel';
import BottomStatusBar from '@/components/Bottom/BottomStatusBar';
import CustomDragLayer from '@/components/DnD/CustomDragLayer';
import LeftSidebar from '@/components/Left/LeftSidebar';
import MenuBar from '@/components/MenuBar';
import PaneNavigator from '@/components/Pane/PaneNavigator';
import RootPaneArea from '@/components/Pane/RootPaneArea';
import RightSidebar from '@/components/Right/RightSidebar';
import OperationWindow from '@/components/Top/OperationWindow/OperationWindow';
import { useFolderOperationView } from '@/components/Top/OperationWindow/useFolderOperationView';
import TopBar from '@/components/Top/TopBar';
import { type OperationViewId, useFileSelector } from '@/context/FileSelectorContext';
import { useProject } from '@/engine/core/project';
import {
  useBottomPanelResize,
  useLeftSidebarResize,
  useRightSidebarResize,
} from '@/engine/helper/resize';
import { saveRecentFolder } from '@/engine/storage/recentFolderStorageAdapter';
import type { EditorPane } from '@/engine/tabs/types';
import { useKeyBinding } from '@/hooks/keybindings/useKeyBindings';
import { useFileDeleteTabSync } from '@/hooks/state/useFileDeleteTabSync';
import { useProjectWelcome } from '@/hooks/state/useProjectWelcome';
import useGlobalScrollLock from '@/hooks/ui/useGlobalScrollLock';
import { useOptimizedUIStateSave } from '@/hooks/ui/useOptimizedUIStateSave';
import { useTabContentRestore } from '@/hooks/ui/useTabContentRestore';
import { triggerGitRefresh } from '@/stores/gitRefreshStore';
import { getCurrentRootPath, setCurrentProject } from '@/stores/projectStore';
import { sessionStore } from '@/stores/sessionStore';
import { tabActions, tabState } from '@/stores/tabState';
import type { MenuTab, Project } from '@/types';
import { useTheme } from './context/ThemeContext';

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
  const [bottomPanelActiveTab, setBottomPanelActiveTab] = useState<
    'output' | 'terminal' | 'problems'
  >('terminal');
  const [isLeftSidebarVisible, setIsLeftSidebarVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [isPaneNavigatorOpen, setIsPaneNavigatorOpen] = useState(false);
  const [gitChangesCount, setGitChangesCount] = useState(0);
  const [nodeRuntimeOperationInProgress] = useState(false);
  const requestedInitialFolderPalette = useRef(false);

  const { colors } = useTheme();
  const snap = useSnapshot(tabState);
  const { panes, isLoading: isTabsLoading, isRestored, isContentRestored, activePane } = snap;
  const { openTab, setPanes, setActivePane, splitPane, removePane, moveTab, activateTab } =
    tabActions;
  const {
    isOpen: isOperationWindowVisible,
    targetPaneId: operationWindowTargetPaneId,
    initialViewId: operationWindowInitialViewId,
    openFileSelector,
    closeFileSelector,
  } = useFileSelector();

  // Helper function to flatten panes
  const flattenPanes = useCallback((paneList: readonly EditorPane[]): readonly EditorPane[] => {
    const result: EditorPane[] = [];
    const traverse = (list: readonly EditorPane[]) => {
      for (const pane of list) {
        if (!pane.children || pane.children.length === 0) {
          result.push(pane);
        }
        if (pane.children) {
          traverse(pane.children);
        }
      }
    };
    traverse(paneList);
    return result;
  }, []);

  // プロジェクト管理
  const {
    currentProject,
    projectFiles,
    loadProject,
    createProject,
    refreshProjectFiles,
    startupError,
    isReady,
  } = useProject();

  const folderPalettePaneId = activePane || panes.find(p => p.activeTabId)?.id || panes[0]?.id;
  const openOperationView = useCallback(
    (viewId: OperationViewId) => {
      if (folderPalettePaneId) openFileSelector(folderPalettePaneId, viewId);
    },
    [folderPalettePaneId, openFileSelector]
  );
  const openFolderPalette = useCallback(() => openOperationView('folders'), [openOperationView]);
  const openRecentPalette = useCallback(() => openOperationView('recent'), [openOperationView]);

  useEffect(() => {
    if (currentProject && !startupError) {
      requestedInitialFolderPalette.current = false;
      return;
    }
    if (!isReady || requestedInitialFolderPalette.current || !folderPalettePaneId) return;
    requestedInitialFolderPalette.current = true;
    openFolderPalette();
  }, [currentProject, folderPalettePaneId, isReady, openFolderPalette, startupError]);

  // グローバルプロジェクトストアを同期
  useEffect(() => {
    setCurrentProject(currentProject);
  }, [currentProject]);

  // タブコンテンツの復元と自動更新
  useTabContentRestore(isRestored);

  // ファイル削除時のタブ同期
  useFileDeleteTabSync();

  // プロジェクト読み込み時のWelcomeタブ
  useProjectWelcome(currentProject);

  // リサイズハンドラ
  const handleLeftResize = useLeftSidebarResize(leftSidebarWidth, setLeftSidebarWidth);
  const handleBottomResize = useBottomPanelResize(bottomPanelHeight, setBottomPanelHeight);
  const handleRightResize = useRightSidebarResize(rightSidebarWidth, setRightSidebarWidth);

  // グローバルスクロールロック
  useGlobalScrollLock();

  // Stable callbacks for refresh handlers to avoid passing new function refs each render
  const handleGitRefresh = useCallback(() => {
    if (currentProject && loadProject) {
      loadProject(currentProject);
    }
  }, [currentProject, loadProject]);

  const handleFilesRefresh = useCallback(() => {
    if (refreshProjectFiles) {
      refreshProjectFiles().then(() => triggerGitRefresh());
    }
  }, [refreshProjectFiles]);

  // File changes refresh the workspace through the FS Client listener.

  // UI状態の復元（sessionStorage統合）
  useEffect(() => {
    const restoreUIState = async () => {
      try {
        const uiState = await sessionStore.loadUIState();
        setLeftSidebarWidth(uiState.leftSidebarWidth);
        setRightSidebarWidth(uiState.rightSidebarWidth);
        setBottomPanelHeight(uiState.bottomPanelHeight);
        setIsLeftSidebarVisible(uiState.isLeftSidebarVisible);
        setIsRightSidebarVisible(uiState.isRightSidebarVisible);
        setIsBottomPanelVisible(uiState.isBottomPanelVisible);
        console.log('[page.tsx] UI state restored from storage');
      } catch (error) {
        console.error('[page.tsx] Failed to restore UI state:', error);
      }
    };

    restoreUIState();
  }, []);

  // UI状態の自動保存（最適化版）
  const { saveUIState, timerRef: saveTimerRef } = useOptimizedUIStateSave();

  useEffect(() => {
    if (isTabsLoading) return; // タブ読み込み中は保存しない

    // 前のタイマーが残っていればクリア
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    const uiState = {
      leftSidebarWidth,
      rightSidebarWidth,
      bottomPanelHeight,
      isLeftSidebarVisible,
      isRightSidebarVisible,
      isBottomPanelVisible,
    };

    // 3秒後に保存（hooks 側で最小間隔や再スケジュールを管理）
    saveTimerRef.current = window.setTimeout(() => {
      saveUIState(uiState);
    }, 3000);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [
    isTabsLoading,
    leftSidebarWidth,
    rightSidebarWidth,
    bottomPanelHeight,
    isLeftSidebarVisible,
    isRightSidebarVisible,
    isBottomPanelVisible,
    saveUIState,
    saveTimerRef,
  ]);

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

  // OperationWindowのトグル用（QuickOpen用）
  const toggleOperationWindow = () => {
    if (isOperationWindowVisible) {
      closeFileSelector();
    } else {
      // アクティブなペインを使用（tabStoreのactivePaneを優先）
      const targetPaneId = activePane || panes.find(p => p.activeTabId)?.id || panes[0]?.id;
      if (targetPaneId) {
        openFileSelector(targetPaneId, 'files');
      }
    }
  };

  const openQuickOpen = useCallback(() => openOperationView('files'), [openOperationView]);

  // プロジェクト選択
  const handleProjectSelect = useCallback(
    async (project: Project) => {
      const oldRootPath = getCurrentRootPath();
      if (oldRootPath === project.rootPath && !startupError) {
        await saveRecentFolder(project);
        closeFileSelector();
        return;
      }
      await tabActions.saveSession(oldRootPath);
      await loadProject(project);
      await tabActions.loadSession(project.rootPath);
      setIsLeftSidebarVisible(true);
      closeFileSelector();
    },
    [closeFileSelector, loadProject, startupError]
  );

  // プロジェクト作成
  const handleProjectCreate = useCallback(
    async (name: string) => {
      await tabActions.saveSession(getCurrentRootPath());
      const project = await createProject(name);
      await tabActions.loadSession(project.rootPath);
      setIsLeftSidebarVisible(true);
      closeFileSelector();
    },
    [closeFileSelector, createProject]
  );

  const { folderView, recentView } = useFolderOperationView({
    onOpenFolder: handleProjectSelect,
    onCreateFolder: handleProjectCreate,
    initialError: startupError,
    currentRootPath: getCurrentRootPath(),
    onOpenRecent: openRecentPalette,
    onOpenFolderView: openFolderPalette,
  });

  // ショートカットキーの登録
  useKeyBinding('quickOpen', openQuickOpen, [openQuickOpen]);
  useKeyBinding('toggleLeftSidebar', () => setIsLeftSidebarVisible(prev => !prev), []);
  useKeyBinding('toggleRightSidebar', () => setIsRightSidebarVisible(prev => !prev), []);
  useKeyBinding('toggleBottomPanel', () => setIsBottomPanelVisible(prev => !prev), []);
  useKeyBinding('openSettings', () => {
    setActiveMenuTab('settings');
    setIsLeftSidebarVisible(true);
  }, []);
  useKeyBinding('openExplorer', () => {
    setActiveMenuTab('files');
    setIsLeftSidebarVisible(true);
  }, []);
  useKeyBinding('openExtensions', () => {
    setActiveMenuTab('extensions');
    setIsLeftSidebarVisible(true);
  }, []);
  useKeyBinding('openShortcutKeys', () => {
    openTab(
      { name: 'Shortcut Keys', path: 'settings/shortcuts', settingsType: 'shortcuts' },
      { kind: 'settings' }
    );
  }, []);
  useKeyBinding('openGit', () => {
    setActiveMenuTab('git');
    setIsLeftSidebarVisible(true);
  }, []);
  useKeyBinding('openTerminal', () => setIsBottomPanelVisible(true), []);
  useKeyBinding('openProject', openFolderPalette, [openFolderPalette]);
  useKeyBinding('openRecent', openRecentPalette, [openRecentPalette]);
  useKeyBinding('globalSearch', () => {
    setActiveMenuTab('search');
    setIsLeftSidebarVisible(true);
  }, []);
  useKeyBinding('runFile', () => {
    setActiveMenuTab('run');
    setIsLeftSidebarVisible(true);
  }, []);

  // Pane management shortcuts
  useKeyBinding('openPaneNavigator', () => setIsPaneNavigatorOpen(true), []);

  useKeyBinding('splitPaneVertical', () => {
    const flatPanes = flattenPanes(panes);
    const currentPane = flatPanes.find(p => p.id === activePane) || flatPanes[0];
    if (currentPane) {
      splitPane(currentPane.id, 'vertical');
    }
  }, [panes, activePane, flattenPanes, splitPane]);

  useKeyBinding('splitPaneHorizontal', () => {
    const flatPanes = flattenPanes(panes);
    const currentPane = flatPanes.find(p => p.id === activePane) || flatPanes[0];
    if (currentPane) {
      splitPane(currentPane.id, 'horizontal');
    }
  }, [panes, activePane, flattenPanes, splitPane]);

  useKeyBinding('closePane', () => {
    const flatPanes = flattenPanes(panes);
    if (flatPanes.length <= 1) return; // Don't close the last pane
    const currentPane = flatPanes.find(p => p.id === activePane) || flatPanes[0];
    if (currentPane) {
      removePane(currentPane.id);
      // Focus the first remaining pane
      const remaining = flatPanes.filter(p => p.id !== currentPane.id);
      if (remaining.length > 0) {
        setActivePane(remaining[0].id);
        if (remaining[0].activeTabId) {
          activateTab(remaining[0].id, remaining[0].activeTabId);
        }
      }
    }
  }, [panes, activePane, flattenPanes, removePane, setActivePane, activateTab]);

  useKeyBinding('focusNextPane', () => {
    const flatPanes = flattenPanes(panes);
    if (flatPanes.length <= 1) return;
    const currentIndex = flatPanes.findIndex(p => p.id === activePane);
    const nextIndex = (currentIndex + 1) % flatPanes.length;
    const nextPane = flatPanes[nextIndex];
    setActivePane(nextPane.id);
    if (nextPane.activeTabId) {
      activateTab(nextPane.id, nextPane.activeTabId);
    }
  }, [panes, activePane, flattenPanes, setActivePane, activateTab]);

  useKeyBinding('focusPrevPane', () => {
    const flatPanes = flattenPanes(panes);
    if (flatPanes.length <= 1) return;
    const currentIndex = flatPanes.findIndex(p => p.id === activePane);
    const prevIndex = (currentIndex - 1 + flatPanes.length) % flatPanes.length;
    const prevPane = flatPanes[prevIndex];
    setActivePane(prevPane.id);
    if (prevPane.activeTabId) {
      activateTab(prevPane.id, prevPane.activeTabId);
    }
  }, [panes, activePane, flattenPanes, setActivePane, activateTab]);

  useKeyBinding('moveTabToNextPane', () => {
    const flatPanes = flattenPanes(panes);
    if (flatPanes.length <= 1) return;
    const currentPane = flatPanes.find(p => p.id === activePane);
    if (!currentPane || !currentPane.activeTabId) return;

    const currentIndex = flatPanes.findIndex(p => p.id === activePane);
    const nextIndex = (currentIndex + 1) % flatPanes.length;
    const nextPane = flatPanes[nextIndex];

    moveTab(currentPane.id, nextPane.id, currentPane.activeTabId);
  }, [panes, activePane, flattenPanes, moveTab]);

  // TouchBackendオプション: enableMouseEventsでマウスとタッチ両方をサポート
  // delayTouchStart: 長押し（200ms）でドラッグ開始
  const dndOptions = useMemo(
    () => ({
      enableMouseEvents: true,
      delayTouchStart: 200,
    }),
    []
  );

  return (
    <DndProvider backend={TouchBackend} options={dndOptions}>
      <CustomDragLayer />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {startupError && !isReady && (
          <div
            role="alert"
            className="absolute inset-0 z-[100] flex items-center justify-center bg-background p-8"
          >
            <div className="max-w-xl text-sm">
              <h1 className="mb-2 text-lg font-semibold">Pyxis could not start</h1>
              <p>{startupError}</p>
            </div>
          </div>
        )}
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
          {/* セッション復元中のローディング表示 */}
          {(isTabsLoading || (isRestored && !isContentRestored)) && (
            <div
              className="absolute inset-0 flex items-center justify-center z-50"
              style={{
                background: 'rgba(0, 0, 0, 0.5)',
              }}
            >
              <div className="text-white text-lg">
                {isTabsLoading ? 'Loading session...' : 'Restoring content...'}
              </div>
            </div>
          )}

          <MenuBar
            activeMenuTab={activeMenuTab}
            onMenuTabClick={handleMenuTabClick}
            onProjectClick={openFolderPalette}
            gitChangesCount={gitChangesCount}
          />

          {isLeftSidebarVisible && currentProject && (
            <LeftSidebar
              activeMenuTab={activeMenuTab}
              leftSidebarWidth={leftSidebarWidth}
              files={projectFiles}
              currentProject={currentProject}
              onResize={handleLeftResize}
              onGitRefresh={handleGitRefresh}
              onGitStatusChange={setGitChangesCount}
              onRefresh={handleFilesRefresh}
            />
          )}

          <div
            className="flex-1 flex flex-row overflow-hidden min-h-0"
            style={{ position: 'relative' }}
          >
            {/* メインエディタエリア */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <RootPaneArea panes={panes} colors={colors} setPanes={setPanes} />

              {isBottomPanelVisible && (
                <BottomPanel
                  height={bottomPanelHeight}
                  currentProject={currentProject?.name}
                  currentRootPath={currentProject?.rootPath || ''}
                  onResize={handleBottomResize}
                  activeTab={bottomPanelActiveTab}
                  onActiveTabChange={setBottomPanelActiveTab}
                />
              )}
            </div>

            {/* 右サイドバー */}
            {isRightSidebarVisible && (
              <RightSidebar
                rightSidebarWidth={rightSidebarWidth}
                onResize={handleRightResize}
                projectFiles={projectFiles}
                currentProject={currentProject}
                currentRootPath={currentProject?.rootPath ?? null}
              />
            )}
          </div>

          {isOperationWindowVisible && (
            <OperationWindow
              key={operationWindowInitialViewId ?? 'files'}
              onClose={closeFileSelector}
              projectFiles={projectFiles}
              targetPaneId={operationWindowTargetPaneId}
              views={[folderView, recentView]}
              initialViewId={operationWindowInitialViewId ?? 'files'}
            />
          )}

          <PaneNavigator
            isOpen={isPaneNavigatorOpen}
            onClose={() => setIsPaneNavigatorOpen(false)}
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
    </DndProvider>
  );
}
