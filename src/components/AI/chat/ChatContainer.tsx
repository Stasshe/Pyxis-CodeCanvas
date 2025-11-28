// メッセージ表示コンテナ

'use client';

import { Loader2, MessageSquare } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

import ChatMessage from './ChatMessage';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { ChatSpaceMessage } from '@/types';

interface ChatContainerProps {
  messages: ChatSpaceMessage[];
  isProcessing: boolean;
  compact?: boolean;
  emptyMessage?: string;
  onRevert?: (message: ChatSpaceMessage) => Promise<void>;
  onOpenReview?: (filePath: string, originalContent: string, suggestedContent: string) => Promise<void>;
  onApplyChanges?: (filePath: string, newContent: string) => Promise<void>;
  onDiscardChanges?: (filePath: string) => Promise<void>;
}

export default function ChatContainer({
  messages,
  isProcessing,
  compact = false,
  emptyMessage = 'AIとチャットを開始してください',
  onRevert,
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

  // Debug: log messages on each render to inspect which messages contain editResponse
  // Debug: log message count only to reduce noise (avoid logging full array each render)
  useEffect(() => {
    try {
      console.log('[ChatContainer] messages render, count:', messages.length);
    } catch (e) {
      console.warn('[ChatContainer] debug log failed', e);
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
              onRevert={async (m: ChatSpaceMessage) => {
                if (typeof onRevert === 'function') await onRevert(m);
              }}
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
