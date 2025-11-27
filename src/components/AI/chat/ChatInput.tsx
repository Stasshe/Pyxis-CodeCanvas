// 統合された入力コンポーネント（Ask/Edit共通）

'use client';

import { Send, Loader2, FileCode, Plus } from 'lucide-react';
import { getIconForFile } from 'vscode-icons-js';
import React, { useState, KeyboardEvent, useRef, useEffect } from 'react';

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
      if (iconPath && iconPath.endsWith('.svg')) {
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
      <div className="p-3 space-y-2">
        {/* 選択ファイル表示 */}
        {(selectedFiles.length > 0 || activeTabPath) && (
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className="flex items-center gap-1 text-xs"
              style={{ color: colors.mutedFg }}
            >
              <FileCode size={14} />
              <span>{t('ai.selectedLabel')}</span>
            </div>

            {/* アクティブタブをインラインで表示（選択ファイルの先頭）
                ただし既に選択済みなら候補表示は不要なので非表示にする */}
            {!isActiveTabSelected && activeTabPath && (
              <div
                key="_active_tab"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 6px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  background: colors.mutedBg,
                  border: `1px solid ${colors.border}`,
                  color: colors.foreground,
                  maxWidth: '100%',
                  lineHeight: 1,
                }}
              >
                <img src={getIconSrcForFile(activeTabPath.split('/').pop() || activeTabPath)} alt="icon" style={{ width: 12, height: 12, flex: '0 0 12px' }} />
                <span className="truncate" style={{ maxWidth: 96, display: 'inline-block' }}>
                  {activeTabPath.split('/').pop()}
                </span>
                <button
                  onClick={() => onToggleActiveTabContext?.()}
                  title={isActiveTabSelected ? (t('ai.fileContextBar.remove') || 'Remove') : (t('ai.context.select') || 'Add')}
                  style={{
                    background: 'transparent',
                    color: '#ffffff',
                    border: `1px solid ${colors.border}`,
                    padding: 2,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 18,
                    height: 18,
                    marginLeft: 2,
                    borderRadius: 4,
                  }}
                >
                  <Plus size={12} color="#ffffff" />
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
                    gap: 6,
                    padding: '2px 6px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    background: colors.mutedBg,
                    border: `1px solid ${colors.border}`,
                    color: colors.foreground,
                    maxWidth: '100%',
                    lineHeight: 1,
                  }}
                >
                  <img src={iconSrc} alt="icon" style={{ width: 12, height: 12, flex: '0 0 12px' }} />
                  <span className="truncate" style={{ maxWidth: 96, display: 'inline-block' }}>
                    {fileName}
                  </span>
                  <button
                    onClick={() => onRemoveSelectedFile?.(file)}
                    title={t('ai.fileContextBar.remove') || 'Remove'}
                    style={{
                      background: 'transparent',
                      color: colors.mutedFg,
                      border: 'none',
                      padding: 2,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 18,
                      height: 18,
                      marginLeft: 2,
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
            className="w-full px-4 py-3 pr-24 rounded-lg border resize-none focus:outline-none focus:ring-2 transition-all"
            style={{
              background: colors.editorBg,
              color: colors.editorFg,
              borderColor: colors.border,
              minHeight: '48px',
              maxHeight: '200px',
            }}
            rows={1}
          />

          {/* 送信ボタン */}
          <div className="absolute right-2 bottom-2 flex items-center gap-2">
            {onOpenFileSelector && (
              <button
                onClick={onOpenFileSelector}
                disabled={isProcessing || disabled}
                className="p-2 rounded-md hover:bg-opacity-80 transition-all"
                style={{
                  background: colors.mutedBg,
                  color: colors.mutedFg,
                }}
                title={t('ai.context.select')}
              >
                <FileCode size={18} />
              </button>
            )}

            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isProcessing || disabled}
              className={`p-2 rounded-md transition-all ${
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
              {isProcessing ? (
                <Loader2
                  size={18}
                  className="animate-spin"
                />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
        </div>

        {/* ヘルプテキスト */}
        <div
          className="flex items-center justify-between text-xs"
          style={{ color: colors.mutedFg }}
        >
          <span>{t('ai.hints.enterSend')}</span>
          {hasHistory && <span>{t('ai.hints.history')}</span>}
        </div>
      </div>
    </div>
  );
}
