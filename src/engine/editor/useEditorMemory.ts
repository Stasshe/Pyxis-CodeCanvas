/**
 * useEditorMemory - tabState (Valtio) を使用するReactフック
 *
 * エディタータブコンポーネントから使用する統一的なフック。
 * コンテンツの変更、保存、同期は tabState が一元管理する。
 */

import { useCallback, useEffect, useRef } from 'react';

import { toAppPath } from '@/engine/core/fileRepository';
import {
  addSaveListener,
  getContent as getTabContent,
  initTabSaveSync,
  isDirty as isTabDirty,
  saveImmediately as saveImmediatelyPath,
  setContent as setTabContent,
} from '@/stores/tabState';

interface UseEditorMemoryOptions {
  path: string;
  initialContent?: string;
  editable?: boolean;
  onGitRefresh?: () => void;
}

interface UseEditorMemoryReturn {
  handleContentChange: (content: string) => void;
  handleImmediateChange: (content: string) => void;
  handleSaveImmediate: () => Promise<boolean>;
  getContent: () => string | undefined;
  isDirty: () => boolean;
}

export function useEditorMemory(options: UseEditorMemoryOptions): UseEditorMemoryReturn {
  const { path, editable = true, onGitRefresh } = options;
  const normalizedPath = toAppPath(path);
  const gitRefreshRef = useRef(onGitRefresh);

  useEffect(() => {
    gitRefreshRef.current = onGitRefresh;
  }, [onGitRefresh]);

  useEffect(() => {
    initTabSaveSync();
    const unsub = addSaveListener((savedPath, success) => {
      if (success && toAppPath(savedPath) === normalizedPath) gitRefreshRef.current?.();
    });
    return unsub;
  }, [normalizedPath]);

  const handleContentChange = useCallback(
    (content: string) => {
      if (!editable) return;
      setTabContent(normalizedPath, content);
    },
    [normalizedPath, editable]
  );

  const handleImmediateChange = useCallback(
    (content: string) => {
      if (!editable) return;
      setTabContent(normalizedPath, content);
    },
    [normalizedPath, editable]
  );

  const handleSaveImmediate = useCallback(async () => {
    if (!editable) return true;
    const ok = await saveImmediatelyPath(normalizedPath);
    if (ok) gitRefreshRef.current?.();
    return ok;
  }, [normalizedPath, editable]);

  const getContent = useCallback(() => getTabContent(normalizedPath), [normalizedPath]);
  const isDirty = useCallback(() => isTabDirty(normalizedPath), [normalizedPath]);

  return {
    handleContentChange,
    handleImmediateChange,
    handleSaveImmediate,
    getContent,
    isDirty,
  };
}

/**
 * Ctrl+S用: 指定パスの即時保存
 */
export function useEditorSaveShortcut(
  path: string | undefined,
  editable: boolean,
  onGitRefresh?: () => void
): () => Promise<void> {
  const gitRefreshRef = useRef(onGitRefresh);
  useEffect(() => {
    gitRefreshRef.current = onGitRefresh;
  }, [onGitRefresh]);

  return useCallback(async () => {
    if (!path || !editable) return;
    const ok = await saveImmediatelyPath(toAppPath(path));
    if (ok) gitRefreshRef.current?.();
  }, [path, editable]);
}
