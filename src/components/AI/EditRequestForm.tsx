// 編集依頼・チャット入力フォーム

'use client';

import React, { useState, KeyboardEvent } from 'react';
import { useTheme } from '@/context/ThemeContext';

interface EditRequestFormProps {
  mode: 'chat' | 'edit';
  onSubmit: (content: string) => void;
  isProcessing: boolean;
  placeholder?: string;
}

export default function EditRequestForm({ 
  mode, 
  onSubmit, 
  isProcessing, 
  placeholder 
}: EditRequestFormProps) {
  const { colors } = useTheme();
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (input.trim() && !isProcessing) {
      onSubmit(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div 
      className="p-3 border-t"
      style={{ borderColor: colors.border }}
    >
      <div className="flex flex-col gap-2">
                <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (mode === 'chat' 
            ? 'メッセージを入力...' 
            : 'コメントを追加してください、console.logを追加してください、型注釈を追加してください...'
          )}
          className="w-full p-2 text-sm rounded border resize-none focus:outline-none focus:ring-1"
          style={{
            background: colors.editorBg,
            color: colors.editorFg,
            borderColor: colors.border
          }}
          rows={3}
          disabled={isProcessing}
        />
        
        <div className="flex justify-between items-center">
          <div 
            className="text-xs"
            style={{ color: colors.mutedFg }}
          >
            {mode === 'edit' 
              ? 'Enter: 送信, Shift+Enter: 改行' 
              : 'Enter: 送信, Shift+Enter: 改行'
            }
          </div>
          
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isProcessing}
            className={`px-3 py-1 text-xs rounded font-medium ${
              !input.trim() || isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
            style={{
              background: colors.accent,
              color: colors.background
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
              mode === 'edit' ? '実行' : '送信'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
