// src/components/PaneContainer.tsx
'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import TabBar from '@/components/Tab/TabBar';
import CodeEditor from '@/components/Tab/CodeEditor';
import DiffTab from '@/components/Tab/DiffTab';
import AIReviewTab from '@/components/AI/AIReview/AIReviewTab';
import WebPreviewTab from '@/components/Tab/WebPreviewTab';
import PaneResizer from '@/components/PaneResizer';
import type { EditorPane, Tab, Project, FileItem } from '@/types';
import { LOCALSTORAGE_KEY } from '@/context/config';
import {
  setTabsForPane,
  setActiveTabIdForPane,
  addEditorPane,
  removeEditorPane,
  splitPane,
  resizePane,
  flattenPanes,
} from '@/hooks/pane';
import { active } from 'd3';

interface PaneContainerProps {
  pane: EditorPane;
  paneIndex: number;
  allPanes: EditorPane[];
  setEditors: React.Dispatch<React.SetStateAction<EditorPane[]>>;
  currentProject?: Project;
  saveFile?: (path: string, content: string) => Promise<void>;
  clearAIReview?: (path: string) => Promise<void>;
  refreshProjectFiles?: () => Promise<void>;
  setGitRefreshTrigger: (fn: (prev: number) => number) => void;
  setFileSelectState: (state: { open: boolean; paneIdx: number | null }) => void;
  onTabContentChange: (tabId: string, content: string) => void | ((content: string) => void);
  isBottomPanelVisible: boolean;
  toggleBottomPanel: () => void;
  nodeRuntimeOperationInProgress: boolean;
}

export default function PaneContainer({
  pane,
  paneIndex,
  allPanes,
  setEditors,
  currentProject,
  saveFile,
  clearAIReview,
  refreshProjectFiles,
  setGitRefreshTrigger,
  setFileSelectState,
  onTabContentChange,
  isBottomPanelVisible,
  toggleBottomPanel,
  nodeRuntimeOperationInProgress,
}: PaneContainerProps) {
  const { colors } = useTheme();
  let wordWrapConfig: 'on' | 'off' = 'off';
  if (typeof window !== 'undefined') {
    wordWrapConfig =
      localStorage.getItem(LOCALSTORAGE_KEY.MONACO_WORD_WRAP) === 'true' ? 'on' : 'off';
  }

  // 子ペインがある場合は分割レイアウトをレンダリング
  if (pane.children && pane.children.length > 0) {
    return (
      <div
        className={pane.layout === 'vertical' ? 'flex flex-row h-full' : 'flex flex-col h-full'}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {pane.children.map((childPane, childIndex) => (
          <React.Fragment key={childPane.id}>
            <div
              style={{
                [pane.layout === 'vertical' ? 'width' : 'height']: `${childPane.size || 50}%`,
                position: 'relative',
                overflow: 'hidden',
                flexShrink: 0,
                flexGrow: 0,
              }}
            >
              <PaneContainer
                pane={childPane}
                paneIndex={childIndex}
                allPanes={allPanes}
                setEditors={setEditors}
                currentProject={currentProject}
                saveFile={saveFile}
                clearAIReview={clearAIReview}
                refreshProjectFiles={refreshProjectFiles}
                setGitRefreshTrigger={setGitRefreshTrigger}
                setFileSelectState={setFileSelectState}
                onTabContentChange={onTabContentChange}
                isBottomPanelVisible={isBottomPanelVisible}
                toggleBottomPanel={toggleBottomPanel}
                nodeRuntimeOperationInProgress={nodeRuntimeOperationInProgress}
              />
            </div>

            {/* 子ペイン間のリサイザー */}
            {childIndex < (pane.children?.length || 0) - 1 && pane.children && (
              <div
                style={{
                  position: 'relative',
                  [pane.layout === 'vertical' ? 'width' : 'height']: '6px',
                  [pane.layout === 'vertical' ? 'height' : 'width']: '100%',
                  flexShrink: 0,
                  flexGrow: 0,
                }}
              >
                <PaneResizer
                  direction={pane.layout === 'vertical' ? 'vertical' : 'horizontal'}
                  leftSize={childPane.size || 50}
                  rightSize={pane.children[childIndex + 1]?.size || 50}
                  onResize={(leftSize, rightSize) => {
                    if (!pane.children) return;
                    const updatedChildren = [...pane.children];
                    updatedChildren[childIndex] = { ...childPane, size: leftSize };
                    updatedChildren[childIndex + 1] = {
                      ...updatedChildren[childIndex + 1],
                      size: rightSize,
                    };

                    // 親ペインを更新
                    setEditors(prev => {
                      const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
                        return panes.map(p =>
                          p.id === pane.id
                            ? { ...p, children: updatedChildren }
                            : p.children
                              ? { ...p, children: updatePaneRecursive(p.children) }
                              : p
                        );
                      };
                      return updatePaneRecursive(prev);
                    });
                  }}
                />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  // リーフペイン（実際のエディタ）をレンダリング
  const activeTab = pane.tabs.find(tab => tab.id === pane.activeTabId);

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: '100%',
        height: '100%',
        background: colors.background,
        border: `1px solid ${colors.border}`,
      }}
    >
      <TabBar
        tabs={pane.tabs}
        activeTabId={pane.activeTabId}
        onTabClick={tabId => {
          const flatPanes = flattenPanes(allPanes);
          const actualPaneIndex = flatPanes.findIndex(p => p.id === pane.id);
          if (actualPaneIndex >= 0) {
            setActiveTabIdForPane(allPanes, setEditors, actualPaneIndex, tabId);
          }
        }}
        onTabClose={tabId => {
          const flatPanes = flattenPanes(allPanes);
          const actualPaneIndex = flatPanes.findIndex(p => p.id === pane.id);
          if (actualPaneIndex >= 0) {
            setTabsForPane(
              allPanes,
              setEditors,
              actualPaneIndex,
              pane.tabs.filter(t => t.id !== tabId)
            );
            if (pane.activeTabId === tabId) {
              const newActive = pane.tabs.filter(t => t.id !== tabId);
              setActiveTabIdForPane(
                allPanes,
                setEditors,
                actualPaneIndex,
                newActive.length > 0 ? newActive[0].id : ''
              );
            }
          }
        }}
        isBottomPanelVisible={isBottomPanelVisible}
        onToggleBottomPanel={toggleBottomPanel}
        onAddTab={() => {
          const flatPanes = flattenPanes(allPanes);
          const actualPaneIndex = flatPanes.findIndex(p => p.id === pane.id);
          setFileSelectState({ open: true, paneIdx: actualPaneIndex });
        }}
        addEditorPane={() => addEditorPane(allPanes, setEditors)}
        removeEditorPane={() => {
          // ペインが1つだけなら削除しない
          if (flattenPanes(allPanes).length <= 1) return;
          removeEditorPane(allPanes, setEditors, pane.id);
        }}
        toggleEditorLayout={() => {
          // 個別ペインの分割方式は現在未実装
        }}
        editorLayout="vertical" // 個別レイアウトは今後実装
        editorId={pane.id}
        removeAllTabs={() => {
          const flatPanes = flattenPanes(allPanes);
          const actualPaneIndex = flatPanes.findIndex(p => p.id === pane.id);
          if (actualPaneIndex >= 0) {
            setTabsForPane(allPanes, setEditors, actualPaneIndex, []);
          }
        }}
        availablePanes={flattenPanes(allPanes).map((p, idx) => ({
          id: p.id,
          name: `ペイン ${idx + 1}`,
        }))}
        onMoveTabToPane={(tabId, targetPaneId) => {
          // タブ移動のロジック
          const sourceTab = pane.tabs.find(t => t.id === tabId);
          if (!sourceTab) return;

          const flatPanes = flattenPanes(allPanes);
          const sourcePaneIndex = flatPanes.findIndex(p => p.id === pane.id);
          const targetPaneIndex = flatPanes.findIndex(p => p.id === targetPaneId);

          if (sourcePaneIndex >= 0 && targetPaneIndex >= 0) {
            // 移動元から削除
            setTabsForPane(
              allPanes,
              setEditors,
              sourcePaneIndex,
              pane.tabs.filter(t => t.id !== tabId)
            );

            // 移動先に追加
            setTabsForPane(allPanes, setEditors, targetPaneIndex, prevTabs => [
              ...prevTabs,
              sourceTab,
            ]);

            // 移動先でアクティブに
            setActiveTabIdForPane(allPanes, setEditors, targetPaneIndex, tabId);

            // 移動元のアクティブタブ調整
            if (pane.activeTabId === tabId) {
              const remainingTabs = pane.tabs.filter(t => t.id !== tabId);
              setActiveTabIdForPane(
                allPanes,
                setEditors,
                sourcePaneIndex,
                remainingTabs.length > 0 ? remainingTabs[0].id : ''
              );
            }
          }
        }}
        onSplitPane={direction => {
          splitPane(allPanes, setEditors, pane.id, direction);
        }}
      />

      {/* エディタコンテンツ */}
      <div className="flex-1 overflow-hidden">
        {activeTab &&
          (activeTab.webPreview ? (
            <WebPreviewTab
              filePath={activeTab.path}
              currentProjectName={currentProject?.name}
            />
          ) : activeTab.aiReviewProps ? (
            <AIReviewTab
              tab={activeTab}
              onApplyChanges={async (filePath: string, content: string) => {
                if (!currentProject || !saveFile) return;
                try {
                  await saveFile(filePath, content);
                  if (clearAIReview) await clearAIReview(filePath);
                  if (refreshProjectFiles) await refreshProjectFiles();
                  setGitRefreshTrigger(prev => prev + 1);
                } catch (error) {
                  console.error('Failed to apply AI review changes:', error);
                }
              }}
              onDiscardChanges={async (filePath: string) => {
                try {
                  if (clearAIReview) await clearAIReview(filePath);
                  if (refreshProjectFiles) await refreshProjectFiles();
                } catch (error) {
                  console.error('Failed to discard AI review changes:', error);
                }
              }}
              onCloseTab={(filePath: string) => {
                const flatPanes = flattenPanes(allPanes);
                const actualPaneIndex = flatPanes.findIndex(p => p.id === pane.id);
                if (actualPaneIndex >= 0) {
                  setTabsForPane(
                    allPanes,
                    setEditors,
                    actualPaneIndex,
                    pane.tabs.filter(tab => !(tab.aiReviewProps?.filePath === filePath))
                  );
                }
              }}
              onUpdateSuggestedContent={(tabId: string, newContent: string) => {
                setEditors(prev => {
                  const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
                    return panes.map(p => {
                      if (p.id === pane.id) {
                        return {
                          ...p,
                          tabs: p.tabs.map(t =>
                            t.id === tabId && t.aiReviewProps
                              ? {
                                  ...t,
                                  aiReviewProps: {
                                    ...t.aiReviewProps,
                                    suggestedContent: newContent,
                                  },
                                }
                              : t
                          ),
                        };
                      }
                      if (p.children) {
                        return { ...p, children: updatePaneRecursive(p.children) };
                      }
                      return p;
                    });
                  };
                  return updatePaneRecursive(prev);
                });
              }}
            />
          ) : activeTab.diffProps ? (
            <DiffTab diffs={activeTab.diffProps.diffs} />
          ) : (
            <CodeEditor
              activeTab={activeTab}
              isCodeMirror={activeTab?.isCodeMirror || false}
              bottomPanelHeight={200}
              isBottomPanelVisible={isBottomPanelVisible}
              wordWrapConfig={wordWrapConfig}
              onContentChangeImmediate={onTabContentChange}
              onContentChange={async (tabId: string, content: string) => {
                // タブ内容変更をコールバックに伝播（親コンポーネントで即時更新用に使用）

                // プロジェクトとファイルが有効な場合は保存処理を実行
                if (currentProject && saveFile && activeTab?.path) {
                  try {
                    // ファイルの保存を実行
                    await saveFile(activeTab.path, content);

                    // 保存成功後はisDirtyフラグをクリア
                    setEditors(prev => {
                      const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
                        return panes.map(p => {
                          if (!p.children) {
                            return {
                              ...p,
                              tabs: p.tabs.map(t =>
                                t.path === activeTab.path ? { ...t, isDirty: false } : t
                              ),
                            };
                          }
                          return { ...p, children: updatePaneRecursive(p.children) };
                        });
                      };
                      return updatePaneRecursive(prev);
                    });

                    // Git状態の更新をトリガー
                    setGitRefreshTrigger(prev => prev + 1);
                  } catch (error) {
                    console.error('Failed to save file:', error);
                  }
                }
              }}
            />
          ))}
      </div>
    </div>
  );
}
