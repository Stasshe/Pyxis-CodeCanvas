// AIレビュータブコンポーネント
// Monaco Editorの差分表示を使用して、AI提案の変更を確認・編集できる

import type { Monaco } from '@monaco-editor/react';
import { DiffEditor } from '@monaco-editor/react';
import { Check, X } from 'lucide-react';
import type * as monacoEditor from 'monaco-editor';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { calculateDiff } from '@/engine/ide/ai/diffProcessor';
import { getLanguage } from '@/engine/ide/editor/contentInfo';
import { defineAndSetMonacoThemes } from '@/lib/monaco/monaco-themes';
import type { AIReviewTab as AIReviewTabType, Tab } from '@/types/index';
import { canRollbackAIReview } from '../../../engine/ide/ai/review/actions';
import { detachAndDisposeDiffEditorModels } from '../../../lib/monaco/diffEditorCleanup';

interface AIReviewTabProps {
  tab: Tab;
  onApplyChanges: (
    filePath: string,
    content: string,
    action?: 'apply' | 'rollback'
  ) => Promise<boolean>;
  onDiscardChanges: (filePath: string) => Promise<boolean> | boolean;
  onSuggestedContentChange: (tabId: string, newContent: string) => void;
  onUpdateSuggestedContent: (tabId: string, newContent: string) => Promise<void>;
  onCloseTab?: (filePath: string) => void;
}

export default function AIReviewTab({
  tab,
  onApplyChanges,
  onDiscardChanges,
  onSuggestedContentChange,
  onUpdateSuggestedContent,
  onCloseTab,
}: AIReviewTabProps) {
  const { colors, themeName } = useTheme();
  const { t } = useTranslation();

  // AIReviewTab型にキャスト
  const aiTab = tab as AIReviewTabType;
  const originalContent = aiTab.originalContent || '';
  const suggestedContent = aiTab.suggestedContent || '';
  const filePath = aiTab.filePath || aiTab.path || '';
  // history is shown in AIPanel instead; not used here
  const aiEntry = aiTab.aiEntry || null;

  console.log('[AIReviewTab] Data:', {
    originalContent: originalContent.length,
    suggestedContent: suggestedContent.length,
    filePath,
  });

  // 現在編集中のsuggestedContentを管理（本体には影響しない）
  const [currentSuggestedContent, setCurrentSuggestedContent] = useState(suggestedContent);
  const currentSuggestedContentRef = useRef(suggestedContent);
  const updateSuggestedContentRef = useRef(onUpdateSuggestedContent);
  const saveRevisionRef = useRef(0);
  updateSuggestedContentRef.current = onUpdateSuggestedContent;
  const [saveError, setSaveError] = useState<string | null>(null);

  // DiffEditorとモデルの参照
  const diffEditorRef = useRef<monacoEditor.editor.IStandaloneDiffEditor | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const modelsRef = useRef<{
    original: monacoEditor.editor.ITextModel | null;
    modified: monacoEditor.editor.ITextModel | null;
  }>({ original: null, modified: null });

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        void Promise.resolve(
          updateSuggestedContentRef.current(tab.id, currentSuggestedContentRef.current)
        ).catch(error => {
          console.error('[AIReviewTab] Failed to flush suggested content on close:', error);
        });
      }

      // Detach retained models before disposing them; DiffEditor owns the editor.
      try {
        detachAndDisposeDiffEditorModels(diffEditorRef.current, modelsRef.current);
      } catch (e) {
        console.warn('[AIReviewTab] Failed to detach/dispose diff models:', e);
      }
    };
  }, [tab.id]);

  // originalContentの変更を監視してDiffEditorを更新
  // WDファイルが編集されたときにoriginalContentが更新され、DiffEditorの左側に反映する
  useEffect(() => {
    if (modelsRef.current.original && !modelsRef.current.original.isDisposed()) {
      const currentOriginalValue = modelsRef.current.original.getValue();
      if (currentOriginalValue !== originalContent) {
        console.log('[AIReviewTab] Original content changed, updating DiffEditor');
        modelsRef.current.original.setValue(originalContent);
      }
    }
  }, [originalContent]);

  // suggestedContentの変更を監視してローカル状態を更新
  // 他のAIReviewTabからsuggestedContentが更新されたときに同期する
  useEffect(() => {
    setCurrentSuggestedContent(suggestedContent);
    currentSuggestedContentRef.current = suggestedContent;
    // DiffEditorのmodifiedモデルも更新
    if (modelsRef.current.modified && !modelsRef.current.modified.isDisposed()) {
      const currentModifiedValue = modelsRef.current.modified.getValue();
      if (currentModifiedValue !== suggestedContent) {
        console.log('[AIReviewTab] Suggested content changed externally, updating DiffEditor');
        modelsRef.current.modified.setValue(suggestedContent);
      }
    }
  }, [suggestedContent]);

  const persistImmediately = async (content: string): Promise<boolean> => {
    currentSuggestedContentRef.current = content;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const revision = ++saveRevisionRef.current;
    try {
      await updateSuggestedContentRef.current(tab.id, content);
      if (revision === saveRevisionRef.current) setSaveError(null);
      return true;
    } catch (error) {
      console.error('[AIReviewTab] Failed to save suggested content:', error);
      if (revision === saveRevisionRef.current) {
        setSaveError(error instanceof Error ? error.message : String(error));
      }
      return false;
    }
  };

  const scheduleDraftSave = (content: string): void => {
    currentSuggestedContentRef.current = content;
    setSaveError(null);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      void persistImmediately(content);
    }, 2000);
  };

  // DiffEditorマウント時のハンドラ
  const handleDiffEditorMount = (
    editor: monacoEditor.editor.IStandaloneDiffEditor,
    monaco: Monaco
  ) => {
    diffEditorRef.current = editor;

    // テーマ定義と適用
    try {
      defineAndSetMonacoThemes(monaco, colors, themeName);
    } catch (e) {
      console.warn('[AIReviewTab] Failed to define/set themes:', e);
    }

    // モデルを取得して保存
    const diffModel = editor.getModel();
    if (diffModel) {
      modelsRef.current = {
        original: diffModel.original,
        modified: diffModel.modified,
      };

      // modifiedモデルの変更を監視
      if (diffModel.modified) {
        diffModel.modified.onDidChangeContent(() => {
          const newContent = diffModel.modified.getValue();
          console.log('[AIReviewTab] Content changed in DiffEditor');

          // 即座にステートを更新
          setCurrentSuggestedContent(newContent);
          currentSuggestedContentRef.current = newContent;
          onSuggestedContentChange(tab.id, newContent);

          scheduleDraftSave(newContent);
        });
      }
    }

    // Monaco Editorのアクションを追加
    const modifiedEditor = editor.getModifiedEditor();

    // 選択範囲を元に戻すアクション
    modifiedEditor.addAction({
      id: 'revert-selection',
      label: '選択範囲を元に戻す',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      contextMenuGroupId: 'modification',
      contextMenuOrder: 1,
      run: ed => {
        const selection = ed.getSelection();
        if (!selection || !diffModel?.original || !diffModel?.modified) return;

        const startLine = selection.startLineNumber;
        const endLine = selection.endLineNumber;

        // 元のコンテンツから該当範囲を取得
        const originalLines = diffModel.original.getLinesContent();
        const revertLines = originalLines.slice(startLine - 1, endLine);

        // 現在の内容を取得
        const currentLines = diffModel.modified.getLinesContent();
        const newLines = [
          ...currentLines.slice(0, startLine - 1),
          ...revertLines,
          ...currentLines.slice(endLine),
        ];

        // 新しい内容をセット
        const newContent = newLines.join('\n');
        diffModel.modified.setValue(newContent);
      },
    });

    // 差分を受け入れるアクション（Acceptボタンと同等）
    modifiedEditor.addAction({
      id: 'accept-change',
      label: '変更を受け入れる',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      contextMenuGroupId: 'modification',
      contextMenuOrder: 2,
      run: () => {
        handleApplyAll();
      },
    });
  };

  // 全体適用（suggestedContent -> 本体のcontentへコピー）
  const handleApplyAll = async () => {
    if (!(await persistImmediately(currentSuggestedContentRef.current))) return;
    const applied = await onApplyChanges(filePath, currentSuggestedContentRef.current);
    if (applied === false) return;
    // レビュータブを閉じる
    if (onCloseTab) {
      onCloseTab(filePath);
    }
  };

  // 適用済みを元に戻す（ストレージの originalSnapshot を使って上書き）
  const handleRevertApplied = async () => {
    try {
      if (!canRollbackAIReview(aiEntry)) return;
      // Apply original snapshot
      const applied = await onApplyChanges(filePath, aiEntry.originalSnapshot, 'rollback');
      if (applied === false) return;

      if (onCloseTab) onCloseTab(filePath);
    } catch (e) {
      console.error('[AIReviewTab] revert applied failed', e);
    }
  };

  // 全体破棄（元の内容に戻す）
  const handleDiscardAll = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    void Promise.resolve(onDiscardChanges(filePath)).then(discarded => {
      if (discarded && onCloseTab) onCloseTab(filePath);
    });
  };

  // 元に戻す（suggestedContentをoriginalContentに戻す）
  const handleRevertToOriginal = () => {
    setCurrentSuggestedContent(originalContent);
    currentSuggestedContentRef.current = originalContent;
    onSuggestedContentChange(tab.id, originalContent);
    if (diffEditorRef.current) {
      const diffModel = diffEditorRef.current.getModel();
      if (diffModel?.modified) {
        diffModel.modified.setValue(originalContent);
      }
    }
    void persistImmediately(originalContent);
  };

  // use shared utility to detect language from filename
  const language = getLanguage(filePath);

  if (!originalContent && !suggestedContent) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: colors.mutedFg }}>
        {t('aiReviewTab.notFound')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div
        className="flex flex-col gap-2 p-3 border-b"
        style={{ borderColor: colors.border, background: colors.cardBg }}
      >
        <div className="min-w-0">
          <h3 className="break-words font-semibold" style={{ color: colors.foreground }}>
            AI Review: {filePath.split('/').pop()}
          </h3>
          <p className="mt-1 text-xs" style={{ color: colors.mutedFg, overflowWrap: 'anywhere' }}>
            {filePath}
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <button
            type="button"
            className="min-w-0 whitespace-normal rounded border px-3 py-1.5 text-xs hover:opacity-80 transition-opacity"
            style={{
              background: colors.mutedBg,
              color: colors.foreground,
              borderColor: colors.border,
            }}
            onClick={handleRevertToOriginal}
            title={t('aiReviewTab.discardAllAndRevert')}
          >
            {t('aiReviewTab.revert')}
          </button>
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1.5 whitespace-normal rounded border px-3 py-1.5 text-sm hover:opacity-90 transition-all"
            style={{
              background: colors.green,
              color: '#ffffff',
              borderColor: colors.green,
              fontWeight: 600,
              boxShadow: '0 2px 8px 0 rgba(0,0,0,0.2)',
            }}
            onClick={handleApplyAll}
          >
            <Check size={16} />
            {t('aiReviewTab.applyAll')}
          </button>
          {canRollbackAIReview(aiEntry) && (
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1.5 whitespace-normal rounded border px-3 py-1.5 text-sm hover:opacity-90 transition-all"
              style={{
                background: 'transparent',
                color: colors.foreground,
                borderColor: colors.border,
              }}
              onClick={handleRevertApplied}
              title={t('aiReviewTab.revertApplied')}
            >
              {t('aiReviewTab.revertButton')}
            </button>
          )}
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1.5 whitespace-normal rounded px-3 py-1.5 text-sm hover:opacity-80 transition-opacity"
            style={{ background: colors.red, color: '#ffffff' }}
            onClick={handleDiscardAll}
          >
            <X size={16} />
            {t('aiReviewTab.discard')}
          </button>
        </div>
      </div>

      {/* 統計情報 */}
      <div
        className="px-3 py-2 text-xs border-b"
        style={{
          borderColor: colors.border,
          background: colors.mutedBg,
          color: colors.mutedFg,
        }}
      >
        {(() => {
          try {
            const diffLines = calculateDiff(originalContent, currentSuggestedContent);
            const added = diffLines.filter(l => l.type === 'added').length;
            const removed = diffLines.filter(l => l.type === 'removed').length;
            const unchanged = diffLines.filter(l => l.type === 'unchanged').length;
            const originalCount = unchanged + removed;
            const suggestedCount = unchanged + added;

            return (
              <div className="flex gap-4">
                <span>
                  {t('diff.original')}: {originalCount}
                  {t('diff.lines')}
                </span>
                <span>
                  {t('diff.suggested')}: {suggestedCount}
                  {t('diff.lines')}
                </span>
                <span>
                  {t('diff.diff')}: {suggestedCount - originalCount > 0 ? '+' : ''}
                  {suggestedCount - originalCount}
                  {t('diff.lines')}
                </span>
                <span
                  className="ml-2"
                  style={{
                    color: added > 0 ? 'var(--tw-color-green-500, #16a34a)' : colors.mutedFg,
                  }}
                >
                  +{added}
                </span>
                <span
                  style={{
                    color: removed > 0 ? 'var(--tw-color-red-500, #dc2626)' : colors.mutedFg,
                  }}
                >
                  -{removed}
                </span>
              </div>
            );
          } catch {
            const orig = originalContent.split('\n').length;
            const sug = currentSuggestedContent.split('\n').length;
            return (
              <div className="flex gap-4">
                <span>
                  {t('diff.original')}: {orig}
                  {t('diff.lines')}
                </span>
                <span>
                  {t('diff.suggested')}: {sug}
                  {t('diff.lines')}
                </span>
                <span>
                  {t('diff.diff')}: {sug - orig}
                  {t('diff.lines')}
                </span>
              </div>
            );
          }
        })()}
      </div>

      {/* Monaco DiffEditor */}
      {saveError && (
        <div role="alert" className="px-3 py-2 text-sm" style={{ color: colors.red }}>
          {saveError}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <DiffEditor
          width="100%"
          height="100%"
          language={language}
          original={originalContent}
          modified={currentSuggestedContent}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          theme="pyxis-custom"
          onMount={handleDiffEditorMount}
          options={{
            editContext: false,
            renderSideBySide: true,
            readOnly: false, // 編集可能
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 13,
            wordWrap: 'on',
            lineNumbers: 'on',
            automaticLayout: true,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
            },
            renderOverviewRuler: true,
            diffWordWrap: 'on',
            enableSplitViewResizing: true,
            renderIndicators: true,
            originalEditable: false, // 左側（元）は編集不可
            ignoreTrimWhitespace: false,
          }}
        />
      </div>

      {/* history moved to AIPanel - not rendered here */}

      {/* フッター */}
      <div
        className="p-3 border-t text-xs"
        style={{
          borderColor: colors.border,
          background: colors.cardBg,
          color: colors.mutedFg,
        }}
      >
        <span role="img" aria-label="hint">
          💡
        </span>{' '}
        <b>{t('aiReviewTab.editRightDirectly')}</b>
        {t('aiReviewTab.autoSaveAndApply')}
        <br />
        {t('aiReviewTab.revertSelectionHint')}
      </div>
    </div>
  );
}
