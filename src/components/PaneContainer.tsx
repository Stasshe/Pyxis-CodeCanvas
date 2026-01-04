// src/components/PaneContainer.tsx
'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useDrop } from 'react-dnd';

import PaneResizer from '@/components/PaneResizer';
import { Breadcrumb } from '@/components/Tab/Breadcrumb';
import TabBar from '@/components/Tab/TabBar';
import {
  DND_FILE_TREE_ITEM,
  DND_TAB,
  isFileTreeDragItem,
  isTabDragItem,
} from '@/constants/dndTypes';
import { useTheme } from '@/context/ThemeContext';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import { useTabStore } from '@/stores/tabStore';
import type { EditorPane, FileItem } from '@/types';

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

// ペインをフラット化してリーフペインの数をカウント
function flattenPanes(paneList: EditorPane[]): EditorPane[] {
  const result: EditorPane[] = [];
  const traverse = (items: EditorPane[]) => {
    for (const p of items) {
      if (!p.children || p.children.length === 0) result.push(p);
      if (p.children) traverse(p.children);
    }
  };
  traverse(paneList);
  return result;
}

/**
 * PaneContainer: 自律的かつ機能完全なペインコンポーネント
 * - TabContextを通じた自律的なタブ操作
 * - TabRegistryによる動的なタブコンポーネントレンダリング
 * - 即時反映、保存、Git連携などの全機能を保持
 */
export default function PaneContainer({ pane, setGitRefreshTrigger }: PaneContainerProps) {
  const { colors } = useTheme();
  const {
    globalActiveTab,
    activePane,
    setPanes,
    panes: allPanes,
    moveTab,
    splitPaneAndMoveTab,
    openTab,
    splitPaneAndOpenFile,
  } = useTabStore();

  // リーフペインの数を計算（枠線表示の判定に使用）- パフォーマンスのためメモ化
  const leafPaneCount = useMemo(() => flattenPanes(allPanes).length, [allPanes]);
  const [dropZone, setDropZone] = React.useState<
    'top' | 'bottom' | 'left' | 'right' | 'center' | 'tabbar' | null
  >(null);
  const elementRef = React.useRef<HTMLDivElement | null>(null);
  const dropZoneRef = React.useRef<typeof dropZone>(null);

  // dropZone stateが変更されたらrefも更新（drop時に最新の値を参照するため）
  React.useEffect(() => {
    dropZoneRef.current = dropZone;
  }, [dropZone]);

  // ファイルを開くヘルパー関数
  const openFileInPane = React.useCallback(
    async (fileItem: FileItem, targetPaneId?: string) => {
      if (fileItem.type !== 'file') return;
      const defaultEditor =
        typeof window !== 'undefined' ? localStorage.getItem('pyxis-defaultEditor') : 'monaco';
      const kind = fileItem.isBufferArray ? 'binary' : 'editor';
      await openTab(
        { ...fileItem, isCodeMirror: defaultEditor === 'codemirror' },
        { kind, paneId: targetPaneId || pane.id }
      );
    },
    [openTab, pane.id]
  );

  // このペイン自体をドロップターゲットとして扱う（TABとFILE_TREE_ITEM両方受け付け）
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: [DND_TAB, DND_FILE_TREE_ITEM],
      drop: (item: any, monitor) => {
        const currentDropZone = dropZoneRef.current;
        console.log('[PaneContainer] drop called', { item, currentDropZone });

        // FILE_TREE_ITEMの場合
        if (isFileTreeDragItem(item)) {
          const fileItem = item.item as FileItem;
          console.log('[PaneContainer] File dropped from tree:', { fileItem, currentDropZone });

          // ファイルのみ処理（フォルダは無視）
          if (fileItem.type === 'file') {
            // TabBar上またはcenterの場合は単純にファイルを開く
            if (!currentDropZone || currentDropZone === 'center' || currentDropZone === 'tabbar') {
              openFileInPane(fileItem);
            } else {
              // 端にドロップした場合はペイン分割して開く
              const direction =
                currentDropZone === 'top' || currentDropZone === 'bottom'
                  ? 'horizontal'
                  : 'vertical';
              const position =
                currentDropZone === 'top' || currentDropZone === 'left' ? 'before' : 'after';

              // splitPaneAndOpenFileがあればそれを使用、なければ手動で処理
              if (splitPaneAndOpenFile) {
                splitPaneAndOpenFile(pane.id, direction, fileItem, position);
              } else {
                // フォールバック：単純にファイルを開く
                openFileInPane(fileItem);
              }
            }
          }
          setDropZone(null);
          return;
        }

        // TABの場合は既存のタブ移動ロジック
        if (isTabDragItem(item)) {
          if (!currentDropZone || currentDropZone === 'center' || currentDropZone === 'tabbar') {
            if (item.fromPaneId === pane.id) return; // 同じペインなら無視
            moveTab(item.fromPaneId, pane.id, item.tabId);
          } else {
            // Split logic
            const direction =
              currentDropZone === 'top' || currentDropZone === 'bottom' ? 'horizontal' : 'vertical';
            const side =
              currentDropZone === 'top' || currentDropZone === 'left' ? 'before' : 'after';
            splitPaneAndMoveTab(pane.id, direction, item.tabId, side);
          }
        }

        setDropZone(null);
      },
      hover: (item, monitor) => {
        if (!monitor.isOver({ shallow: true })) {
          setDropZone(null);
          return;
        }

        const clientOffset = monitor.getClientOffset();
        if (!clientOffset || !elementRef.current) return;

        const rect = elementRef.current.getBoundingClientRect();
        const x = clientOffset.x - rect.left;
        const y = clientOffset.y - rect.top;
        const w = rect.width;
        const h = rect.height;

        // TabBarの高さ（約40px）
        const tabBarHeight = 40;

        // TabBar上にいる場合
        if (y < tabBarHeight) {
          setDropZone('tabbar');
          return;
        }

        // ゾーン判定 (25% threshold for edges)
        const thresholdX = w * 0.25;
        const thresholdY = h * 0.25;

        let zone: 'top' | 'bottom' | 'left' | 'right' | 'center' = 'center';

        if (y < thresholdY + tabBarHeight) zone = 'top';
        else if (y > h - thresholdY) zone = 'bottom';
        else if (x < thresholdX) zone = 'left';
        else if (x > w - thresholdX) zone = 'right';

        setDropZone(zone);
      },
      collect: monitor => ({
        isOver: monitor.isOver({ shallow: true }),
      }),
    }),
    [pane.id, moveTab, splitPaneAndMoveTab, openFileInPane, splitPaneAndOpenFile]
  );

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
              <PaneContainer pane={childPane} setGitRefreshTrigger={setGitRefreshTrigger} />
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
                          return { ...p, children: updatedChildren };
                        }
                        if (p.children) {
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
  const isActivePane = activePane === pane.id;
  // isActive: グローバルアクティブタブが現在表示しているタブと一致し、かつこのペインがアクティブな場合
  // 同じファイルが複数のペインで開かれている場合でも、アクティブなペインのエディタのみがフォーカスを持つ
  const isGloballyActive = globalActiveTab === activeTab?.id && isActivePane;

  // TabRegistryからコンポーネントを取得
  const TabComponent = activeTab ? tabRegistry.get(activeTab.kind)?.component : null;

  // React の `ref` に渡すときの型不整合を避けるため、コールバック ref を用いる
  const dropRef = (node: HTMLDivElement | null) => {
    elementRef.current = node;
    try {
      if (typeof drop === 'function') {
        (drop as any)(node);
      }
    } catch (err) {
      // 安全のためエラーは無視
    }
  };

  // ドロップゾーンオーバーレイのスタイルを計算
  const getDropOverlayStyle = (): React.CSSProperties | null => {
    if (!isOver || !dropZone) return null;

    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      zIndex: 50,
      pointerEvents: 'none',
    };

    // TabBar上の場合：青いハイライト（ペイン分割なし、ファイルを開くだけ）
    if (dropZone === 'tabbar') {
      return {
        ...baseStyle,
        top: 0,
        left: 0,
        right: 0,
        height: '40px',
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        border: '2px solid #3b82f6',
      };
    }

    // Center：青いハイライト（ペイン移動/ファイルを開く）
    if (dropZone === 'center') {
      return {
        ...baseStyle,
        inset: 0,
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        border: '2px solid #3b82f6',
      };
    }

    // 端にドロップ：白いオーバーレイ（ペイン分割）
    const splitStyle: React.CSSProperties = {
      ...baseStyle,
      backgroundColor: 'rgba(255, 255, 255, 0.25)',
      border: '2px dashed rgba(59, 130, 246, 0.5)',
    };

    switch (dropZone) {
      case 'top':
        return { ...splitStyle, top: 0, left: 0, right: 0, height: '50%' };
      case 'bottom':
        return { ...splitStyle, bottom: 0, left: 0, right: 0, height: '50%' };
      case 'left':
        return { ...splitStyle, top: 0, left: 0, bottom: 0, width: '50%' };
      case 'right':
        return { ...splitStyle, top: 0, right: 0, bottom: 0, width: '50%' };
      default:
        return null;
    }
  };

  const overlayStyle = getDropOverlayStyle();

  // ペインが1つの場合は枠線を非表示、複数の場合はソフトな緑の強調
  const showActiveBorder = leafPaneCount > 1 && isActivePane;

  return (
    <GitContext.Provider value={{ setGitRefreshTrigger }}>
      <div
        ref={dropRef}
        className="flex flex-col overflow-hidden relative"
        style={{
          width: '100%',
          height: '100%',
          background: colors.background,
          border: showActiveBorder ? `1px solid ${colors.green}` : `1px solid ${colors.border}`,
          boxShadow: showActiveBorder
            ? `0 0 16px ${colors.green}40, 0 0 32px ${colors.green}20`
            : 'none',
        }}
      >
        {/* ドロップゾーンのオーバーレイ */}
        {overlayStyle && <div style={overlayStyle} />}

        {/* タブバー */}
        <TabBar paneId={pane.id} />

        {/* ブレッドクラム */}
        <Breadcrumb paneId={pane.id} />

        {/* エディタコンテンツ - TabRegistryで動的レンダリング */}
        <div className="flex-1 overflow-hidden">
          {activeTab && TabComponent ? (
            <TabComponent key={activeTab.id} tab={activeTab} isActive={isGloballyActive} />
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
