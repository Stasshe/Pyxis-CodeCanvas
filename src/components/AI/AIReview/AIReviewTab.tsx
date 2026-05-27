// AIレビュータブコンポーネント
// Monaco Editorの差分表示を使用して、AI提案の変更を確認・編集できる

'use client';

import { DiffEditor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { Check, X } from 'lucide-react';
import type * as monacoEditor from 'monaco-editor';
import React, { useState, useRef, useEffect } from 'react';

import { getLanguage } from '@/components/Tab/text-editor/editors/editor-utils';
import { defineAndSetMonacoThemes } from '@/components/Tab/text-editor/editors/monaco-themes';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { calculateDiff } from '@/engine/ai/diffProcessor';
import type { AIReviewTab as AIReviewTabType, Tab } from '@/types';

interface AIReviewTabProps {
  tab: Tab;
  onApplyChanges: (filePath: string, content: string) => void;
  onDiscardChanges: (filePath: string) => void;
  onUpdateSuggestedContent?: (tabId: string, newContent: string) => void;
  onCloseTab?: (filePath: string) => void;
}

export default function AIReviewTab({
  tab,
  onApplyChanges,
  onDiscardChanges,
  onUpdateSuggestedContent,
  onCloseTab,
}: AIReviewTabProps) {
  const { colors, themeName } = useTheme();
  const { t } = useTranslation();

  console.log('[AIReviewTab] Rendering with tab:', tab);

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

  // DiffEditorとモデルの参照
  const diffEditorRef = useRef<monacoEditor.editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<{
    original: monacoEditor.editor.ITextModel | null;
    modified: monacoEditor.editor.ITextModel | null;
  }>({ original: null, modified: null });

  // デバウンス保存用のタイマー
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  if (!originalContent && !suggestedContent) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: colors.mutedFg }}>
        {t('aiReviewTab.notFound')}
      </div>
    );
  }

  // クリーンアップ
  useEffect(() => {
    return () => {
      // デバウンスタイマーをクリア
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // エディタをリセットしてからモデルを破棄
      if (diffEditorRef.current) {
        try {
          diffEditorRef.current.setModel(null);
        } catch (e) {
          console.warn('[AIReviewTab] Failed to reset editor:', e);
        }
        try {
          diffEditorRef.current.dispose();
        } catch (e) {
          console.warn('[AIReviewTab] Failed to dispose editor:', e);
        }
      }

      // モデルを破棄
      try {
        if (modelsRef.current.original && !modelsRef.current.original.isDisposed()) {
          modelsRef.current.original.dispose();
        }
        if (modelsRef.current.modified && !modelsRef.current.modified.isDisposed()) {
          modelsRef.current.modified.dispose();
        }
      } catch (e) {
        console.warn('[AIReviewTab] Failed to dispose models:', e);
      }
    };
  }, []);

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
    // DiffEditorのmodifiedモデルも更新
    if (modelsRef.current.modified && !modelsRef.current.modified.isDisposed()) {
      const currentModifiedValue = modelsRef.current.modified.getValue();
      if (currentModifiedValue !== suggestedContent) {
        console.log('[AIReviewTab] Suggested content changed externally, updating DiffEditor');
        modelsRef.current.modified.setValue(suggestedContent);
      }
    }
  }, [suggestedContent]);

  // デバウンス付き保存関数
  const debouncedSave = (content: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      console.log('[AIReviewTab] Debounced save triggered');
      if (onUpdateSuggestedContent) {
        onUpdateSuggestedContent(tab.id, content);
      }
    }, 2000); // 2秒のデバウンス
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

          // デバウンス保存をトリガー
          debouncedSave(newContent);
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
  const handleApplyAll = () => {
    onApplyChanges(filePath, currentSuggestedContent);
    // レビュータブを閉じる
    if (onCloseTab) {
      onCloseTab(filePath);
    }
  };

  // 適用済みを元に戻す（ストレージの originalSnapshot を使って上書き）
  const handleRevertApplied = async () => {
    try {
      if (!aiEntry || !aiEntry.originalSnapshot) return;
      // Apply original snapshot
      await onApplyChanges(filePath, aiEntry.originalSnapshot);

      // mark entry as reverted and push history
      try {
        const { updateAIReviewEntry } = await import('@/engine/storage/aiStorageAdapter');
        const hist = aiEntry.history || [];
        const historyEntry = {
          id: `revert-${Date.now()}`,
          timestamp: new Date(),
          content: aiEntry.originalSnapshot,
          note: 'reverted',
        };
        await updateAIReviewEntry(aiEntry.projectId, filePath, {
          status: 'reverted',
          history: [historyEntry, ...hist],
        });
      } catch (e) {
        console.warn('[AIReviewTab] Failed to mark AI review entry as reverted', e);
      }

      if (onCloseTab) onCloseTab(filePath);
    } catch (e) {
      console.error('[AIReviewTab] revert applied failed', e);
    }
  };

  // 全体破棄（元の内容に戻す）
  const handleDiscardAll = () => {
    onDiscardChanges(filePath);
    // レビュータブを閉じる
    if (onCloseTab) {
      onCloseTab(filePath);
    }
  };

  // 元に戻す（suggestedContentをoriginalContentに戻す）
  const handleRevertToOriginal = () => {
    setCurrentSuggestedContent(originalContent);
    if (diffEditorRef.current) {
      const diffModel = diffEditorRef.current.getModel();
      if (diffModel?.modified) {
        diffModel.modified.setValue(originalContent);
      }
    }
    if (onUpdateSuggestedContent) {
      onUpdateSuggestedContent(tab.id, originalContent);
    }
  };

  // use shared utility to detect language from filename
  const language = getLanguage(filePath);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between p-3 border-b"
        style={{ borderColor: colors.border, background: colors.cardBg }}
      >
        <div>
          <h3 className="font-semibold" style={{ color: colors.foreground }}>
            AI Review: {filePath.split('/').pop()}
          </h3>
          <p className="text-xs mt-1" style={{ color: colors.mutedFg }}>
            {filePath}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded border hover:opacity-80 transition-opacity"
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
            className="px-3 py-1.5 text-sm rounded border hover:opacity-90 transition-all inline-flex items-center gap-1.5"
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
          {aiEntry?.originalSnapshot && (
            <button
              type="button"
              className="px-3 py-1.5 text-sm rounded border hover:opacity-90 transition-all inline-flex items-center gap-1.5"
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
            className="px-3 py-1.5 text-sm rounded hover:opacity-80 transition-opacity inline-flex items-center gap-1.5"
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
          } catch (e) {
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
      <div className="flex-1 min-h-0">
        <DiffEditor
          width="100%"
          height="100%"
          language={language}
          original={originalContent}
          modified={currentSuggestedContent}
          theme="pyxis-custom"
          onMount={handleDiffEditorMount}
          options={{
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
