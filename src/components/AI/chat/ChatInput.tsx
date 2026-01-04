// 統合された入力コンポーネント（Ask/Edit共通）

'use client';

import { FileCode, Loader2, Plus, Send } from 'lucide-react';
import React, { useState, type KeyboardEvent, useRef, useEffect } from 'react';
import { getIconForFile } from 'vscode-icons-js';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { useInputHistory } from '@/hooks/ai/useInputHistory';

interface ChatInputProps {
  mode: 'ask' | 'edit';
  onSubmit: (content: string) => void;
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
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { addToHistory, goToPrevious, goToNext, hasHistory } = useInputHistory({
    maxHistorySize: 100,
    storageKey: `ai-chat-history-${mode}`,
  });

  // テキストエリアの高さを自動調整
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    if (input.trim() && !isProcessing && !disabled) {
      addToHistory(input.trim(), selectedFiles, mode);
      onSubmit(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
          setInput(entry.content);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const result = goToNext(input);
        if (typeof result === 'string') {
          setInput(result);
        } else if (result) {
          setInput(result.content);
        }
      }
    }
  };

  const { t } = useTranslation();

  function getIconSrcForFile(name: string) {
    try {
      const iconPath = getIconForFile(name) || getIconForFile('');
      if (iconPath?.endsWith('.svg')) {
        return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`;
      }
    } catch (e) {
      // ignore and fallback
    }
    return `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/file.svg`;
  }

  const placeholder = mode === 'ask' ? t('ai.input.ask') : t('ai.input.edit');

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
                  style={{ width: 10, height: 10, flex: '0 0 10px' }}
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

            {selectedFiles.map((file, index) => {
              const fileName = (file.split('/').pop() as string) || file;
              const iconSrc = getIconSrcForFile(fileName);
              return (
                <div
                  key={index}
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
                    style={{ width: 10, height: 10, flex: '0 0 10px' }}
                  />
                  <span className="truncate" style={{ maxWidth: 80, display: 'inline-block' }}>
                    {fileName}
                  </span>
                  <button
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
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
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
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isProcessing || disabled}
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
                onClick={onOpenFileSelector}
                disabled={isProcessing || disabled}
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
              onClick={handleSubmit}
              disabled={!input.trim() || isProcessing || disabled}
              className={`p-1 rounded transition-all ${
                !input.trim() || isProcessing || disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:opacity-90 shadow-sm'
              }`}
              style={{
                background: colors.accent,
                color: colors.accentFg,
              }}
              title={t('ai.sendTitle')}
            >
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>

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
