import { Check, Copy } from 'lucide-react';
import React, { useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';

import { highlightCode } from '../../engine/ide/markdown/inlineCodeHighlighter';

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  // Inline rendering
  if (inline) {
    const inner = highlightCode(String(value), language, isDark);
    return (
      <code
        className="inline-code"
        style={{
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Segoe UI Mono", monospace',
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
            const inner = highlightCode(String(value), language, isDark);
            const preBg = colors?.cardBg || (isDark ? '#23232a' : '#f5f5f5');
            const preColor = colors?.foreground || (isDark ? '#fff' : '#000');
            return `<pre class="overflow-x-auto text-xs p-3 min-h-[48px] font-mono" style="font-size:13px;margin:0;background:${preBg};color:${preColor};padding:12px;border-radius:8px">${inner}</pre>`;
          })(),
        }}
      />
    </div>
  );
}
