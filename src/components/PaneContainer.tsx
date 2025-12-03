// src/components/PaneContainer.tsx
'use client';

import React, { createContext, useContext } from 'react';
import { useDrop } from 'react-dnd';

import PaneResizer from '@/components/PaneResizer';
import TabBar from '@/components/Tab/TabBar';
import { Breadcrumb } from '@/components/Tab/Breadcrumb';
import { useTheme } from '@/context/ThemeContext';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import { useTabStore } from '@/stores/tabStore';
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
  const { globalActiveTab, setPanes, panes: allPanes, moveTab, splitPaneAndMoveTab } = useTabStore();
  const elementRef = React.useRef<HTMLDivElement | null>(null);
  const dropZoneRef = React.useRef<'top' | 'bottom' | 'left' | 'right' | 'center' | null>(null);
  const [dropZone, setDropZone] = React.useState<'top' | 'bottom' | 'left' | 'right' | 'center' | null>(null);

  // このペイン自体をドロップターゲットとして扱う
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: 'TAB',
      drop: (item: { tabId: string; fromPaneId: string }, monitor) => {
        if (!item || !item.tabId) return;
        // Skip if already handled by a child (e.g., TabBar)
        if (monitor.didDrop()) return;

        // Use ref value for most accurate drop zone
        const currentZone = dropZoneRef.current;

        if (!currentZone || currentZone === 'center') {
          if (item.fromPaneId === pane.id) return;
          moveTab(item.fromPaneId, pane.id, item.tabId);
        } else {
          // Split logic
          const direction = currentZone === 'top' || currentZone === 'bottom' ? 'horizontal' : 'vertical';
          const side = currentZone === 'top' || currentZone === 'left' ? 'before' : 'after';
          splitPaneAndMoveTab(pane.id, direction, item.tabId, side);
        }

        dropZoneRef.current = null;
        setDropZone(null);
      },
      hover: (item, monitor) => {
        if (!monitor.isOver({ shallow: true })) {
          if (dropZoneRef.current !== null) {
            dropZoneRef.current = null;
            setDropZone(null);
          }
          return;
        }

        const clientOffset = monitor.getClientOffset();
        if (!clientOffset || !elementRef.current) return;

        const rect = elementRef.current.getBoundingClientRect();
        const x = clientOffset.x - rect.left;
        const y = clientOffset.y - rect.top;
        const w = rect.width;
        const h = rect.height;

        // Zone calculation with 25% threshold for edges
        const thresholdX = w * 0.25;
        const thresholdY = h * 0.25;

        let zone: 'top' | 'bottom' | 'left' | 'right' | 'center' = 'center';

        if (y < thresholdY) zone = 'top';
        else if (y > h - thresholdY) zone = 'bottom';
        else if (x < thresholdX) zone = 'left';
        else if (x > w - thresholdX) zone = 'right';

        // Only update if changed to reduce re-renders
        if (dropZoneRef.current !== zone) {
          dropZoneRef.current = zone;
          setDropZone(zone);
        }
      },
      collect: monitor => ({
        isOver: monitor.isOver({ shallow: true }),
      }),
    }),
    [pane.id, moveTab, splitPaneAndMoveTab]
  );

  // Reset drop zone when not hovering
  React.useEffect(() => {
    if (!isOver && dropZoneRef.current !== null) {
      dropZoneRef.current = null;
      setDropZone(null);
    }
  }, [isOver]);

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


  // React の `ref` に渡すときの型不整合を避けるため、コールバック ref を用いる
  const dropRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      elementRef.current = node;
      if (node) {
        drop(node);
      }
    },
    [drop]
  );

  return (
    <GitContext.Provider value={{ setGitRefreshTrigger }}>
      <div
        ref={dropRef}
        className="flex flex-col overflow-hidden relative"
        style={{
          width: '100%',
          height: '100%',
          background: colors.background,
          border: `1px solid ${isGloballyActive ? colors.accentBg : colors.border}`,
        }}
      >
        {/* ドロップゾーンのオーバーレイ */}
        {isOver && dropZone && (
            <div
                style={{
                    position: 'absolute',
                    zIndex: 50,
                    pointerEvents: 'none', // ドロップイベントを妨害しないように
                    // Center (Move): Blue highlight with border
                    ...(dropZone === 'center' ? { 
                        inset: 0,
                        backgroundColor: 'rgba(59, 130, 246, 0.1)', // Blue tint
                        border: '2px solid #3b82f6', // Blue border
                    } : {
                        // Split: White/Gray overlay for new pane area
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                    }),
                    ...(dropZone === 'top' ? { top: 0, left: 0, right: 0, height: '50%' } : {}),
                    ...(dropZone === 'bottom' ? { bottom: 0, left: 0, right: 0, height: '50%' } : {}),
                    ...(dropZone === 'left' ? { top: 0, left: 0, bottom: 0, width: '50%' } : {}),
                    ...(dropZone === 'right' ? { top: 0, right: 0, bottom: 0, width: '50%' } : {}),
                }}
            />
        )}

        {/* タブバー */}
        <TabBar paneId={pane.id} />
        
        {/* ブレッドクラム */}
        <Breadcrumb paneId={pane.id} />

        {/* エディタコンテンツ - TabRegistryで動的レンダリング */}
        <div className="flex-1 overflow-hidden">
          {activeTab && TabComponent ? (
            <TabComponent
              tab={activeTab}
              isActive={isGloballyActive}
            />
          ) : (
            <div
              className="flex flex-col h-full gap-2 select-none"
              style={{
                color: colors.mutedFg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                height: '100%',
              }}
            >
              <span style={{ fontWeight: 500, fontSize: '1.1em' }}>No active tab</span>
              <span style={{ fontSize: '0.95em', opacity: 0.8 }}>
                Please select a tab from above or create a new one to start editing.
              </span>
            </div>
          )}
        </div>
      </div>
    </GitContext.Provider>
  );
}
