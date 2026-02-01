'use client';

import { Loader2, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';

import { DND_TAB } from '@/constants/dndTypes';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { Tab } from '@/engine/tabs/types';
import { tabActions, tabState } from '@/stores/tabState';
import { useSnapshot } from 'valtio';
import { TabIcon } from './TabIcon';

interface Props {
  tab: Tab;
  tabIndex: number;
  paneId: string;
  isActive: boolean;
  isDuplicate: boolean;
  onClick: (e: React.MouseEvent, tabId: string) => void;
  onContextMenu: (e: React.MouseEvent, tabId: string, el: HTMLElement) => void;
  onTouchStart: (e: React.TouchEvent, tabId: string, el: HTMLElement) => void;
  onTouchEnd: (e: React.TouchEvent, tabId: string, el: HTMLElement) => void;
  onTouchMove: () => void;
  onClose: (tabId: string) => void;
}

function DraggableTabInner({
  tab,
  tabIndex,
  paneId,
  isActive,
  isDuplicate,
  onClick,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { moveTabToIndex } = tabActions;

  const displayName = isDuplicate ? `${tab.name} (${tab.path})` : tab.name;

  const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | null>(null);
  const dragOverSideRef = useRef<'left' | 'right' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // 拡張機能タブがまだ登録されていない場合のローディング状態
  const [isExtensionLoading, setIsExtensionLoading] = useState(
    tab.kind.startsWith('extension:') && !tabRegistry.has(tab.kind)
  );

  useEffect(() => {
    // 拡張機能タブの場合、TabRegistryの変更を監視
    if (tab.kind.startsWith('extension:') && !tabRegistry.has(tab.kind)) {
      setIsExtensionLoading(true);
      const unsubscribe = tabRegistry.addChangeListener((kind) => {
        if (kind === tab.kind) {
          setIsExtensionLoading(false);
        }
      });
      return unsubscribe;
    }
    // 既に登録されている場合
    if (tab.kind.startsWith('extension:') && tabRegistry.has(tab.kind)) {
      setIsExtensionLoading(false);
    }
  }, [tab.kind]);

  useEffect(() => {
    dragOverSideRef.current = dragOverSide;
  }, [dragOverSide]);

  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: DND_TAB,
      item: {
        type: DND_TAB,
        tabId: tab.id,
        fromPaneId: paneId,
        index: tabIndex,
        tabName: tab.name,
      },
      collect: (monitor: any) => ({ isDragging: monitor.isDragging() }),
    }),
    [tab.id, paneId, tabIndex, tab.name]
  );

  const [{ isOver }, tabDrop] = useDrop(
    () => ({
      accept: DND_TAB,
      drop: (item: any, monitor: any) => {
        if (!item?.tabId) return;
        if (monitor && !monitor.isOver({ shallow: true })) return;
        if (item.tabId === tab.id) return;

        const fromPane = item.fromPaneId;
        let targetIndex = tabIndex;
        if (dragOverSideRef.current === 'right') targetIndex = tabIndex + 1;

        try {
          moveTabToIndex(fromPane, paneId, item.tabId, targetIndex);
          item.fromPaneId = paneId;
          item.index = targetIndex;
        } catch (err) {
          // ignore
        }
        setDragOverSide(null);
      },
      hover: (item, monitor) => {
        if (!ref.current) return;
        if (!monitor.isOver({ shallow: true })) {
          setDragOverSide(null);
          return;
        }

        const rect = ref.current.getBoundingClientRect();
        const clientX = (monitor.getClientOffset() as any).x;
        const middleX = (rect.right - rect.left) / 2;
        const relativeX = clientX - rect.left;

        setDragOverSide(relativeX < middleX ? 'left' : 'right');
      },
      collect: monitor => ({ isOver: monitor.isOver({ shallow: true }) }),
    }),
    [paneId, tabIndex, tab.id]
  );

  dragRef(tabDrop(ref));

  return (
    <div
      ref={ref}
      data-tab-id={tab.id}
      className={`h-full px-3 flex items-center gap-2 flex-shrink-0 relative ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
      style={{
        background: isActive ? colors.background : colors.mutedBg,
        // Avoid mixing shorthand `borderColor` with `borderRightColor` to prevent React warnings
        borderTopColor: isActive ? `${colors.green}80` : colors.border,
        borderLeftColor: isActive ? `${colors.green}80` : colors.border,
        borderRightWidth: '1px',
        borderRightStyle: 'solid',
        borderRightColor: colors.border,
        borderBottom: isActive ? `2px solid ${colors.green}90` : '2px solid transparent',
        boxShadow: isActive ? `0 2px 8px ${colors.green}20` : 'none',
        minWidth: '120px',
        maxWidth: '200px',
        opacity: isDragging ? 0.4 : 1,
        zIndex: isActive ? 10 : undefined,
      }}
      onClick={e => onClick(e, tab.id)}
      onContextMenu={e => {
        if (ref.current) onContextMenu(e, tab.id, ref.current);
      }}
      onTouchStart={e => {
        if (ref.current) onTouchStart(e, tab.id, ref.current);
      }}
      onTouchEnd={e => {
        if (ref.current) onTouchEnd(e, tab.id, ref.current);
      }}
      onTouchMove={onTouchMove}
    >
      {isOver && dragOverSide === 'left' && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: colors.accentFg || '#007acc',
            zIndex: 10,
          }}
        />
      )}
      {isOver && dragOverSide === 'right' && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: colors.accentFg || '#007acc',
            zIndex: 10,
          }}
        />
      )}

      {/* 拡張機能ローディング中の場合はスピナーを表示 */}
      {isExtensionLoading ? (
        <Loader2 size={14} color={colors.primary} className="animate-spin" />
      ) : (
        <TabIcon kind={tab.kind} filename={tab.name} size={14} color={colors.foreground} />
      )}
      <span
        className="text-sm truncate flex-1"
        style={{ color: isExtensionLoading ? colors.mutedFg : colors.foreground }}
        title={isExtensionLoading ? `Loading extension: ${tab.kind}` : displayName}
      >
        {displayName}
      </span>

      {tab.isDirty ? (
        <button
          data-close-button="true"
          className="hover:bg-accent rounded p-0.5 flex items-center justify-center"
          onClick={e => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          title={t('tabBar.unsavedChanges')}
        >
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: colors.foreground }}
          />
        </button>
      ) : (
        <button
          data-close-button="true"
          className="hover:bg-accent rounded p-0.5"
          onClick={e => {
            e.stopPropagation();
            onClose(tab.id);
          }}
        >
          <X size={14} color={colors.foreground} />
        </button>
      )}
    </div>
  );
}

export default DraggableTabInner;
