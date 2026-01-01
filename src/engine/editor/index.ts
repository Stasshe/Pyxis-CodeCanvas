/**
 * Editor Memory Management
 *
 * 統一的なエディターメモリ管理システム
 * - EditorMemoryManager: シングルトンでコンテンツを一元管理
 * - useEditorMemory: Reactコンポーネントから使用するフック
 */

export { editorMemoryManager } from './EditorMemoryManager';
export type {
  ContentChangeListener,
  EditorMemoryManagerOptions,
  SaveCompleteListener,
} from './EditorMemoryManager';
export { useEditorMemory, useEditorSaveShortcut } from './useEditorMemory';
