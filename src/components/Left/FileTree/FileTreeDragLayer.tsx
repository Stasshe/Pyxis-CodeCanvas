import { memo, useMemo } from 'react';
import { useDragLayer } from 'react-dnd';
import { getIconForFile, getIconForFolder } from 'vscode-icons-js';

import { useTheme } from '@/context/ThemeContext';
import type { DragItem } from './types';

/**
 * Custom drag layer component for file/folder drag operations.
 * Shows a floating preview of the dragged item.
 */
const FileTreeDragLayer = memo(function FileTreeDragLayer() {
  const { colors } = useTheme();
  const { isDragging, item, currentOffset } = useDragLayer(monitor => ({
    item: monitor.getItem() as DragItem | null,
    currentOffset: monitor.getSourceClientOffset(),
    isDragging: monitor.isDragging(),
  }));

  const { iconSrc, name, isFolder } = useMemo(() => {
    if (!item?.item) {
      return { iconSrc: '', name: '', isFolder: false };
    }
    const fileItem = item.item;
    const isFolder = fileItem.type === 'folder';
    const iconPath = isFolder
      ? getIconForFolder(fileItem.name) || getIconForFolder('')
      : getIconForFile(fileItem.name) || getIconForFile('');
    const iconSrc =
      iconPath && iconPath.endsWith('.svg')
        ? `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`
        : `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${isFolder ? 'folder.svg' : 'file.svg'}`;
    return { iconSrc, name: fileItem.name, isFolder };
  }, [item?.item?.name, item?.item?.type]);

  if (!isDragging || !item || !currentOffset) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: 9999,
        left: 0,
        top: 0,
        transform: `translate(${currentOffset.x}px, ${currentOffset.y}px)`,
        willChange: 'transform',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: colors.background,
          border: `1px solid ${colors.border}`,
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          fontSize: '13px',
          color: colors.foreground,
          whiteSpace: 'nowrap',
        }}
      >
        <img src={iconSrc} alt={isFolder ? 'folder' : 'file'} style={{ width: 16, height: 16 }} />
        <span>{name}</span>
      </div>
    </div>
  );
});

export default FileTreeDragLayer;
