// src/components/PaneContainer.tsx
'use client';
import React, { useState, useRef } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useTabContext } from '@/context/TabContext';
import { EditorPane } from '@/engine/tabs/types';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import TabBar from './Tab/TabBar';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface PaneContainerProps {
  pane: EditorPane;
}

/**
 * PaneContainer: 完全に自律的なペインコンポーネント
 * - page.tsxからのpropsは最小限
 * - タブ操作はTabContextを通じて直接実行
 * - 分割ペインの再帰的レンダリング
 */
export default function PaneContainer({ pane }: PaneContainerProps) {
  const { colors } = useTheme();
  const { activateTab, globalActiveTab } = useTabContext();

  // リサイザーのドラッグ状態
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<number>(0);
  const dragStartSize = useRef<number>(0);

  // 子ペインがある場合は分割レイアウトをレンダリング
  if (pane.children && pane.children.length > 0) {
    const isVertical = pane.layout === 'vertical';

    const handleResizerMouseDown = (e: React.MouseEvent, childIndex: number) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartPos.current = isVertical ? e.clientX : e.clientY;
      dragStartSize.current = pane.children![childIndex].size || 50;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const container = (e.target as HTMLElement).parentElement;
        if (!container) return;

        const containerSize = isVertical ? container.clientWidth : container.clientHeight;
        const delta = (isVertical ? moveEvent.clientX : moveEvent.clientY) - dragStartPos.current;
        const deltaPercent = (delta / containerSize) * 100;
        const newSize = Math.max(10, Math.min(90, dragStartSize.current + deltaPercent));

        // Update both children sizes
        if (pane.children && pane.children[childIndex]) {
          pane.children[childIndex].size = newSize;
          if (pane.children[childIndex + 1]) {
            pane.children[childIndex + 1].size = 100 - newSize;
          }
        }
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    return (
      <div
        className={isVertical ? 'flex flex-row h-full' : 'flex flex-col h-full'}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        {pane.children.map((childPane, childIndex) => (
          <React.Fragment key={childPane.id}>
            <div
              style={{
                [isVertical ? 'width' : 'height']: `${childPane.size || 50}%`,
                position: 'relative',
                overflow: 'hidden',
                flexShrink: 0,
                flexGrow: 0,
              }}
            >
              <PaneContainer pane={childPane} />
            </div>

            {/* リサイザー */}
            {childIndex < (pane.children?.length || 0) - 1 && (
              <div
                className={`${isVertical ? 'w-1 h-full cursor-col-resize' : 'h-1 w-full cursor-row-resize'} hover:bg-accent transition-colors`}
                style={{
                  background: isDragging ? colors.accentBg : colors.border,
                  flexShrink: 0,
                }}
                onMouseDown={e => handleResizerMouseDown(e, childIndex)}
              >
                <div className="flex items-center justify-center h-full w-full">
                  {isVertical ? (
                    <ChevronRight
                      size={12}
                      color={colors.mutedFg}
                    />
                  ) : (
                    <ChevronDown
                      size={12}
                      color={colors.mutedFg}
                    />
                  )}
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  // リーフペイン: 実際のタブとエディタをレンダリング
  const activeTab = pane.tabs.find(tab => tab.id === pane.activeTabId);
  const isGloballyActive = globalActiveTab === pane.activeTabId;

  // タブのコンポーネントを取得
  const TabComponent = activeTab ? tabRegistry.get(activeTab.kind)?.component : null;

  return (
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

      {/* エディタコンテンツ */}
      <div className="flex-1 overflow-hidden">
        {activeTab && TabComponent ? (
          <TabComponent
            tab={activeTab}
            isActive={isGloballyActive}
            onClose={() => {
              // handled by TabBar
            }}
            onMakeActive={() => activateTab(pane.id, activeTab.id)}
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
  );
}
