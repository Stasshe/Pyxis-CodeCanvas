/**
 * CodeEditor_new.tsx - リファクタリング版エディターコンポーネント
 *
 * 責務:
 * - タブの状態判定とルーティング（Monaco/CodeMirror/プレビュー/バイナリ/Welcome）
 * - デバウンス保存の制御
 * - エディター間の共通インターフェース提供
 *
 * 保持された機能:
 * - jumpToLine/jumpToColumn
 * - ブレークポイント管理
 * - 文字数カウント
 * - デバウンス保存
 * - モデル管理とundo/redo履歴
 */

import { useRef, useEffect, useCallback } from 'react';
import { useSettings } from '@/hooks/useSettings';
import type { Tab, Project } from '@/types';
import { isBufferArray } from '@/engine/helper/isBufferArray';
import { guessMimeType } from './text-editor/editors/editor-utils';
import { useCharCount } from './text-editor/hooks/useCharCount';
import MarkdownPreviewTab from './MarkdownPreviewTab';
import WelcomeTab from './WelcomeTab';
import BinaryTabContent from './BinaryTabContent';
import MonacoEditor from './text-editor/editors/MonacoEditor';
import CodeMirrorEditor from './text-editor/editors/CodeMirrorEditor';
import CharCountDisplay from './text-editor/ui/CharCountDisplay';
import EditorPlaceholder from './text-editor/ui/EditorPlaceholder';

interface CodeEditorProps {
  activeTab: Tab | undefined;
  bottomPanelHeight: number;
  isBottomPanelVisible: boolean;
  onContentChange: (tabId: string, content: string) => void;
  wordWrapConfig: 'on' | 'off';
  onContentChangeImmediate: (tabId: string, content: string) => void;
  nodeRuntimeOperationInProgress?: boolean;
  currentProject?: Project;
  isCodeMirror?: boolean;
}

export default function CodeEditor({
  activeTab,
  onContentChange,
  onContentChangeImmediate,
  nodeRuntimeOperationInProgress = false,
  isCodeMirror = false,
  currentProject,
  wordWrapConfig,
}: CodeEditorProps) {
  // プロジェクトIDは優先的に props の currentProject?.id を使い、なければ activeTab の projectId を参照
  const projectId = currentProject?.id || (activeTab as any)?.projectId || undefined;
  const { settings } = useSettings(projectId);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    charCount,
    setCharCount,
    selectionCount,
    setSelectionCount,
    showCharCountPopup,
    setShowCharCountPopup,
  } = useCharCount(activeTab?.content);

  const editorHeight = '100%';

  // デバウンス付きの保存関数（5秒）
  const debouncedSave = useCallback(
    (tabId: string, content: string) => {
      if (nodeRuntimeOperationInProgress) {
        console.log('[CodeEditor_new] Skipping debounced save during NodeRuntime operation');
        return;
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      const currentTabId = tabId;
      const currentContent = content;

      saveTimeoutRef.current = setTimeout(() => {
        console.log('[CodeEditor_new] Debounced save triggered for:', currentTabId);
        onContentChange(currentTabId, currentContent);
      }, 5000);
    },
    [onContentChange, nodeRuntimeOperationInProgress]
  );

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // エディター変更ハンドラー（即座の状態更新 + デバウンス保存）
  const handleEditorChange = useCallback(
    (value: string) => {
      if (!activeTab) return;
      // 1. 即時反映: 必ず最初に呼ぶ
      if (onContentChangeImmediate) {
        try {
          onContentChangeImmediate(activeTab.id, value);
        } catch (error: any) {
          console.error('[CodeEditor_new] Error in onContentChangeImmediate:', error);
        }
      }
      // 2. デバウンス保存: 保存のみ担う
      debouncedSave(activeTab.id, value);
    },
    [activeTab, onContentChangeImmediate, debouncedSave]
  );

  // === タブなし ===
  if (!activeTab) {
    return <EditorPlaceholder type="no-tab" />;
  }

  // === コンテンツ復元中 ===
  if (activeTab.needsContentRestore) {
    return (
      <EditorPlaceholder
        type="loading"
        message="ファイル内容を復元中..."
      />
    );
  }

  // === バイナリファイル ===
  if (isBufferArray((activeTab as any).bufferContent)) {
    return (
      <BinaryTabContent
        activeTab={activeTab}
        editorHeight={editorHeight}
        guessMimeType={guessMimeType}
        isBufferArray={isBufferArray}
      />
    );
  }

  // === Welcomeタブ ===
  if (activeTab.id === 'welcome') {
    return (
      <div
        className="flex-1 min-h-0"
        style={{ height: editorHeight }}
      >
        <WelcomeTab />
      </div>
    );
  }

  // === Markdownプレビュー ===
  if (activeTab.preview) {
    console.log(
      '[CodeEditor_new] Rendering Markdown preview for:',
      activeTab.name,
      activeTab.path,
      currentProject?.name
    );
    console.log('[CodeEditor_new] Current project files:', currentProject);
    console.log('[CodeEditor_new] activeTab:', activeTab);
    return (
      <div
        className="flex-1 min-h-0"
        style={{ height: editorHeight }}
      >
        <MarkdownPreviewTab
          activeTab={activeTab}
          currentProject={currentProject}
        />
      </div>
    );
  }

  // === CodeMirrorエディター ===
  if (isCodeMirror) {
    return (
      <div
        className="flex-1 min-h-0 relative"
        style={{ height: editorHeight }}
      >
        <CodeMirrorEditor
          tabId={activeTab.id}
          fileName={activeTab.name}
          content={activeTab.content}
          onChange={handleEditorChange}
          onSelectionChange={setSelectionCount}
          tabSize={settings?.editor.tabSize ?? 2}
          insertSpaces={settings?.editor.insertSpaces ?? true}
        />
        <CharCountDisplay
          charCount={charCount}
          selectionCount={selectionCount}
          showCharCountPopup={showCharCountPopup}
          onTogglePopup={() => setShowCharCountPopup(v => !v)}
          onClosePopup={() => setShowCharCountPopup(false)}
          content={activeTab.content || ''}
        />
      </div>
    );
  }

  // === Monaco Editorエディター（デフォルト）===
  return (
    <div
      className="flex-1 min-h-0 relative"
      style={{ height: editorHeight }}
    >
      <MonacoEditor
        tabId={activeTab.id}
        fileName={activeTab.name}
        content={activeTab.content}
        wordWrapConfig={wordWrapConfig}
        jumpToLine={(activeTab as any).jumpToLine}
        jumpToColumn={(activeTab as any).jumpToColumn}
        onChange={handleEditorChange}
        onCharCountChange={setCharCount}
        onSelectionCountChange={setSelectionCount}
        tabSize={settings?.editor.tabSize ?? 2}
        insertSpaces={settings?.editor.insertSpaces ?? true}
      />
      <CharCountDisplay
        charCount={charCount}
        selectionCount={selectionCount}
        showCharCountPopup={showCharCountPopup}
        onTogglePopup={() => setShowCharCountPopup(v => !v)}
        onClosePopup={() => setShowCharCountPopup(false)}
        content={activeTab.content || ''}
      />
    </div>
  );
}
