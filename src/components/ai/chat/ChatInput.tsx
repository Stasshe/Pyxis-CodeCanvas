// 統合された入力コンポーネント（Ask/Edit共通）

import { FileCode, Loader2, Plus, Send, X } from 'lucide-react';
import React, { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { getIconForFile } from 'vscode-icons-js';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { assetPath } from '@/env';
import { useInputHistory } from '@/hooks/ai/useInputHistory';
import { pushLogMessage } from '@/stores/loggerStore';
import {
  clearChatInputDraft,
  openChatInputDraft,
  updateChatInputDraft,
} from '../../../engine/ide/ai/chat/chatInputDrafts';

interface ChatInputProps {
  mode: 'ask' | 'edit';
  rootPath: string;
  historyStorageKey: string;
  onSubmit: (content: string) => Promise<boolean>;
  isProcessing: boolean;
  selectedFiles?: string[];
  onOpenFileSelector?: () => void;
  disabled?: boolean;
  onRemoveSelectedFile?: (path: string) => void;
  // Active editor/tab file path provided by parent (optional)
  activeTabPath?: string | null;
  // Handler to toggle the active tab as selected file context
  onToggleActiveTabContext?: () => void;
  // Whether the active tab is currently selected/included
  isActiveTabSelected?: boolean;
}

export default function ChatInput({
  mode,
  rootPath,
  historyStorageKey,
  onSubmit,
  isProcessing,
  selectedFiles = [],
  onOpenFileSelector,
  disabled = false,
  onRemoveSelectedFile,
  activeTabPath = null,
  onToggleActiveTabContext,
  isActiveTabSelected = false,
}: ChatInputProps) {
  const { colors } = useTheme();
  const draftSessionRef = useRef<ReturnType<typeof openChatInputDraft> | null>(null);
  if (!draftSessionRef.current) draftSessionRef.current = openChatInputDraft(rootPath);
  const draftSession = draftSessionRef.current;
  const [input, setInput] = useState(draftSession.content);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);
  const inputRevisionRef = useRef(draftSession.revision);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { addToHistory, goToPrevious, goToNext, hasHistory } = useInputHistory({
    maxHistorySize: 100,
    storageKey: historyStorageKey,
  });

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  });

  const handleSubmit = async () => {
    const content = input.trim();
    if (!content || isProcessing || disabled || submitInFlightRef.current) return;

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setSubmissionError(null);
    const inputRevision = inputRevisionRef.current;

    try {
      const accepted = await onSubmit(content);
      if (!accepted) return;

      addToHistory(content, selectedFiles, mode);
      if (inputRevisionRef.current === inputRevision) {
        const revision = clearChatInputDraft(rootPath, draftSession.sessionId, inputRevision);
        if (revision !== null) {
          inputRevisionRef.current = revision;
          setInput('');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ChatInput] Message submission failed:', error);
      pushLogMessage(`Message submission failed: ${message}`, 'error', 'AI');
      setSubmissionError(`Message could not be sent: ${message}`);
    } finally {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const updateInput = (value: string) => {
    const revision = updateChatInputDraft(rootPath, draftSession.sessionId, value);
    if (revision < 0) return;
    inputRevisionRef.current = revision;
    setInput(value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;

    // Ctrl/Cmd + Enter で送信
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    // Alt + 上下キーで履歴ナビゲーション
    if (e.altKey && hasHistory) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const entry = goToPrevious(input);
        if (entry) {
          updateInput(entry.content);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const result = goToNext(input);
        if (typeof result === 'string') {
          updateInput(result);
        } else if (result) {
          updateInput(result.content);
        }
      }
    }
  };

  const { t } = useTranslation();

  function getIconSrcForFile(name: string) {
    try {
      const iconPath = getIconForFile(name) || getIconForFile('');
      if (iconPath?.endsWith('.svg')) {
        return assetPath(`/vscode-icons/${iconPath.split('/').pop()}`);
      }
    } catch {
      // ignore and fallback
    }
    return assetPath('/vscode-icons/file.svg');
  }

  const placeholder = mode === 'ask' ? t('ai.mode.ask') : t('ai.mode.edit');

  return (
    <div
      className="border-t select-none"
      style={{
        borderColor: colors.border,
        background: colors.cardBg,
      }}
    >
      <div className="p-1.5 space-y-1">
        {/* 選択ファイル表示 */}
        {(selectedFiles.length > 0 || activeTabPath) && (
          <div className="flex items-center gap-1 flex-wrap">
            <div className="flex items-center gap-1 text-[10px]" style={{ color: colors.mutedFg }}>
              <FileCode size={10} />
            </div>

            {/* アクティブタブをインラインで表示 */}
            {!isActiveTabSelected && activeTabPath && (
              <div
                key="_active_tab"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '1px 4px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  background: colors.mutedBg,
                  border: `1px dashed ${colors.border}`,
                  color: colors.mutedFg,
                  maxWidth: '100%',
                  lineHeight: 1,
                }}
              >
                <img
                  src={getIconSrcForFile(activeTabPath.split('/').pop() || activeTabPath)}
                  alt="icon"
                  style={{ flex: '0 0 10px', width: 10, height: 10 }}
                />
                <span className="truncate" style={{ maxWidth: 80, display: 'inline-block' }}>
                  {activeTabPath.split('/').pop()}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleActiveTabContext?.()}
                  title={t('ai.context.select') || 'Add'}
                  style={{
                    background: 'transparent',
                    color: colors.mutedFg,
                    border: 'none',
                    padding: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 12,
                    height: 12,
                    marginLeft: 1,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={10} />
                </button>
              </div>
            )}

            {selectedFiles.map(file => {
              const fileName = (file.split('/').pop() as string) || file;
              const iconSrc = getIconSrcForFile(fileName);
              return (
                <div
                  key={file}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '1px 4px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontFamily: 'monospace',
                    background: colors.mutedBg,
                    border: `1px solid ${colors.border}`,
                    color: colors.foreground,
                    maxWidth: '100%',
                    lineHeight: 1,
                  }}
                >
                  <img
                    src={iconSrc}
                    alt="icon"
                    style={{ flex: '0 0 10px', width: 10, height: 10 }}
                  />
                  <span className="truncate" style={{ maxWidth: 80, display: 'inline-block' }}>
                    {fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveSelectedFile?.(file)}
                    title={t('ai.fileContextBar.remove') || 'Remove'}
                    style={{
                      background: 'transparent',
                      color: colors.mutedFg,
                      border: 'none',
                      padding: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 12,
                      height: 12,
                      marginLeft: 1,
                      cursor: 'pointer',
                    }}
                  >
                    <X size={8} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* 入力エリア */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => {
              updateInput(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isProcessing || disabled || isSubmitting}
            className="w-full px-2.5 py-1.5 pr-16 rounded-md border resize-none focus:outline-none focus:ring-1 transition-all text-xs"
            style={{
              background: colors.editorBg,
              color: colors.editorFg,
              borderColor: colors.border,
              minHeight: '36px',
              maxHeight: '150px',
            }}
            rows={1}
          />

          {/* 送信ボタン */}
          <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
            {onOpenFileSelector && (
              <button
                type="button"
                onClick={onOpenFileSelector}
                disabled={isProcessing || disabled || isSubmitting}
                className="p-1 rounded hover:bg-opacity-80 transition-all"
                style={{
                  background: colors.mutedBg,
                  color: colors.mutedFg,
                }}
                title={t('ai.context.select')}
              >
                <FileCode size={14} />
              </button>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim() || isProcessing || disabled || isSubmitting}
              className={`p-1 rounded transition-all ${
                !input.trim() || isProcessing || disabled || isSubmitting
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:opacity-90 shadow-sm'
              }`}
              style={{
                background: colors.accent,
                color: colors.accentFg,
              }}
              title={t('ai.sendTitle')}
            >
              {isProcessing || isSubmitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </button>
          </div>
        </div>

        {submissionError && (
          <div role="alert" className="px-2 text-xs text-red-500">
            {submissionError}
          </div>
        )}

        {/* ヘルプテキスト */}
        <div
          className="flex items-center justify-between text-[10px]"
          style={{ color: colors.mutedFg }}
        >
          <span>{t('ai.hints.enterSend')}</span>
          {hasHistory && <span>{t('ai.hints.history')}</span>}
        </div>
      </div>
    </div>
  );
}
