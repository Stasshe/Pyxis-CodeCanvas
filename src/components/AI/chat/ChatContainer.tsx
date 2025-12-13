// メッセージ表示コンテナ

'use client';

import { Loader2, MessageSquare, Bot } from 'lucide-react';
import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import ChatMessage from './ChatMessage';

import InlineHighlightedCode from '@/components/Tab/InlineHighlightedCode';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { ChatSpaceMessage } from '@/types';

interface ChatContainerProps {
  messages: ChatSpaceMessage[];
  isProcessing: boolean;
  emptyMessage?: string;
  streamingContent?: string;
  onRevert?: (message: ChatSpaceMessage) => Promise<void>;
}

export default function ChatContainer({
  messages,
  isProcessing,
  emptyMessage = 'AIとチャットを開始してください',
  streamingContent = '',
  onRevert,
}: ChatContainerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new messages arrive or streaming content updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isProcessing, streamingContent]);

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
            <ChatMessage
              key={message.id}
              message={message}
              onRevert={onRevert}
            />
          ))}

          {/* Streaming message display */}
          {isProcessing && streamingContent && (
            <div className="w-full flex gap-2 flex-row">
              {/* Avatar */}
              <div
                className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                style={{
                  background: colors.mutedBg,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <Bot size={12} style={{ color: colors.foreground }} />
              </div>

              {/* Streaming content */}
              <div className="flex-1 min-w-0 max-w-[90%]">
                <div
                  className="relative rounded-lg px-3 py-2 text-xs"
                  style={{
                    background: colors.mutedBg,
                    color: colors.foreground,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || '');
                          const language = match ? match[1] : '';
                          const inline = !language;

                          if (!inline && language) {
                            return (
                              <InlineHighlightedCode
                                language={language}
                                value={String(children).replace(/\n$/, '')}
                              />
                            );
                          }

                          return (
                            <code
                              className="px-1 py-0.5 rounded text-[11px] font-mono"
                              style={{
                                background: 'rgba(0, 0, 0, 0.1)',
                                color: colors.foreground,
                              }}
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        },
                        p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed text-xs">{children}</p>,
                        h1: ({ children }) => <h1 className="text-sm font-bold mb-1.5 mt-2 first:mt-0">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-xs font-bold mb-1 mt-1.5 first:mt-0">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-xs font-semibold mb-1 mt-1 first:mt-0">{children}</h3>,
                        ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5 text-xs">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5 text-xs">{children}</ol>,
                        li: ({ children }) => <li className="ml-1 text-xs">{children}</li>,
                        blockquote: ({ children }) => (
                          <blockquote
                            className="border-l-2 pl-2 py-0.5 my-1 italic text-xs"
                            style={{ borderColor: colors.accent }}
                          >
                            {children}
                          </blockquote>
                        ),
                      }}
                    >
                      {streamingContent}
                    </ReactMarkdown>
                  </div>
                  {/* Streaming indicator */}
                  <div className="flex items-center gap-1 mt-1 opacity-60">
                    <Loader2 size={10} className="animate-spin" />
                    <span className="text-[10px]">{t('ai.chatContainer.generating')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Processing indicator (shown when no streaming content yet) */}
          {isProcessing && !streamingContent && (
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
