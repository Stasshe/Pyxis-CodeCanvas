/**
 * react-dnd用のドラッグタイプ定数
 * 全てのD&D関連コンポーネントで共通で使用
 */

// タブのドラッグタイプ
export const DND_TAB = 'TAB'

// ファイルツリーアイテムのドラッグタイプ
export const DND_FILE_TREE_ITEM = 'FILE_TREE_ITEM'

// ドラッグアイテムの型定義
export interface TabDragItem {
  type: typeof DND_TAB
  tabId: string
  fromPaneId: string
}

export interface FileTreeDragItem {
  type: typeof DND_FILE_TREE_ITEM
  item: {
    id: string
    name: string
    path: string
    type: 'file' | 'folder'
    isBufferArray?: boolean
    [key: string]: any
  }
}

export type DragItem = TabDragItem | FileTreeDragItem

// ドラッグタイプを判定するヘルパー関数
export function isTabDragItem(item: any): item is TabDragItem {
  return item && item.type === DND_TAB && typeof item.tabId === 'string'
}

export function isFileTreeDragItem(item: any): item is FileTreeDragItem {
  return item && item.type === DND_FILE_TREE_ITEM && item.item
}
