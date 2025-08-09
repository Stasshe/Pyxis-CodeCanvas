// チャットメッセージ表示コンポーネント

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import type { AIMessage } from '@/types';

interface ChatMessageProps {
  message: AIMessage;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const { colors } = useTheme();

  const isUser = message.type === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`max-w-[80%] rounded-lg p-3 ${isUser ? 'rounded-br-none' : 'rounded-bl-none'}`}
        style={{
          background: isUser ? colors.accent : colors.mutedBg,
          color: isUser ? colors.accentFg : colors.foreground
        }}
      >
        {/* メッセージ内容 */}
        <div className="text-sm whitespace-pre-wrap">
          {message.content}
        </div>

        {/* ファイルコンテキスト表示 */}
        {message.fileContext && message.fileContext.length > 0 && (
          <div className="mt-2 pt-2 border-t border-opacity-30">
            <div 
              className="text-xs mb-1"
              style={{ color: isUser ? colors.accentFg : colors.mutedFg }}
            >
              参照ファイル:
            </div>
            <div className="flex flex-wrap gap-1">
              {message.fileContext.map((filePath, index) => (
                <span
                  key={index}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: isUser 
                      ? 'rgba(255, 255, 255, 0.2)' 
                      : 'rgba(0, 0, 0, 0.1)',
                    color: isUser ? colors.accentFg : colors.mutedFg
                  }}
                >
                  {filePath.split('/').pop()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* タイムスタンプ */}
        <div 
          className="text-xs mt-2 opacity-70"
          style={{ color: isUser ? colors.accentFg : colors.mutedFg }}
        >
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
