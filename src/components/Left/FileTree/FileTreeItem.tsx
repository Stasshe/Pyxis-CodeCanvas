import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import React, { memo, useEffect, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js';

import { DND_FILE_TREE_ITEM } from '@/constants/dndTypes';
import type { FileItem } from '@/types';
import type { DragItem, FileTreeItemProps } from './types';

/**
 * Individual file tree item component with drag-and-drop support.
 * Handles both desktop (full row draggable) and mobile (grab handle) interactions.
 */

function getFolderIconSrc(name: string, isExpanded: boolean) {
  const iconPath = isExpanded
    ? getIconForOpenFolder(name) || getIconForFolder(name) || getIconForFolder('')
    : getIconForFolder(name) || getIconForFolder('');
  if (iconPath?.endsWith('.svg')) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`;
  }
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/folder.svg`;
}

function getFileIconSrc(name: string) {
  const iconPath = getIconForFile(name) || getIconForFile('');
  if (iconPath?.endsWith('.svg')) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`;
  }
  return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/file.svg`;
}

function FileTreeItem({
  item,
  level,
  isExpanded,
  isIgnored,
  colors,
  onItemClick,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  onInternalFileDrop,
  isTouchDevice,
}: FileTreeItemProps & { isTouchDevice?: boolean }) {
  const [dropIndicator, setDropIndicator] = useState<boolean>(false);
  const [hovered, setHovered] = useState<boolean>(false);
  const isDev = process.env.NEXT_PUBLIC_IS_DEV_SERVER === 'true';

  // Drag source
  const [{ isDragging }, drag, preview] = useDrag(
    () => ({
      type: DND_FILE_TREE_ITEM,
      item: () => {
        if (isDev) {
          console.log('[FileTreeItem] DRAG START', { item: item.name, path: item.path });
        }
        return { type: DND_FILE_TREE_ITEM, item };
      },
      collect: monitor => ({
        isDragging: monitor.isDragging(),
      }),
      end: (draggedItem, monitor) => {
        if (isDev) {
          console.log('[FileTreeItem] DRAG END', {
            didDrop: monitor.didDrop(),
            dropResult: monitor.getDropResult(),
          });
        }
      },
    }),
    [item, isDev]
  );

  // Use empty image for custom drag preview
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  // Drop target (folders only)
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: DND_FILE_TREE_ITEM,
      canDrop: (dragItem: DragItem, monitor) => {
        if (item.type !== 'folder') return false;
        if (dragItem.item.id === item.id) return false;
        if (item.path.startsWith(`${dragItem.item.path}/`)) return false;
        const draggedParent =
          dragItem.item.path.substring(0, dragItem.item.path.lastIndexOf('/')) || '/';
        if (draggedParent === item.path) return false;
        return true;
      },
      drop: (dragItem: DragItem, monitor) => {
        if (isDev) {
          console.log('[FileTreeItem] DROP EVENT', {
            target: item.path,
            dragged: dragItem.item.path,
            didDrop: monitor.didDrop(),
            isOver: monitor.isOver({ shallow: true }),
          });
        }
        if (monitor.didDrop()) {
          return;
        }
        if (onInternalFileDrop && item.type === 'folder') {
          if (isDev) {
            console.log('[FileTreeItem] Calling onInternalFileDrop');
          }
          onInternalFileDrop(dragItem.item, item.path);
          return { handled: true };
        }
        return undefined;
      },
      collect: monitor => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [item, onInternalFileDrop, isDev]
  );

  // Combine drag and drop refs
  const attachRef = (el: HTMLDivElement | null) => {
    drop(el);
    if (!isTouchDevice) {
      drag(el);
    }
  };

  const grabHandleRef = (el: HTMLDivElement | null) => {
    if (isTouchDevice && el) {
      drag(el);
    }
  };

  useEffect(() => {
    setDropIndicator(isOver && canDrop);
  }, [isOver, canDrop]);

  return (
    <div
      ref={attachRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.15rem 0.2rem',
        cursor: isTouchDevice ? 'pointer' : isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        position: 'relative',
        background: dropIndicator ? colors.accentBg : hovered ? colors.accentBg : 'transparent',
        marginLeft: `${level * 12}px`,
        touchAction: 'pan-y', // Allow vertical scrolling on touch devices
        opacity: isDragging ? 0.5 : 1,
        border: dropIndicator
          ? `1px dashed ${colors.primary || '#007acc'}`
          : '1px solid transparent',
        height: '24px',
        boxSizing: 'border-box',
      }}
      onClick={() => onItemClick(item)}
      onContextMenu={e => onContextMenu(e, item)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={e => {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-grab-handle]')) {
          onTouchStart(e, item);
        }
        setHovered(true);
      }}
      onTouchEnd={() => {
        onTouchEnd();
        setHovered(false);
      }}
      onTouchMove={() => {
        onTouchMove();
        setHovered(false);
      }}
      onTouchCancel={() => {
        onTouchEnd();
        setHovered(false);
      }}
    >
      {item.type === 'folder' ? (
        <>
          {isExpanded ? (
            <ChevronDown size={14} color={colors.mutedFg} />
          ) : (
            <ChevronRight size={14} color={colors.mutedFg} />
          )}
          <img
            src={getFolderIconSrc(item.name, isExpanded)}
            alt="folder"
            style={{
              width: 16,
              height: 16,
              verticalAlign: 'middle',
              opacity: isIgnored ? 0.55 : 1,
            }}
          />
        </>
      ) : (
        <>
          <div className="w-3.5" />
          <img
            src={getFileIconSrc(item.name)}
            alt="file"
            style={{
              width: 16,
              height: 16,
              verticalAlign: 'middle',
              opacity: isIgnored ? 0.55 : 1,
            }}
          />
        </>
      )}
      <span
        style={{
          fontSize: '0.875rem',
          color: isIgnored ? colors.mutedFg : colors.foreground,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          userSelect: 'none',
          flex: 1,
        }}
      >
        {item.name}
      </span>

      {/* Grab handle for touch devices */}
      {isTouchDevice && (
        <div
          ref={grabHandleRef}
          data-grab-handle="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
            marginLeft: 'auto',
            cursor: 'grab',
            touchAction: 'none',
            opacity: 0.6,
          }}
          onTouchStart={e => {
            e.stopPropagation();
          }}
        >
          <GripVertical size={14} color={colors.mutedFg} />
        </div>
      )}
    </div>
  );
}

function arePropsEqual(prev: any, next: any) {
  return (
    prev.item?.id === next.item?.id &&
    prev.level === next.level &&
    prev.isExpanded === next.isExpanded &&
    prev.isIgnored === next.isIgnored &&
    prev.isTouchDevice === next.isTouchDevice &&
    prev.onItemClick === next.onItemClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onTouchStart === next.onTouchStart &&
    prev.onTouchEnd === next.onTouchEnd &&
    prev.onTouchMove === next.onTouchMove &&
    prev.onInternalFileDrop === next.onInternalFileDrop &&
    prev.colors?.foreground === next.colors?.foreground &&
    prev.colors?.mutedFg === next.colors?.mutedFg &&
    prev.colors?.accentBg === next.colors?.accentBg &&
    prev.colors?.primary === next.colors?.primary
  );
}

export default memo(FileTreeItem, arePropsEqual);
