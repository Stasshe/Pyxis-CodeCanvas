/**
 * FileTree component - High-performance virtualized file tree
 *
 * Features:
 * - Virtualized rendering for large file trees
 * - Sticky folder headers (like VS Code)
 * - Mobile-friendly with touch handlers and grab icons
 * - Drag-and-drop support (internal moves and external file drops)
 * - Context menu with file operations
 */

export { default } from './VirtualizedFileTree';
// Use the shared CustomDragLayer from src/components/DnD/CustomDragLayer.tsx
// for drag preview functionality
export type { FileTreeProps, FlattenedTreeItem, StickyFolder } from './types';
