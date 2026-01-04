// GitHub Copilot風のチャットメッセージコンポーネント

'use client';

import { Bot, Clock, FileCode, RotateCcw, User } from 'lucide-react';
import type { ClassAttributes, HTMLAttributes, ImgHTMLAttributes, ReactNode } from 'react';
import React from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import InlineHighlightedCode from '@/components/Tab/InlineHighlightedCode';
import LocalImage from '@/components/Tab/LocalImage';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { ChatSpaceMessage } from '@/types';

/** Props for code component in ReactMarkdown */
type CodeComponentProps = ClassAttributes<HTMLElement> &
  HTMLAttributes<HTMLElement> &
  ExtraProps & {
    children?: ReactNode;
  };

/** Props for img component in ReactMarkdown */
type ImgComponentProps = ClassAttributes<HTMLImageElement> &
  ImgHTMLAttributes<HTMLImageElement> &
  ExtraProps;

interface ChatMessageProps {
  message: ChatSpaceMessage;
  onRevert?: (message: ChatSpaceMessage) => Promise<void>;
}

export default function ChatMessage({ message, onRevert }: ChatMessageProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isUser = message.type === 'user';
  const isEdit = message.mode === 'edit';
  const hasEditResponse = message.type === 'assistant' && isEdit && message.editResponse;

  // Count applied/pending files (extract to avoid duplicate filtering)
  const changedFiles = message.editResponse?.changedFiles ?? [];
  const appliedFiles = changedFiles.filter(f => f.applied);
  const pendingFiles = changedFiles.filter(f => !f.applied);
  const appliedCount = hasEditResponse ? appliedFiles.length : 0;
  const pendingCount = hasEditResponse ? pendingFiles.length : 0;

  return (
    <div className={`w-full flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
        style={{
          background: isUser ? colors.accent : colors.mutedBg,
          border: `1px solid ${isUser ? colors.accent : colors.border}`,
        }}
      >
        {isUser ? (
          <User size={12} style={{ color: colors.accentFg }} />
        ) : (
          <Bot size={12} style={{ color: colors.foreground }} />
        )}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0 max-w-[90%]">
        <div
          className="relative rounded-lg px-3 py-2 text-xs"
          style={{
            background: isUser ? colors.accent : colors.mutedBg,
            color: isUser ? colors.accentFg : colors.foreground,
            border: `1px solid ${isUser ? colors.accent : colors.border}`,
          }}
        >
          {/* Mode badge */}
          {isEdit && (
            <span
              className="absolute -top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{
                background: colors.accent,
                color: colors.accentFg,
              }}
            >
              Edit
            </span>
          )}

          {/* Message content - Markdown */}
          <div className={`prose prose-sm max-w-none ${isEdit ? 'mt-1' : ''}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }: CodeComponentProps) {
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
                        background: isUser ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
                        color: isUser ? colors.accentFg : colors.foreground,
                      }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                p: ({ children }) => (
                  <p className="mb-1.5 last:mb-0 leading-relaxed text-xs">{children}</p>
                ),
                h1: ({ children }) => (
                  <h1 className="text-sm font-bold mb-1.5 mt-2 first:mt-0">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xs font-bold mb-1 mt-1.5 first:mt-0">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xs font-semibold mb-1 mt-1 first:mt-0">{children}</h3>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-1.5 space-y-0.5 text-xs">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-1.5 space-y-0.5 text-xs">
                    {children}
                  </ol>
                ),
                li: ({ children }) => <li className="ml-1 text-xs">{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote
                    className="border-l-2 pl-2 py-0.5 my-1 italic text-xs"
                    style={{ borderColor: colors.accent }}
                  >
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2">
                    <table
                      className="min-w-full divide-y text-xs"
                      style={{ borderColor: colors.border }}
                    >
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th
                    className="px-2 py-1 text-left text-[10px] font-semibold"
                    style={{ background: colors.mutedBg }}
                  >
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-2 py-1 text-xs" style={{ borderColor: colors.border }}>
                    {children}
                  </td>
                ),
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
                img: ({ src, alt, ...props }: ImgComponentProps) => (
                  <LocalImage src={typeof src === 'string' ? src : ''} alt={alt || ''} {...props} />
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>

          {/* File context */}
          {message.fileContext && message.fileContext.length > 0 && (
            <div
              className="mt-2 pt-2 border-t border-opacity-20"
              style={{ borderColor: colors.border }}
            >
              <div className="flex items-center gap-1 text-[10px] opacity-70 flex-wrap">
                <FileCode size={10} />
                {message.fileContext.map((filePath, index) => (
                  <span
                    key={index}
                    className="px-1 py-0.5 rounded font-mono"
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

          {/* Edit response summary */}
          {hasEditResponse && (
            <div
              className="mt-2 pt-2 border-t flex items-center justify-between gap-2"
              style={{ borderColor: colors.border }}
            >
              <div className="flex items-center gap-2 text-[10px]">
                {appliedCount > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#16a34a' }}
                  >
                    {appliedCount} {t('ai.applied') || '適用済み'}
                  </span>
                )}
                {pendingCount > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#ca8a04' }}
                  >
                    {pendingCount} {t('ai.pending') || '保留中'}
                  </span>
                )}
              </div>

              {/* Revert button */}
              {appliedCount > 0 && onRevert && (
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-all hover:opacity-80"
                  style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    color: '#dc2626',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                  }}
                  onClick={async () => {
                    try {
                      await onRevert(message);
                    } catch (e) {
                      console.warn('Revert click handler error', e);
                    }
                  }}
                  title={t('ai.revertTooltip') || 'この変更を元に戻す'}
                >
                  <RotateCcw size={10} />
                  <span>{t('ai.revert') || 'リバート'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div
          className={`flex items-center gap-1 text-[10px] mt-1 opacity-40 ${isUser ? 'justify-end' : 'justify-start'}`}
          style={{ color: colors.mutedFg }}
        >
          <Clock size={10} />
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
