import React, { useEffect, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import * as shiki from 'shiki';
import { Copy, Check } from 'lucide-react';

export function HighlightedCode({ language, value }: { language: string; value: string }) {
  const { highlightTheme } = useTheme();
  const [html, setHtml] = useState<string>('');
  const [copied, setCopied] = useState(false);

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
    <div style={{ position: 'relative', margin: 0 }}>
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
        style={{ borderRadius: 8, fontSize: '1em', margin: 0, overflowX: 'auto' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
