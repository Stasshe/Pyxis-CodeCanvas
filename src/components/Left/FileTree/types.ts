import type { ThemeColors } from '@/context/ThemeContext';
import type { FileItem } from '@/types';

export interface FileTreeProps {
  items: FileItem[];
  level?: number;
  currentProjectName: string;
  currentProjectId?: string;
  onRefresh?: () => void;
  isFileSelectModal?: boolean;
  onInternalFileDrop?: (draggedItem: FileItem, targetFolderPath: string) => void;
}

export interface FileTreeItemProps {
  item: FileItem;
  level: number;
  isExpanded: boolean;
  isIgnored: boolean;
  hoveredItemId: string | null;
  colors: ThemeColors;
  currentProjectName: string;
  currentProjectId?: string;
  onRefresh?: () => void;
  onItemClick: (item: FileItem) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem) => void;
  onTouchStart: (e: React.TouchEvent, item: FileItem) => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
  setHoveredItemId: (id: string | null) => void;
  handleNativeFileDrop: (e: React.DragEvent<HTMLDivElement>, targetPath?: string) => void;
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onInternalFileDrop?: (draggedItem: FileItem, targetFolderPath: string) => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  item: FileItem | null;
}

export interface DragItem {
  type: string;
  item: FileItem;
}

export interface FlattenedTreeItem {
  item: FileItem;
  level: number;
  isExpanded: boolean;
  isIgnored: boolean;
  parentPath: string;
}
