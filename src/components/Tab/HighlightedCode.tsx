import React, { useEffect, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import * as shiki from 'shiki';

export function HighlightedCode({ language, value }: { language: string; value: string }) {
  const { themeName } = useTheme();
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    async function highlight() {
      try {
        const highlighter = await shiki.createHighlighter({
          themes: [themeName === 'light' ? 'github-light' : 'github-dark'],
          langs: [language || 'plaintext'],
        });
        const codeHtml = highlighter.codeToHtml(value, {
          lang: language || 'plaintext',
          theme: themeName === 'light' ? 'github-light' : 'github-dark',
        });
        if (mounted) setHtml(codeHtml);
      } catch (e) {
        setHtml(`<pre style="color:red">ハイライト失敗: ${String(e)}</pre>`);
      }
    }
    highlight();
    return () => { mounted = false; };
  }, [language, value, themeName]);

  return (
    <div
      className="shiki-code-block"
      style={{ borderRadius: 8, fontSize: '1em', margin: 0, overflowX: 'auto' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
