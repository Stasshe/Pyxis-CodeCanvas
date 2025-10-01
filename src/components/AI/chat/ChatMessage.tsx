// GitHub Copilot風のチャットメッセージコンポーネント

'use client';

import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as shiki from 'shiki';
import { useTheme } from '@/context/ThemeContext';
import { FileCode, Clock, Copy, Check } from 'lucide-react';
import type { ChatSpaceMessage } from '@/types';

interface ChatMessageProps {
  message: ChatSpaceMessage;
  compact?: boolean;
}

// コードブロック用コンポーネント
function CodeBlock({ language, value, isDark }: { language: string; value: string; isDark: boolean }) {
  const [html, setHtml] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const { highlightTheme } = useTheme();

  useEffect(() => {
    let mounted = true;
    async function highlight() {
      try {
        const highlighter = await shiki.createHighlighter({
          themes: [highlightTheme],
          langs: [language || 'plaintext'],
        });
        const codeHtml = highlighter.codeToHtml(value, {
          lang: language || 'plaintext',
          theme: highlightTheme,
        });
        if (mounted) setHtml(codeHtml);
      } catch (e) {
        console.error('Shiki highlight error:', e);
        if (mounted) {
          setHtml(`<pre><code>${value}</code></pre>`);
        }
      }
    }
    highlight();
    return () => {
      mounted = false;
    };
  }, [language, value, highlightTheme]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  return (
    <div className="relative group/code my-2 rounded-lg overflow-hidden">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover/code:opacity-100 transition-opacity z-10"
        style={{
          background: 'rgba(0, 0, 0, 0.7)',
          color: '#fff',
        }}
        title="コードをコピー"
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <div
        className="overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html }}
        style={{
          fontSize: '13px',
        }}
      />
    </div>
  );
}

export default function ChatMessage({ message, compact = false }: ChatMessageProps) {
  const { colors, highlightTheme } = useTheme();
  const isUser = message.type === 'user';
  const isDark = highlightTheme.includes('dark');

  return (
    <div className="w-full group">
      <div
        className={`w-full rounded-lg px-4 py-3 transition-all ${
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
              // コードブロック（shikiシンタックスハイライト付き）
              code({ className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';
                const inline = !language;

                if (!inline && language) {
                  return (
                    <CodeBlock
                      language={language}
                      value={String(children).replace(/\n$/, '')}
                      isDark={isDark}
                    />
                  );
                }

                // インラインコード
                return (
                  <code
                    className="px-1.5 py-0.5 rounded text-xs font-mono"
                    style={{
                      background: isUser
                        ? 'rgba(255, 255, 255, 0.2)'
                        : 'rgba(0, 0, 0, 0.1)',
                      color: isUser ? colors.accentFg : colors.foreground,
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },

              // 段落
              p: ({ children }) => (
                <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
              ),

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
                  <table className="min-w-full divide-y" style={{ borderColor: colors.border }}>
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
                <td className="px-3 py-2 text-sm" style={{ borderColor: colors.border }}>
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
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* ファイルコンテキスト表示 */}
        {message.fileContext && message.fileContext.length > 0 && (
          <div className="mt-3 pt-3 border-t border-opacity-20" style={{ borderColor: colors.border }}>
            <div className="flex items-center gap-2 text-xs opacity-70 flex-wrap">
              <FileCode size={14} />
              <span>参照:</span>
              {message.fileContext.map((filePath, index) => (
                <span
                  key={index}
                  className="px-2 py-0.5 rounded font-mono"
                  style={{
                    background: isUser
                      ? 'rgba(255, 255, 255, 0.15)'
                      : 'rgba(0, 0, 0, 0.05)',
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
