'use client';

import React, { useState, KeyboardEvent, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useInputHistory } from '@/hooks/useInputHistory';
import { Send } from 'lucide-react';

interface EditRequestFormProps {
  mode: 'chat' | 'edit';
  onSubmit: (content: string) => void;
  isProcessing: boolean;
  placeholder?: string;
  selectedFiles?: string[];
  onFileSelect?: (files: string[]) => void;
  availableFiles?: string[];
}

export default function EditRequestForm({ 
  mode, 
  onSubmit, 
  isProcessing, 
  placeholder,
  selectedFiles = [],
  onFileSelect,
  availableFiles = []
}: EditRequestFormProps) {
  const { colors } = useTheme();
  const [input, setInput] = useState('');
  
  const {
    addToHistory,
    goToPrevious,
    goToNext,
    getCurrentEntry,
    hasHistory,
    canGoBack,
    canGoForward
  } = useInputHistory({
    maxHistorySize: 100,
    storageKey: `ai-input-history-${mode}`
  });

  // 履歴エントリからファイルの存在をチェックし、有効なファイルのみを返す
  const validateAndFilterFiles = (files: string[]): string[] => {
    return files.filter(file => availableFiles.includes(file));
  };

  const handleSubmit = () => {
    if (input.trim() && !isProcessing) {
      // 履歴に追加
      addToHistory(input.trim(), selectedFiles, mode);
      onSubmit(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enterで送信
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
    // 履歴ナビゲーション（Alt + 上下キー）
    if (e.altKey && hasHistory) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const entry = goToPrevious(input);
        if (entry) {
          setInput(entry.content);
          // ファイル選択も復元（存在するファイルのみ）
          if (onFileSelect && entry.selectedFiles.length > 0) {
            const validFiles = validateAndFilterFiles(entry.selectedFiles);
            if (validFiles.length > 0) {
              onFileSelect(validFiles);
            }
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const result = goToNext(input);
        if (typeof result === 'string') {
          // 一時保存された入力に戻る
          setInput(result);
        } else if (result) {
          // 次の履歴エントリ
          setInput(result.content);
          // ファイル選択も復元（存在するファイルのみ）
          if (onFileSelect && result.selectedFiles.length > 0) {
            const validFiles = validateAndFilterFiles(result.selectedFiles);
            if (validFiles.length > 0) {
              onFileSelect(validFiles);
            }
          }
        }
      }
    }
  };

  return (
    <div 
      className="p-2 border-t select-none"
      style={{ borderColor: colors.border }}
    >
      <div className="flex flex-col gap-1.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (mode === 'chat' 
            ? 'メッセージを入力...' 
            : 'コメントを追加してください、console.logを追加してください、型注釈を追加してください...'
          )}
          className="w-full p-2 text-xs rounded border resize-none focus:outline-none focus:ring-1"
          style={{
            background: colors.editorBg,
            color: colors.editorFg,
            borderColor: colors.border
          }}
          rows={2}
          disabled={isProcessing}
        />
        
        <div className="flex justify-between items-center">
          <div 
            className="text-xs flex items-center gap-2"
            style={{ color: colors.mutedFg }}
          >
            <span>
              {'Enter: 改行, Ctrl+Enter: 送信'}
            </span>
            {hasHistory && (
              <span className="flex items-center gap-1">
                <span>|</span>
                <span>Alt+↑↓: 履歴</span>
              </span>
            )}
          </div>
          
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className={`px-2 py-1 text-xs rounded font-medium ${
              !input.trim() || isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
            style={{
              background: colors.accent
            }}
          >
            {isProcessing ? (
              <div className="flex items-center gap-1">
                <div 
                  className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: `${colors.background} transparent ${colors.background} ${colors.background}` }}
                ></div>
                処理中...
              </div>
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}// 編集依頼・チャット入力フォーム

'use client';

import React, { useState, KeyboardEvent, useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useInputHistory } from '@/hooks/useInputHistory';
import { Send } from 'lucide-react';

interface EditRequestFormProps {
  mode: 'chat' | 'edit';
  onSubmit: (content: string) => void;
  isProcessing: boolean;
  placeholder?: string;
  selectedFiles?: string[];
  onFileSelect?: (files: string[]) => void;
  availableFiles?: string[];
}

export default function EditRequestForm({ 
  mode, 
  onSubmit, 
  isProcessing, 
  placeholder,
  selectedFiles = [],
  onFileSelect,
  availableFiles = []
}: EditRequestFormProps) {
  const { colors } = useTheme();
  const [input, setInput] = useState('');
  
  const {
    addToHistory,
    goToPrevious,
    goToNext,
    getCurrentEntry,
    hasHistory,
    canGoBack,
    canGoForward
  } = useInputHistory({
    maxHistorySize: 100,
    storageKey: `ai-input-history-${mode}`
  });

  // 履歴エントリからファイルの存在をチェックし、有効なファイルのみを返す
  const validateAndFilterFiles = (files: string[]): string[] => {
    return files.filter(file => availableFiles.includes(file));
  };

  const handleSubmit = () => {
    if (input.trim() && !isProcessing) {
      // 履歴に追加
      addToHistory(input.trim(), selectedFiles, mode);
      onSubmit(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enterで送信
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
    // 履歴ナビゲーション（Alt + 上下キー）
    if (e.altKey && hasHistory) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const entry = goToPrevious(input);
        if (entry) {
          setInput(entry.content);
          // ファイル選択も復元（存在するファイルのみ）
          if (onFileSelect && entry.selectedFiles.length > 0) {
            const validFiles = validateAndFilterFiles(entry.selectedFiles);
            if (validFiles.length > 0) {
              onFileSelect(validFiles);
            }
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const result = goToNext(input);
        if (typeof result === 'string') {
          // 一時保存された入力に戻る
          setInput(result);
        } else if (result) {
          // 次の履歴エントリ
          setInput(result.content);
          // ファイル選択も復元（存在するファイルのみ）
          if (onFileSelect && result.selectedFiles.length > 0) {
            const validFiles = validateAndFilterFiles(result.selectedFiles);
            if (validFiles.length > 0) {
              onFileSelect(validFiles);
            }
          }
        }
      }
    }
  };

  return (
    <div 
      className="p-2 border-t select-none"
      style={{ borderColor: colors.border }}
    >
      <div className="flex flex-col gap-1.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (mode === 'chat' 
            ? 'メッセージを入力...' 
            : 'コメントを追加してください、console.logを追加してください、型注釈を追加してください...'
          )}
          className="w-full p-2 text-xs rounded border resize-none focus:outline-none focus:ring-1"
          style={{
            background: colors.editorBg,
            color: colors.editorFg,
            borderColor: colors.border
          }}
          rows={2}
          disabled={isProcessing}
        />
        
        <div className="flex justify-between items-center">
          <div 
            className="text-xs flex items-center gap-2"
            style={{ color: colors.mutedFg }}
          >
            <span>
              {'Enter: 改行, Ctrl+Enter: 送信'}
            </span>
            {hasHistory && (
              <span className="flex items-center gap-1">
                <span>|</span>
                <span>Alt+↑↓: 履歴</span>
              </span>
            )}
          </div>
          
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className={`px-2 py-1 text-xs rounded font-medium ${
              !input.trim() || isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
            style={{
              background: colors.accent
            }}
          >
            {isProcessing ? (
              <div className="flex items-center gap-1">
                <div 
                  className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: `${colors.background} transparent ${colors.background} ${colors.background}` }}
                ></div>
                処理中...
              </div>
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
