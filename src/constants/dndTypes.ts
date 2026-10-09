/** Shared drag types used by all drag-and-drop components. */

import type { FileItem } from '@/types/index';

// Tab drag type.
export const DND_TAB = 'TAB';

// File tree drag type.
export const DND_FILE_TREE_ITEM = 'FILE_TREE_ITEM';

// Drag item types.
export interface TabDragItem {
  type: typeof DND_TAB;
  tabId: string;
  fromPaneId: string;
}

export interface FileTreeDragItem {
  type: typeof DND_FILE_TREE_ITEM;
  item: FileItem;
}

export type DragItem = TabDragItem | FileTreeDragItem;
