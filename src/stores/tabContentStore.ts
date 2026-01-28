/**
 * tabContentStore - タブコンテンツの分離ストア
 * 
 * タブの構造（ID、名前、パス等）はtabStateで管理し、
 * 実際のファイルコンテンツはこのストアで管理する。
 * 
 * これにより、コンテンツの変更が page.tsx の再レンダリングを
 * トリガーしなくなる。
 */

import { proxy, subscribe, snapshot } from 'valtio';

// タブIDをキーとしてコンテンツを保持
interface TabContentState {
  contents: Record<string, string>;
  // バイナリコンテンツ用
  bufferContents: Record<string, ArrayBuffer>;
  // ダーティ状態の管理（コンテンツ変更時にフラグを更新）
  dirtyFlags: Record<string, boolean>;
}

export const tabContentStore = proxy<TabContentState>({
  contents: {},
  bufferContents: {},
  dirtyFlags: {},
});

// ---------------------------------------------------------------------------
// コンテンツ操作API
// ---------------------------------------------------------------------------

/**
 * タブのコンテンツを取得
 */
export function getTabContent(tabId: string): string | undefined {
  return tabContentStore.contents[tabId];
}

/**
 * タブのコンテンツを設定（isDirtyフラグも設定）
 */
export function setTabContent(tabId: string, content: string, isDirty = true): void {
  tabContentStore.contents[tabId] = content;
  tabContentStore.dirtyFlags[tabId] = isDirty;
}

/**
 * タブのコンテンツをクリア
 */
export function clearTabContent(tabId: string): void {
  delete tabContentStore.contents[tabId];
  delete tabContentStore.bufferContents[tabId];
  delete tabContentStore.dirtyFlags[tabId];
}

/**
 * タブがダーティかどうか
 */
export function isTabDirty(tabId: string): boolean {
  return tabContentStore.dirtyFlags[tabId] ?? false;
}

/**
 * ダーティフラグをクリア（保存完了時）
 */
export function clearDirtyFlag(tabId: string): void {
  tabContentStore.dirtyFlags[tabId] = false;
}

/**
 * バイナリコンテンツを取得
 */
export function getBufferContent(tabId: string): ArrayBuffer | undefined {
  return tabContentStore.bufferContents[tabId];
}

/**
 * バイナリコンテンツを設定
 */
export function setBufferContent(tabId: string, buffer: ArrayBuffer): void {
  tabContentStore.bufferContents[tabId] = buffer;
}

// ---------------------------------------------------------------------------
// Hooks for React components
// ---------------------------------------------------------------------------

import { useSnapshot } from 'valtio';
import { useMemo } from 'react';

/**
 * 特定タブのコンテンツのみを購読するhook
 * このhookを使うと、対象タブのコンテンツが変わった時のみ再レンダリングされる
 */
export function useTabContent(tabId: string): string | undefined {
  const snap = useSnapshot(tabContentStore);
  return snap.contents[tabId];
}

/**
 * 特定タブのダーティ状態を購読するhook
 */
export function useTabDirtyState(tabId: string): boolean {
  const snap = useSnapshot(tabContentStore);
  return snap.dirtyFlags[tabId] ?? false;
}

/**
 * 特定タブのバッファコンテンツを購読するhook
 */
export function useBufferContent(tabId: string): ArrayBuffer | undefined {
  const snap = useSnapshot(tabContentStore);
  return snap.bufferContents[tabId];
}
