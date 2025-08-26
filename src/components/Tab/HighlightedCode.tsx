import React, { useEffect, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import * as shiki from 'shiki';
import { Copy, Check } from 'lucide-react';

export function HighlightedCode({ language, value, plain }: { language: string; value: string; plain?: boolean }) {
  const { highlightTheme } = useTheme();
  const [html, setHtml] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // PDFエクスポート時はplain=trueで呼び出し、ハイライトなし
  if (plain) {
    return (
      <pre style={{ borderRadius: 8, fontSize: '1em', margin: 0, overflowX: 'auto', minHeight: '100px', background: '#f5f5f5', color: '#222', padding: '12px' }}>
        <code>{value}</code>
      </pre>
    );
  }

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
        setHtml(`<pre style="color:red">ハイライト失敗: ${String(e)}</pre>`);
      }
    }
    highlight();
    return () => { mounted = false; };
  }, [language, value, highlightTheme]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      // 失敗時は何もしない
    }
  };

  return (
    <div style={{ position: 'relative', margin: 0, minHeight: '100px' }}> {/* 高さを固定 */}
      <button
        aria-label="コードをコピー"
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
        className="shiki-code-block"
        style={{ borderRadius: 8, fontSize: '1em', margin: 0, overflowX: 'auto', minHeight: '100px' }} // 高さを固定
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
