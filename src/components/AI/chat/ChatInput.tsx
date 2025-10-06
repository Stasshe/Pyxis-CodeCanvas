// 統合された入力コンポーネント（Ask/Edit共通）

'use client';

import React, { useState, KeyboardEvent, useRef, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useInputHistory } from '@/hooks/ai/useInputHistory';
import { Send, Loader2, FileCode } from 'lucide-react';

interface ChatInputProps {
  mode: 'ask' | 'edit';
  onSubmit: (content: string) => void;
  isProcessing: boolean;
  selectedFiles?: string[];
  onOpenFileSelector?: () => void;
  disabled?: boolean;
}

export default function ChatInput({
  mode,
  onSubmit,
  isProcessing,
  selectedFiles = [],
  onOpenFileSelector,
  disabled = false,
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

  const placeholder =
    mode === 'ask'
      ? 'AIに質問やコード相談をしてください...'
      : 'コードの編集指示を入力してください...';

  return (
    <div
      className="border-t"
      style={{
        borderColor: colors.border,
        background: colors.cardBg,
      }}
    >
      <div className="p-3 space-y-2">
        {/* 選択ファイル表示 */}
        {selectedFiles.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className="flex items-center gap-1 text-xs"
              style={{ color: colors.mutedFg }}
            >
              <FileCode size={14} />
              <span>選択中:</span>
            </div>
            {selectedFiles.map((file, index) => (
              <span
                key={index}
                className="px-2 py-1 rounded text-xs font-mono"
                style={{
                  background: colors.mutedBg,
                  border: `1px solid ${colors.border}`,
                  color: colors.foreground,
                }}
              >
                {file.split('/').pop()}
              </span>
            ))}
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
                title="ファイルを選択"
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
              title="送信 (Ctrl+Enter)"
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
          <span>Enter: 改行 / Ctrl+Enter: 送信</span>
          {hasHistory && <span>Alt+↑↓: 履歴</span>}
        </div>
      </div>
    </div>
  );
}
