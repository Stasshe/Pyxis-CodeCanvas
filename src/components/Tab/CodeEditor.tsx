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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import CodeMirrorEditor from './text-editor/editors/CodeMirrorEditor';
import MonacoEditor from './text-editor/editors/MonacoEditor';
import { useCharCount } from './text-editor/hooks/useCharCount';
import CharCountDisplay from './text-editor/ui/CharCountDisplay';
import EditorPlaceholder from './text-editor/ui/EditorPlaceholder';

import type { EditorTab } from '@/engine/tabs/types';
import { useKeyBinding } from '@/hooks/keybindings/useKeyBindings';
import { useSettings } from '@/hooks/state/useSettings';
import { saveImmediately, tabState } from '@/stores/tabState';
import type { Project } from '@/types';

interface CodeEditorProps {
  activeTab: EditorTab | undefined;
  bottomPanelHeight: number;
  isBottomPanelVisible: boolean;
  onContentChange: (tabId: string, content: string) => void;
  wordWrapConfig: 'on' | 'off';
  nodeRuntimeOperationInProgress?: boolean;
  currentProject?: Project;
  isCodeMirror?: boolean;
  // 即時ローカル編集反映ハンドラ: 全ペーンの同ファイルタブに対して isDirty を立てる
  onImmediateContentChange?: (tabId: string, content: string) => void;
  // タブがアクティブかどうか（フォーカス制御用）
  isActive?: boolean;
}

export default function CodeEditor({
  activeTab,
  onContentChange,
  nodeRuntimeOperationInProgress = false,
  isCodeMirror = false,
  onImmediateContentChange,
  currentProject,
  wordWrapConfig,
  isActive = false,
}: CodeEditorProps) {
  // プロジェクトIDは優先的に props の currentProject?.id を使い、なければ activeTab の projectId を参照
  const projectId =
    currentProject?.id ||
    (activeTab && 'projectId' in activeTab ? (activeTab as any).projectId : undefined);
  const { settings, updateSettings } = useSettings(projectId);
  const { isContentRestored } = useSnapshot(tabState);

  // コンテンツ復元中かどうかを判定
  const isRestoringContent =
    activeTab &&
    'needsContentRestore' in activeTab &&
    (activeTab as any).needsContentRestore &&
    !isContentRestored;

  const {
    charCount,
    setCharCount,
    selectionCount,
    setSelectionCount,
    showCharCountPopup,
    setShowCharCountPopup,
  } = useCharCount(activeTab?.content);

  const editorHeight = '100%';

  // Mobile / touch device 判定: ポインタが coarse、または画面幅が小さい、または navigator.maxTouchPoints をチェック
  const [isMobileDevice, setIsMobileDevice] = useState(false);
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
      try {
        onImmediateContentChange?.(activeTab.id, value);
      } catch (e) {
        console.error('[CodeEditor] onImmediateContentChange handler failed', e);
      }
    },
    [activeTab, onImmediateContentChange]
  );

  // Ctrl+S で即時保存
  useKeyBinding(
    'saveFile',
    async () => {
      if (!activeTab?.path) return;
      // コンテンツ復元中やランタイム操作中は保存を無視
      if (isRestoringContent) return;
      if (nodeRuntimeOperationInProgress) {
        console.log('[CodeEditor] Save skipped during NodeRuntime operation');
        return;
      }

      try {
        await saveImmediately(activeTab.path);
        console.log('[CodeEditor] Immediate save completed');
      } catch (e) {
        console.error('[CodeEditor] Immediate save failed:', e);
      }
    },
    [activeTab?.path, isRestoringContent, nodeRuntimeOperationInProgress]
  );

  // 折り返しのトグルショートカット登録 (Alt+Z)
  useKeyBinding(
    'toggleWordWrap',
    async () => {
      if (!projectId || !updateSettings) return;
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
    },
    [projectId, settings?.editor?.wordWrap, updateSettings]
  );

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

  // === CodeMirrorエディター ===
  if (isCodeMirror) {
    return (
      <div className="flex-1 min-h-0 relative" style={{ height: editorHeight }}>
        <CodeMirrorEditor
          tabId={activeTab.id}
          fileName={activeTab.name}
          content={activeTab.content}
          onChange={handleEditorChange}
          onSelectionChange={setSelectionCount}
          tabSize={settings?.editor.tabSize ?? 2}
          insertSpaces={settings?.editor.insertSpaces ?? true}
          fontSize={settings?.editor.fontSize ?? 14}
          isActive={isActive}
        />
        <CharCountDisplay
          charCount={charCount}
          selectionCount={selectionCount}
          showCharCountPopup={showCharCountPopup}
          onTogglePopup={() => setShowCharCountPopup(v => !v)}
          onClosePopup={() => setShowCharCountPopup(false)}
          content={activeTab.content || ''}
          alignLeft={isMobileDevice}
        />
      </div>
    );
  }

  // === Monaco Editorエディター（デフォルト）===
  return (
    <div className="flex-1 min-h-0 relative" style={{ height: editorHeight }}>
      <MonacoEditor
        tabId={activeTab.id}
        fileName={activeTab.name}
        content={activeTab.content}
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
      <CharCountDisplay
        charCount={charCount}
        selectionCount={selectionCount}
        showCharCountPopup={showCharCountPopup}
        onTogglePopup={() => setShowCharCountPopup(v => !v)}
        onClosePopup={() => setShowCharCountPopup(false)}
        content={activeTab.content || ''}
        alignLeft={isMobileDevice}
      />
    </div>
  );
}
