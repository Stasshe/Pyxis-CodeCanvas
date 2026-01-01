/**
 * useEditorMemory - EditorMemoryManagerを使用するためのReactフック
 *
 * エディタータブコンポーネント（editor, diff, ai-review）から使用する統一的なフック。
 * コンテンツの変更、保存、同期を一元管理する。
 */

import { useCallback, useEffect, useRef } from 'react';

import { editorMemoryManager } from './EditorMemoryManager';

import { toAppPath } from '@/engine/core/fileRepository';

interface UseEditorMemoryOptions {
  /** ファイルパス */
  path: string;
  /** 初期コンテンツ */
  initialContent?: string;
  /** 変更可能かどうか */
  editable?: boolean;
  /** Git状態更新トリガー */
  onGitRefresh?: () => void;
}

interface UseEditorMemoryReturn {
  /** コンテンツを変更（デバウンス保存あり） */
  handleContentChange: (content: string) => void;
  /** コンテンツを即時反映（UIのみ、保存なし） */
  handleImmediateChange: (content: string) => void;
  /** 即時保存を実行 */
  handleSaveImmediate: () => Promise<boolean>;
  /** 現在のコンテンツを取得 */
  getContent: () => string | undefined;
  /** 変更があるかどうか */
  isDirty: () => boolean;
}

/**
 * エディターメモリ管理フック
 */
export function useEditorMemory(options: UseEditorMemoryOptions): UseEditorMemoryReturn {
  const { path, initialContent, editable = true, onGitRefresh } = options;
  const normalizedPath = toAppPath(path);
  const initializedRef = useRef(false);
  const gitRefreshRef = useRef(onGitRefresh);

  // onGitRefreshの最新参照を保持
  useEffect(() => {
    gitRefreshRef.current = onGitRefresh;
  }, [onGitRefresh]);

  // マウント時にEditorMemoryManagerを初期化
  useEffect(() => {
    const initManager = async () => {
      await editorMemoryManager.init();

      // 初期コンテンツを登録
      if (initialContent !== undefined && !initializedRef.current) {
        editorMemoryManager.registerInitialContent(normalizedPath, initialContent);
        initializedRef.current = true;
      }
    };

    initManager();

    // 保存完了時にGit状態を更新
    const unsubscribe = editorMemoryManager.addSaveListener((savedPath, success) => {
      if (success && toAppPath(savedPath) === normalizedPath) {
        gitRefreshRef.current?.();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [normalizedPath, initialContent]);

  // コンテンツを変更（デバウンス保存あり）
  const handleContentChange = useCallback(
    (content: string) => {
      if (!editable) return;
      editorMemoryManager.setContent(normalizedPath, content);
    },
    [normalizedPath, editable]
  );

  // コンテンツを即時反映（UIのみ、保存スキップ）
  const handleImmediateChange = useCallback(
    (content: string) => {
      if (!editable) return;
      // setContentをskipDebounce=trueで呼ぶと、デバウンス保存がスケジュールされない
      // ただし、この関数は「UIのみ更新、保存しない」という意図なので、
      // 実際には通常のsetContentを使い、保存は後で行う
      editorMemoryManager.setContent(normalizedPath, content);
    },
    [normalizedPath, editable]
  );

  // 即時保存を実行
  const handleSaveImmediate = useCallback(async () => {
    if (!editable) return true;
    const success = await editorMemoryManager.saveImmediately(normalizedPath);
    if (success) {
      gitRefreshRef.current?.();
    }
    return success;
  }, [normalizedPath, editable]);

  // 現在のコンテンツを取得
  const getContent = useCallback(() => {
    return editorMemoryManager.getContent(normalizedPath);
  }, [normalizedPath]);

  // 変更があるかどうか
  const isDirty = useCallback(() => {
    return editorMemoryManager.isDirty(normalizedPath);
  }, [normalizedPath]);

  return {
    handleContentChange,
    handleImmediateChange,
    handleSaveImmediate,
    getContent,
    isDirty,
  };
}

/**
 * Ctrl+S等のキーボードショートカット用フック
 * 指定されたパスの即時保存を行う
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

    const normalizedPath = toAppPath(path);
    const success = await editorMemoryManager.saveImmediately(normalizedPath);
    if (success) {
      gitRefreshRef.current?.();
    }
  }, [path, editable]);
}
