'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { X } from 'lucide-react';

import { TabIcon } from './TabIcon';
import { DND_TAB } from '@/constants/dndTypes';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';
import { tabActions, tabState } from '@/stores/tabState';
import { useSnapshot } from 'valtio';

interface Props {
  tab: any;
  tabIndex: number;
  paneId: string;
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
  const { panes } = useSnapshot(tabState);

  const isActive = useMemo(() => {
    const pane = panes.find(p => p.id === paneId);
    return !!pane && pane.activeTabId === tab.id;
  }, [panes, paneId, tab.id]);

  // duplicate name detection
  const nameCount = useMemo(() => {
    const pane = panes.find(p => p.id === paneId);
    const tabs = pane?.tabs || [];
    const counts: Record<string, number> = {};
    tabs.forEach((t: any) => (counts[t.name] = (counts[t.name] || 0) + 1));
    return counts;
  }, [panes, paneId]);

  const isDuplicate = nameCount[tab.name] > 1;
  const displayName = isDuplicate ? `${tab.name} (${tab.path})` : tab.name;

  const [dragOverSide, setDragOverSide] = useState<'left' | 'right' | null>(null);
  const dragOverSideRef = useRef<'left' | 'right' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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
        borderColor: isActive ? `${colors.green}80` : colors.border,
        borderRight: `1px solid ${colors.border}`,
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

      <TabIcon kind={tab.kind} filename={tab.name} size={14} color={colors.foreground} />
      <span
        className="text-sm truncate flex-1"
        style={{ color: colors.foreground }}
        title={displayName}
      >
        {displayName}
      </span>

      {(tab as any).isDirty ? (
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
