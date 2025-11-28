import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';

export default function InlineHighlightedCode({
  language,
  value,
  plain,
  inline,
}: {
  language: string;
  value: string;
  plain?: boolean;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const { themeName, colors } = useTheme();
  const isDark = !(themeName || '').includes('light');
  const [copied, setCopied] = useState(false);

  if (plain) {
    return (
      <pre
        style={{
          borderRadius: 8,
          fontSize: '1em',
          margin: 0,
          overflowX: 'auto',
          minHeight: '100px',
          background: colors?.cardBg || '#f5f5f5',
          color: colors?.foreground || (isDark ? '#fff' : '#000'),
          padding: '12px',
        }}
      >
        <code>{value}</code>
      </pre>
    );
  }

  // Code highlight logic copied/adapted from ChatMessage CodeBlock
  // Returns inner HTML (without surrounding <pre>) so callers can choose
  // how to render (inline or block).
  const highlight = (code: string, lang: string) => {
    const tokens: Array<{ type: string; value: string }> = [];
    let remaining = code;

    const tokenColors = {
      keyword: isDark ? '#569cd6' : '#0000ff',
      function: isDark ? '#dcdcaa' : '#795e26',
      string: isDark ? '#ce9178' : '#a31515',
      comment: isDark ? '#6a9955' : '#008000',
      number: isDark ? '#b5cea8' : '#098658',
      operator: isDark ? '#d4d4d4' : '#333',
      property: isDark ? '#9cdcfe' : '#001080',
      punctuation: isDark ? '#d4d4d4' : '#000000',
    };

    const patterns = [
      { type: 'comment', regex: /^\/\*[\s\S]*?\*\// },
      { type: 'comment', regex: /^\/\/[^\n]*/ },
      { type: 'string', regex: /^"(?:[^"\\]|\\[\s\S])*?"/ },
      { type: 'string', regex: /^'(?:[^'\\]|\\[\s\S])*?'/ },
      { type: 'string', regex: /^`(?:[^`\\]|\\[\s\S])*?`/ },
      { type: 'function', regex: /^[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\()/ },
      {
        type: 'keyword',
        regex:
          /^(?:abstract|arguments|await|boolean|break|byte|case|catch|char|class|const|continue|debugger|default|delete|do|double|else|enum|eval|export|extends|false|final|finally|float|for|function|goto|if|implements|import|in|instanceof|int|interface|let|long|native|new|null|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|true|try|typeof|var|void|volatile|while|with|yield|async|of|as|from|get|set)\b/,
      },
      { type: 'property', regex: /^\.([a-zA-Z_$][a-zA-Z0-9_$]*)/ },
      { type: 'number', regex: /^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/ },
      { type: 'operator', regex: /^(?:===|!==|==|!=|<=|>=|<<|>>|>>>|&&|\|\||[+\-*/%<>!|&^~?:])/ },
      { type: 'punctuation', regex: /^[(){}\[\];,.]/ },
      { type: 'whitespace', regex: /^[\s]+/ },
      { type: 'identifier', regex: /^[a-zA-Z_$][a-zA-Z0-9_$]*/ },
      { type: 'text', regex: /^./ },
    ];

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
      if (!matched) {
        tokens.push({ type: 'text', value: remaining[0] });
        remaining = remaining.slice(1);
      }
    }

    const htmlParts = tokens.map(token => {
      const escaped = token.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      switch (token.type) {
        case 'keyword':
          return `<span style="color:${tokenColors.keyword}; font-weight:600">${escaped}</span>`;
        case 'function':
          return `<span style="color:${tokenColors.function}; font-weight:500">${escaped}</span>`;
        case 'string':
          return `<span style="color:${tokenColors.string}">${escaped}</span>`;
        case 'comment':
          return `<span style="color:${tokenColors.comment}; font-style:italic">${escaped}</span>`;
        case 'number':
          return `<span style="color:${tokenColors.number}">${escaped}</span>`;
        case 'operator':
          return `<span style="color:${tokenColors.operator}">${escaped}</span>`;
        case 'property':
          return `<span style="color:${tokenColors.property}">${escaped}</span>`;
        case 'punctuation':
          return `<span style="color:${tokenColors.punctuation}">${escaped}</span>`;
        case 'whitespace':
          return escaped;
        case 'identifier':
          return `<span style="color:${colors.property}">${escaped}</span>`;
        default:
          return escaped;
      }
    });

    const inner = htmlParts.join('');
    return inner;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      // ignore
    }
  };

  // Inline rendering: render a compact <code> with highlighted inner HTML.
  if (inline) {
    const inner = highlight(String(value), language);
    return (
      <code
        className="inline-code"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Segoe UI Mono", monospace',
          fontSize: '0.9em',
          padding: '0.2em 0.35em',
          borderRadius: 4,
          background: colors?.cardBg || (isDark ? '#23232a' : '#f5f5f5'),
          color: colors?.foreground || (isDark ? '#fff' : '#000'),
        }}
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    );
  }

  return (
    <div className="relative group/code my-2 rounded-lg overflow-hidden">
      <button
        aria-label={t('highlightedCode.copyCode')}
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 2,
          background: 'rgba(255,255,255,0.7)',
          border: 'none',
          borderRadius: 6,
          padding: 4,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          transition: 'background 0.2s',
        }}
      >
        {copied ? <Check size={18} color="#22c55e" /> : <Copy size={18} color="#555" />}
      </button>

      <div
        className="overflow-x-auto"
        dangerouslySetInnerHTML={{
          __html: (() => {
            const inner = highlight(String(value), language);
            const preBg = colors?.cardBg || (isDark ? '#23232a' : '#f5f5f5');
            const preColor = colors?.foreground || (isDark ? '#fff' : '#000');
            return `<pre class="overflow-x-auto text-xs p-3 min-h-[48px] font-mono" style="font-size:13px;margin:0;background:${preBg};color:${preColor};padding:12px;border-radius:8px">${inner}</pre>`;
          })(),
        }}
      />
    </div>
  );
}
