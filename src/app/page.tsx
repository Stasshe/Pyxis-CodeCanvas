'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

import { useTheme } from '../context/ThemeContext';

import BottomPanel from '@/components/Bottom/BottomPanel';
import BottomStatusBar from '@/components/Bottom/BottomStatusBar';
import CustomDragLayer from '@/components/DnD/CustomDragLayer';
import LeftSidebar from '@/components/Left/LeftSidebar';
import MenuBar from '@/components/MenuBar';
import PaneContainer from '@/components/Pane/PaneContainer';
import PaneNavigator from '@/components/Pane/PaneNavigator';
import ProjectModal from '@/components/ProjectModal';
import RightSidebar from '@/components/Right/RightSidebar';
import OperationWindow from '@/components/Top/OperationWindow/OperationWindow';
import TopBar from '@/components/Top/TopBar';
import { useFileSelector } from '@/context/FileSelectorContext';
import { useProject } from '@/engine/core/project';
import {
  useBottomPanelResize,
  useLeftSidebarResize,
  useRightSidebarResize,
} from '@/engine/helper/resize';
import type { EditorPane } from '@/engine/tabs/types';
import { useKeyBinding } from '@/hooks/keybindings/useKeyBindings';
import { useFileDeleteTabSync } from '@/hooks/state/useFileDeleteTabSync';
import { useProjectWelcome } from '@/hooks/state/useProjectWelcome';
import useGlobalScrollLock from '@/hooks/ui/useGlobalScrollLock';
import { useOptimizedUIStateSave } from '@/hooks/ui/useOptimizedUIStateSave';
import { useTabContentRestore } from '@/hooks/ui/useTabContentRestore';
import { setCurrentProject } from '@/stores/projectStore';
import { sessionStore } from '@/stores/sessionStore';
import { tabActions, tabState } from '@/stores/tabState';
import type { Project } from '@/types';
import type { MenuTab } from '@/types';
import { useSnapshot } from 'valtio';

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
    'output' | 'terminal' | 'debug' | 'problems'
  >('terminal');
  const [isLeftSidebarVisible, setIsLeftSidebarVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isPaneNavigatorOpen, setIsPaneNavigatorOpen] = useState(false);
  const [gitRefreshTrigger, setGitRefreshTrigger] = useState(0);
  const [gitChangesCount, setGitChangesCount] = useState(0);
  const [nodeRuntimeOperationInProgress] = useState(false);

  const { colors } = useTheme();
  const snap = useSnapshot(tabState);
  const { panes, isLoading: isTabsLoading, isRestored, isContentRestored, activePane } = snap;
  const { openTab, setPanes, setActivePane, splitPane, removePane, moveTab, activateTab } =
    tabActions;
  const {
    isOpen: isOperationWindowVisible,
    targetPaneId: operationWindowTargetPaneId,
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
  const { currentProject, projectFiles, loadProject, createProject, refreshProjectFiles } =
    useProject();

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
      refreshProjectFiles().then(() => setGitRefreshTrigger(prev => prev + 1));
    }
  }, [refreshProjectFiles]);

  // FileWatcher bridge removed: components now subscribe directly to fileRepository

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
  const { openFileSelector } = useFileSelector();
  const toggleOperationWindow = () => {
    if (isOperationWindowVisible) {
      closeFileSelector();
    } else {
      // アクティブなペインを使用（tabStoreのactivePaneを優先）
      const targetPaneId = activePane || panes.find(p => p.activeTabId)?.id || panes[0]?.id;
      if (targetPaneId) {
        openFileSelector(targetPaneId);
      }
    }
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
  useKeyBinding('quickOpen', toggleOperationWindow, [panes, activePane]);
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
    'openExplorer',
    () => {
      setActiveMenuTab('files');
      setIsLeftSidebarVisible(true);
    },
    []
  );
  useKeyBinding(
    'openExtensions',
    () => {
      setActiveMenuTab('extensions');
      setIsLeftSidebarVisible(true);
    },
    []
  );
  useKeyBinding(
    'openShortcutKeys',
    () => {
      openTab(
        { name: 'Shortcut Keys', path: 'settings/shortcuts', settingsType: 'shortcuts' },
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

  // Pane management shortcuts
  useKeyBinding('openPaneNavigator', () => setIsPaneNavigatorOpen(true), []);

  useKeyBinding(
    'splitPaneVertical',
    () => {
      const flatPanes = flattenPanes(panes);
      const currentPane = flatPanes.find(p => p.id === activePane) || flatPanes[0];
      if (currentPane) {
        splitPane(currentPane.id, 'vertical');
      }
    },
    [panes, activePane, flattenPanes, splitPane]
  );

  useKeyBinding(
    'splitPaneHorizontal',
    () => {
      const flatPanes = flattenPanes(panes);
      const currentPane = flatPanes.find(p => p.id === activePane) || flatPanes[0];
      if (currentPane) {
        splitPane(currentPane.id, 'horizontal');
      }
    },
    [panes, activePane, flattenPanes, splitPane]
  );

  useKeyBinding(
    'closePane',
    () => {
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
    },
    [panes, activePane, flattenPanes, removePane, setActivePane, activateTab]
  );

  useKeyBinding(
    'focusNextPane',
    () => {
      const flatPanes = flattenPanes(panes);
      if (flatPanes.length <= 1) return;
      const currentIndex = flatPanes.findIndex(p => p.id === activePane);
      const nextIndex = (currentIndex + 1) % flatPanes.length;
      const nextPane = flatPanes[nextIndex];
      setActivePane(nextPane.id);
      if (nextPane.activeTabId) {
        activateTab(nextPane.id, nextPane.activeTabId);
      }
    },
    [panes, activePane, flattenPanes, setActivePane, activateTab]
  );

  useKeyBinding(
    'focusPrevPane',
    () => {
      const flatPanes = flattenPanes(panes);
      if (flatPanes.length <= 1) return;
      const currentIndex = flatPanes.findIndex(p => p.id === activePane);
      const prevIndex = (currentIndex - 1 + flatPanes.length) % flatPanes.length;
      const prevPane = flatPanes[prevIndex];
      setActivePane(prevPane.id);
      if (prevPane.activeTabId) {
        activateTab(prevPane.id, prevPane.activeTabId);
      }
    },
    [panes, activePane, flattenPanes, setActivePane, activateTab]
  );

  useKeyBinding(
    'moveTabToNextPane',
    () => {
      const flatPanes = flattenPanes(panes);
      if (flatPanes.length <= 1) return;
      const currentPane = flatPanes.find(p => p.id === activePane);
      if (!currentPane || !currentPane.activeTabId) return;

      const currentIndex = flatPanes.findIndex(p => p.id === activePane);
      const nextIndex = (currentIndex + 1) % flatPanes.length;
      const nextPane = flatPanes[nextIndex];

      moveTab(currentPane.id, nextPane.id, currentPane.activeTabId);
    },
    [panes, activePane, flattenPanes, moveTab]
  );

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
            onProjectClick={() => setIsProjectModalOpen(true)}
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
              gitRefreshTrigger={gitRefreshTrigger}
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
              <div
                className="flex-1 overflow-hidden flex flex-row"
                style={{ position: 'relative' }}
              >
                {panes.map((pane, idx) => (
                  <React.Fragment key={pane.id}>
                    <div
                      style={{
                        width: panes.length > 1 ? `${pane.size || 100 / panes.length}%` : '100%',
                        height: '100%',
                        position: 'relative',
                        overflow: 'hidden',
                        flexShrink: 0,
                        flexGrow: 0,
                      }}
                    >
                      <PaneContainer pane={pane} setGitRefreshTrigger={setGitRefreshTrigger} />
                    </div>

                    {/* ルートレベルペイン間のリサイザー */}
                    {idx < panes.length - 1 && (
                      <div
                        style={{
                          position: 'relative',
                          width: '6px',
                          height: '100%',
                          flexShrink: 0,
                          flexGrow: 0,
                          cursor: 'col-resize',
                          background: colors.border,
                          zIndex: 10,
                        }}
                        onMouseDown={e => {
                          e.preventDefault();
                          const startX = e.clientX;
                          const startLeftSize = pane.size || 100 / panes.length;
                          const startRightSize = panes[idx + 1]?.size || 100 / panes.length;

                          const handleMouseMove = (moveEvent: MouseEvent) => {
                            const container = e.currentTarget.parentElement;
                            if (!container) return;

                            const containerWidth = container.clientWidth;
                            const delta = moveEvent.clientX - startX;
                            const deltaPercent = (delta / containerWidth) * 100;
                            const newLeftSize = Math.max(
                              10,
                              Math.min(90, startLeftSize + deltaPercent)
                            );
                            const newRightSize = Math.max(
                              10,
                              Math.min(90, startRightSize - deltaPercent)
                            );

                            const updatedPanes = [...panes];
                            updatedPanes[idx] = { ...pane, size: newLeftSize };
                            updatedPanes[idx + 1] = {
                              ...updatedPanes[idx + 1],
                              size: newRightSize,
                            };
                            setPanes(updatedPanes);
                          };

                          const handleMouseUp = () => {
                            document.removeEventListener('mousemove', handleMouseMove);
                            document.removeEventListener('mouseup', handleMouseUp);
                          };

                          document.addEventListener('mousemove', handleMouseMove);
                          document.addEventListener('mouseup', handleMouseUp);
                        }}
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>

              {isBottomPanelVisible && (
                <BottomPanel
                  height={bottomPanelHeight}
                  currentProject={currentProject?.name}
                  currentProjectId={currentProject?.id || ''}
                  projectFiles={projectFiles}
                  onResize={handleBottomResize}
                  activeTab={bottomPanelActiveTab}
                  onActiveTabChange={setBottomPanelActiveTab}
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
                  onResize={handleRightResize}
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
            onClose={closeFileSelector}
            projectFiles={projectFiles}
            targetPaneId={operationWindowTargetPaneId}
          />

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
