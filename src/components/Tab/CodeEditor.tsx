/**
 * CodeEditor - リファクタリング版エディターコンポーネント
 *
 * 責務:
 * - タブの状態判定とルーティング（Monaco/CodeMirror/プレビュー/バイナリ/Welcome）
 * - エディター間の共通インターフェース提供
 *
 * 注意:
 * - デバウンス保存・即時保存は tabState (Valtio) が管理
 * - コンテンツ変更は onImmediateContentChange を通じて tabState に通知
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';
import { normalizePath } from '@/engine/core/fs';
import type { EditorTab } from '@/engine/tabs/types';
import { useKeyBinding } from '@/hooks/keybindings/useKeyBindings';
import { useSettings } from '@/hooks/state/useSettings';
import { useTabContent } from '@/stores/tabContentStore';
import { addSaveListener, saveImmediately, tabState } from '@/stores/tabState';
import type { Project } from '@/types';
import { useCharCount } from './text-editor/hooks/useCharCount';
import CharCountDisplay from './text-editor/ui/CharCountDisplay';
import EditorPlaceholder from './text-editor/ui/EditorPlaceholder';

const CodeMirrorEditor = lazy(() => import('./text-editor/editors/CodeMirrorEditor'));
const MonacoEditor = lazy(() => import('./text-editor/editors/MonacoEditor'));

interface CodeEditorProps {
  activeTab: EditorTab | undefined;
  wordWrapConfig: 'on' | 'off';
  currentProject?: Project;
  isCodeMirror?: boolean;
  // 即時ローカル編集反映ハンドラ: 全ペーンの同ファイルタブに対して isDirty を立てる
  onImmediateContentChange?: (tabId: string, content: string) => void;
  // タブがアクティブかどうか（フォーカス制御用）
  isActive?: boolean;
}

export default function CodeEditor({
  activeTab,
  isCodeMirror = false,
  onImmediateContentChange,
  currentProject,
  wordWrapConfig,
  isActive = false,
}: CodeEditorProps) {
  const rootPath = currentProject?.rootPath;
  const { settings, updateSettings } = useSettings(rootPath);
  const { isContentRestored } = useSnapshot(tabState);
  const needsContentRestore = (
    activeTab as (EditorTab & { needsContentRestore?: boolean }) | undefined
  )?.needsContentRestore;
  const isRestoringContent = needsContentRestore && !isContentRestored;
  const restoreFailed = needsContentRestore && isContentRestored;

  // tabContentStoreからコンテンツを取得（panesを更新せずに再レンダリング）
  const storeContent = useTabContent(activeTab?.id ?? '');
  const content = storeContent ?? '';

  const {
    charCount,
    setCharCount,
    selectionCount,
    setSelectionCount,
    showCharCountPopup,
    setShowCharCountPopup,
  } = useCharCount(content);

  const editorHeight = '100%';

  // Mobile / touch device 判定: ポインタが coarse、または画面幅が小さい、または navigator.maxTouchPoints をチェック
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveErrorRef = useRef<string | null>(null);

  useEffect(() => {
    const filePath = activeTab?.path;
    saveErrorRef.current = null;
    setSaveError(null);
    if (!filePath) return;
    const normalizedPath = normalizePath(filePath);
    return addSaveListener((savedPath, success, error) => {
      if (normalizePath(savedPath) !== normalizedPath) return;
      saveErrorRef.current = success ? null : error?.message || `Failed to save ${filePath}`;
      setSaveError(saveErrorRef.current);
    });
  }, [activeTab?.path]);
  useEffect(() => {
    const updateIsMobile = () => {
      try {
        const hasTouchPoints =
          typeof navigator !== 'undefined' &&
          'maxTouchPoints' in navigator &&
          (navigator.maxTouchPoints || 0) > 0;
        const mqPointer =
          typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(pointer: coarse)')
            : null;
        const mqWidth =
          typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(max-width: 640px)')
            : null;
        const isMobile =
          !!hasTouchPoints || (!!mqPointer && mqPointer.matches) || (!!mqWidth && mqWidth.matches);
        setIsMobileDevice(isMobile);
      } catch (e) {
        console.warn('[CodeEditor.tsx] caught non-fatal error', e);
        setIsMobileDevice(false);
      }
    };

    updateIsMobile();

    const mqPointer =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(pointer: coarse)')
        : null;
    const mqWidth =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(max-width: 640px)')
        : null;

    mqPointer?.addEventListener?.('change', updateIsMobile);
    mqWidth?.addEventListener?.('change', updateIsMobile);

    return () => {
      mqPointer?.removeEventListener?.('change', updateIsMobile);
      mqWidth?.removeEventListener?.('change', updateIsMobile);
    };
  }, []);

  // エディター変更ハンドラー
  // onImmediateContentChange で tabState に通知（デバウンス保存とタブ間同期は tabState が管理）
  const handleEditorChange = useCallback(
    (value: string) => {
      if (!activeTab) return;
      onImmediateContentChange?.(activeTab.id, value);
    },
    [activeTab, onImmediateContentChange]
  );

  // Ctrl+S で即時保存
  useKeyBinding('saveFile', async () => {
    if (!activeTab?.path) return;
    // コンテンツ復元中は保存を無視
    if (isRestoringContent) return;

    try {
      await saveImmediately(activeTab.path);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      saveErrorRef.current = message;
      setSaveError(message);
      console.error('[CodeEditor] Immediate save failed:', e);
    }
  }, [activeTab?.path, isRestoringContent]);

  // 折り返しのトグルショートカット登録 (Alt+Z)
  useKeyBinding('toggleWordWrap', async () => {
    if (!rootPath || !updateSettings) return;
    const current = settings?.editor?.wordWrap ?? false;
    try {
      await updateSettings(prev => ({
        editor: {
          ...(prev?.editor || {}),
          wordWrap: !current,
        },
      }));
    } catch (e) {
      console.error('[CodeEditor] toggleWordWrap failed:', e);
    }
  }, [rootPath, settings?.editor?.wordWrap, updateSettings]);

  const saveErrorNotice = saveError ? (
    <div
      role="alert"
      className="absolute right-2 top-2 z-20 max-w-[80%] truncate rounded bg-red-950/90 px-2 py-1 text-xs text-red-100"
    >
      {saveError}
    </div>
  ) : null;

  // === タブなし ===
  if (!activeTab) {
    return <EditorPlaceholder type="no-tab" />;
  }

  // === コンテンツ復元中 ===
  if (isRestoringContent) {
    return (
      <div
        className="flex-1 min-h-0 relative flex items-center justify-center"
        style={{ height: editorHeight }}
      >
        <div className="text-muted-foreground">Restoring content...</div>
      </div>
    );
  }

  if (restoreFailed) {
    return (
      <div
        role="alert"
        className="flex-1 min-h-0 relative flex items-center justify-center text-sm text-red-500"
        style={{ height: editorHeight }}
      >
        Failed to restore this file. Close and reopen the tab to try again.
      </div>
    );
  }

  // === CodeMirrorエディター ===
  if (isCodeMirror) {
    return (
      <div className="flex-1 min-h-0 relative" style={{ height: editorHeight }}>
        {saveErrorNotice}
        <Suspense fallback={<div className="h-full" />}>
          <CodeMirrorEditor
            tabId={activeTab.id}
            fileName={activeTab.name}
            content={content}
            onChange={handleEditorChange}
            onSelectionChange={setSelectionCount}
            tabSize={settings?.editor.tabSize ?? 2}
            insertSpaces={settings?.editor.insertSpaces ?? true}
            fontSize={settings?.editor.fontSize ?? 14}
            isActive={isActive}
          />
        </Suspense>
        <CharCountDisplay
          charCount={charCount}
          selectionCount={selectionCount}
          showCharCountPopup={showCharCountPopup}
          onTogglePopup={() => setShowCharCountPopup(v => !v)}
          onClosePopup={() => setShowCharCountPopup(false)}
          content={content}
          alignLeft={isMobileDevice}
        />
      </div>
    );
  }

  // === Monaco Editorエディター（デフォルト）===
  return (
    <div className="flex-1 min-h-0 relative" style={{ height: editorHeight }}>
      {saveErrorNotice}
      <Suspense fallback={<div className="h-full" />}>
        <MonacoEditor
          tabId={activeTab.id}
          fileName={activeTab.name}
          filePath={activeTab.path}
          content={content}
          wordWrapConfig={wordWrapConfig}
          jumpToLine={activeTab.jumpToLine}
          jumpToColumn={activeTab.jumpToColumn}
          onChange={handleEditorChange}
          onCharCountChange={setCharCount}
          onSelectionCountChange={setSelectionCount}
          tabSize={settings?.editor.tabSize ?? 2}
          insertSpaces={settings?.editor.insertSpaces ?? true}
          fontSize={settings?.editor.fontSize ?? 14}
          isActive={isActive}
        />
      </Suspense>
      <CharCountDisplay
        charCount={charCount}
        selectionCount={selectionCount}
        showCharCountPopup={showCharCountPopup}
        onTogglePopup={() => setShowCharCountPopup(v => !v)}
        onClosePopup={() => setShowCharCountPopup(false)}
        content={content}
        alignLeft={isMobileDevice}
      />
    </div>
  );
}
