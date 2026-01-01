// メッセージ表示コンテナ

'use client';

import { Bot, Loader2, MessageSquare } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

import ChatMessage from './ChatMessage';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { ChatSpaceMessage } from '@/types';

interface ChatContainerProps {
  messages: ChatSpaceMessage[];
  isProcessing: boolean;
  emptyMessage?: string;
  onRevert?: (message: ChatSpaceMessage) => Promise<void>;
}

export default function ChatContainer({
  messages,
  isProcessing,
  emptyMessage = 'AIとチャットを開始してください',
  onRevert,
}: ChatContainerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isProcessing]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-2 py-2 space-y-3"
      style={{ background: colors.background }}
    >
      {messages.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center h-full text-center select-none py-8"
          style={{ color: colors.mutedFg }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
            style={{ background: colors.mutedBg, border: `1px solid ${colors.border}` }}
          >
            <Bot size={24} className="opacity-50" />
          </div>
          <div className="text-xs font-medium mb-1">{emptyMessage}</div>
          <div className="text-[10px] opacity-60">{t('ai.chatContainer.suggest')}</div>
        </div>
      ) : (
        <>
          {messages.map(message => (
            <ChatMessage key={message.id} message={message} onRevert={onRevert} />
          ))}

          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex gap-2">
              <div
                className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                style={{
                  background: colors.mutedBg,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <Bot size={12} style={{ color: colors.foreground }} />
              </div>
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{
                  background: colors.mutedBg,
                  color: colors.mutedFg,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <Loader2 size={12} className="animate-spin" />
                <span className="text-xs">{t('ai.chatContainer.generating')}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// React.memo でメモ化し、messages や isProcessing が変更されない限り再レンダリングを防ぐ
export default React.memo(ChatContainer);
