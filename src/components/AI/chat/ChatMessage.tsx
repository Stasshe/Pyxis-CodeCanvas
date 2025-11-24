// GitHub Copilot風のチャットメッセージコンポーネント

'use client';

import { FileCode, Clock, Copy, Check } from 'lucide-react';
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { ChatSpaceMessage } from '@/types';

interface ChatMessageProps {
  message: ChatSpaceMessage;
  compact?: boolean;
}

// コードブロック用コンポーネント
function CodeBlock({
  language,
  value,
  isDark,
}: {
  language: string;
  value: string;
  isDark: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  // 修正版: トークン単位で処理してHTMLタグの二重エスケープを防ぐ
  const highlight = (code: string, lang: string) => {
    const tokens: Array<{ type: string; value: string }> = [];
    let remaining = code;

    // 色の定義
    const colors = {
      keyword: isDark ? '#9cdcfe' : '#0000ff',
      string: isDark ? '#ce9178' : '#a31515',
      comment: isDark ? '#6a9955' : '#008000',
      number: isDark ? '#b5cea8' : '#098658',
      operator: isDark ? '#d4d4d4' : '#333',
    };

    // パターンの優先順位順に処理
    const patterns = [
      // コメント (複数行)
      { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
      // コメント (単一行)
      { type: 'comment', regex: /^\/\/.*?$/m },
      // 文字列 (ダブルクォート、シングルクォート、バッククォート)
      { type: 'string', regex: /^"(?:[^"\\]|\\.)*"/ },
      { type: 'string', regex: /^'(?:[^'\\]|\\.)*'/ },
      { type: 'string', regex: /^`(?:[^`\\]|\\.)* `/ },
      // キーワード
      {
        type: 'keyword',
        regex:
          /^(?:const|let|var|function|return|if|else|for|while|switch|case|break|import|from|export|class|extends|new|try|catch|finally|await|async|interface|type|implements|private|protected|public|throw|yield)\b/,
      },
      // 数値
      { type: 'number', regex: /^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/ },
      // 演算子
      { type: 'operator', regex: /^[=+\-*/%<>!|&^~?:]+/ },
      // その他の文字
      { type: 'text', regex: /^[\s\S]/ },
    ];

    // トークン化
    while (remaining.length > 0) {
      let matched = false;

      for (const pattern of patterns) {
        const match = remaining.match(pattern.regex);
        if (match) {
          tokens.push({ type: pattern.type, value: match[0] });
          remaining = remaining.slice(match[0].length);
          matched = true;
          break;
        }
      }

      // どのパターンにもマッチしない場合（念のため）
      if (!matched) {
        tokens.push({ type: 'text', value: remaining[0] });
        remaining = remaining.slice(1);
      }
    }

    // トークンをHTMLに変換
    const htmlParts = tokens.map(token => {
      // HTMLエスケープ
      const escaped = token.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // スタイル適用
      switch (token.type) {
        case 'keyword':
          return `<span style="color:${colors.keyword}; font-weight:600">${escaped}</span>`;
        case 'string':
          return `<span style="color:${colors.string}">${escaped}</span>`;
        case 'comment':
          return `<span style="color:${colors.comment}">${escaped}</span>`;
        case 'number':
          return `<span style="color:${colors.number}">${escaped}</span>`;
        case 'operator':
          return `<span style="color:${colors.operator}">${escaped}</span>`;
        default:
          return escaped;
      }
    });

    return `<pre class="overflow-x-auto text-xs p-3 min-h-[48px] font-mono" style="font-size:13px;margin:0;">${htmlParts.join('')}</pre>`;
  };

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
        title={t('ai.chatMessage.copyCode')}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <div
        className="overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: highlight(String(value), language) }}
      />
    </div>
  );
}

export default function ChatMessage({ message, compact = false }: ChatMessageProps) {
  const { colors, highlightTheme } = useTheme();
  const { t } = useTranslation();
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
              // コードブロック（シンタックスハイライト付き）
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
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

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
