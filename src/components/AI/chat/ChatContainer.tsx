// メッセージ表示コンテナ

'use client';

import React, { useEffect, useRef } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';
import ChatMessage from './ChatMessage';
import { Loader2, MessageSquare } from 'lucide-react';
import type { ChatSpaceMessage } from '@/types';

interface ChatContainerProps {
  messages: ChatSpaceMessage[];
  isProcessing: boolean;
  compact?: boolean;
  emptyMessage?: string;
}

export default function ChatContainer({
  messages,
  isProcessing,
  compact = false,
  emptyMessage = 'AIとチャットを開始してください',
}: ChatContainerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新しいメッセージが追加されたら自動スクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isProcessing]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      style={{ background: colors.background }}
    >
      {messages.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center h-full text-center select-none"
          style={{ color: colors.mutedFg }}
        >
          <MessageSquare
            size={48}
            className="mb-4 opacity-30"
          />
          <div className="text-base font-medium mb-2">{emptyMessage}</div>
          <div className="text-sm opacity-70">{t('ai.chatContainer.suggest')}</div>
        </div>
      ) : (
        <>
          {messages.map(message => (
            <ChatMessage
              key={message.id}
              message={message}
              compact={compact}
            />
          ))}

          {/* 処理中インジケータ */}
          {isProcessing && (
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-lg"
              style={{
                background: colors.mutedBg,
                color: colors.mutedFg,
                border: `1px solid ${colors.border}`,
              }}
            >
              <Loader2
                size={16}
                className="animate-spin"
              />
              <span className="text-sm">{t('ai.chatContainer.generating')}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
