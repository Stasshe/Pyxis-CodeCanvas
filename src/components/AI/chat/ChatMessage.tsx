// GitHub Copilot風のチャットメッセージコンポーネント

'use client';

import { FileCode, Clock, Copy, Check } from 'lucide-react';
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import InlineHighlightedCode from '@/components/Tab/InlineHighlightedCode';
import LocalImage from '@/components/Tab/LocalImage';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { ChatSpaceMessage } from '@/types';

interface ChatMessageProps {
  message: ChatSpaceMessage;
  compact?: boolean;
  onRevert?: (message: ChatSpaceMessage) => Promise<void>;
}

// InlineHighlightedCode is used for syntax highlighting

export default function ChatMessage({ message, compact = false, onRevert }: ChatMessageProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isUser = message.type === 'user';

  return (
    <div className="w-full group">
      <div
        className={`w-full relative rounded-lg px-4 py-3 transition-all ${
          compact ? 'text-sm' : 'text-base'
        }`}
        style={{
          background: isUser ? colors.accent : colors.mutedBg,
          color: isUser ? colors.accentFg : colors.foreground,
          border: `1px solid ${isUser ? colors.accent : colors.border}`,
        }}
      >
        {/* メッセージ内容 - Markdown + シンタックスハイライト */}
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // コードブロック（シンタックスハイライト付き）
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

                // インラインコード
                return (
                  <code
                    className="px-1.5 py-0.5 rounded text-xs font-mono"
                    style={{
                      background: isUser ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                      color: isUser ? colors.accentFg : colors.foreground,
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },

              // 段落
              p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,

              // 見出し
              h1: ({ children }) => (
                <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-base font-semibold mb-2 mt-2 first:mt-0">{children}</h3>
              ),

              // リスト
              ul: ({ children }) => (
                <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>
              ),
              li: ({ children }) => <li className="ml-2">{children}</li>,

              // 引用
              blockquote: ({ children }) => (
                <blockquote
                  className="border-l-4 pl-4 py-2 my-3 italic"
                  style={{ borderColor: colors.accent }}
                >
                  {children}
                </blockquote>
              ),

              // テーブル
              table: ({ children }) => (
                <div className="overflow-x-auto my-3">
                  <table
                    className="min-w-full divide-y"
                    style={{ borderColor: colors.border }}
                  >
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th
                  className="px-3 py-2 text-left text-xs font-semibold"
                  style={{ background: colors.mutedBg }}
                >
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td
                  className="px-3 py-2 text-sm"
                  style={{ borderColor: colors.border }}
                >
                  {children}
                </td>
              ),

              // リンク
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:no-underline"
                  style={{ color: colors.accent }}
                >
                  {children}
                </a>
              ),
              // 画像: LocalImage を使ってローカルパスを解決
              img: ({ node, src, alt, ...props }: any) => (
                <LocalImage
                  src={typeof src === 'string' ? src : ''}
                  alt={alt || ''}
                  {...props}
                />
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* ヘッダツール: コピーなどと並べる形で Revert ボタンを追加 */}
        {message.type === 'assistant' && message.mode === 'edit' && message.editResponse && (
          <div className="absolute top-2 right-2 flex gap-2">
            <button
              className="px-2 py-0.5 text-xs rounded bg-red-600 text-white"
              onClick={async () => {
                try {
                  if (typeof onRevert === 'function') {
                    await onRevert(message);
                  }
                } catch (e) {
                  console.warn('Revert click handler error', e);
                }
              }}
              title="リバート: このメッセージで提案された変更を元に戻す"
            >
              リバート
            </button>
          </div>
        )}

        {/* ファイルコンテキスト表示 */}
        {message.fileContext && message.fileContext.length > 0 && (
          <div
            className="mt-3 pt-3 border-t border-opacity-20"
            style={{ borderColor: colors.border }}
          >
            <div className="flex items-center gap-2 text-xs opacity-70 flex-wrap">
              <FileCode size={14} />
              <span>{t('ai.chatMessage.reference')}</span>
              {message.fileContext.map((filePath, index) => (
                <span
                  key={index}
                  className="px-2 py-0.5 rounded font-mono"
                  style={{
                    background: isUser ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.05)',
                    border: `1px solid ${colors.border}`,
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
          className="flex items-center gap-1 text-xs mt-2 opacity-50"
          style={{ color: isUser ? colors.accentFg : colors.mutedFg }}
        >
          <Clock size={12} />
          <span>
            {message.timestamp.toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
