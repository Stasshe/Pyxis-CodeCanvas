// src/components/PaneContainer.tsx
'use client';

import React, { createContext, useContext } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useTabContext } from '@/context/TabContext';
import TabBar from '@/components/Tab/TabBar';
import PaneResizer from '@/components/PaneResizer';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { EditorPane } from '@/types';

interface PaneContainerProps {
  pane: EditorPane;
  setGitRefreshTrigger: (fn: (prev: number) => number) => void;
}

// Git連携のためのContext
interface GitContextValue {
  setGitRefreshTrigger: (fn: (prev: number) => number) => void;
}

const GitContext = createContext<GitContextValue | null>(null);

export const useGitContext = () => {
  const context = useContext(GitContext);
  if (!context) {
    throw new Error('useGitContext must be used within PaneContainer');
  }
  return context;
};

/**
 * PaneContainer: 自律的かつ機能完全なペインコンポーネント
 * - TabContextを通じた自律的なタブ操作
 * - TabRegistryによる動的なタブコンポーネントレンダリング
 * - 即時反映、保存、Git連携などの全機能を保持
 */
export default function PaneContainer({ pane, setGitRefreshTrigger }: PaneContainerProps) {
  const { colors } = useTheme();
  const { globalActiveTab, setPanes, panes: allPanes } = useTabContext();

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
                setGitRefreshTrigger={setGitRefreshTrigger}
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

                    // 親ペインを更新（再帰的にペインツリーを更新）
                    const updatePaneRecursive = (panes: EditorPane[]): EditorPane[] => {
                      return panes.map(p => {
                        if (p.id === pane.id) {
                          // 該当するペインの子を更新
                          return { ...p, children: updatedChildren };
                        }
                        if (p.children) {
                          // 再帰的に探索
                          return { ...p, children: updatePaneRecursive(p.children) };
                        }
                        return p;
                      });
                    };

                    setPanes(updatePaneRecursive(allPanes));
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
  const isGloballyActive = globalActiveTab === pane.activeTabId;

  // TabRegistryからコンポーネントを取得
  const TabComponent = activeTab ? tabRegistry.get(activeTab.kind)?.component : null;

  return (
    <GitContext.Provider value={{ setGitRefreshTrigger }}>
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: '100%',
          height: '100%',
          background: colors.background,
          border: `1px solid ${isGloballyActive ? colors.accentBg : colors.border}`,
        }}
      >
        {/* タブバー */}
        <TabBar paneId={pane.id} />

        {/* エディタコンテンツ - TabRegistryで動的レンダリング */}
        <div className="flex-1 overflow-hidden">
          {activeTab && TabComponent ? (
            <TabComponent
              tab={activeTab}
              isActive={isGloballyActive}
            />
          ) : (
            <div
              className="flex items-center justify-center h-full"
              style={{ color: colors.mutedFg }}
            >
              No active tab
            </div>
          )}
        </div>
      </div>
    </GitContext.Provider>
  );
}
