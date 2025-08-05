import React, { useEffect, useRef } from 'react';
import { useTheme } from '@/context/ThemeContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { HighlightedCode } from './HighlightedCode'; // Assuming you have a HighlightedCode component for syntax highlighting
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';

interface MarkdownPreviewTabProps {
  content: string;
  fileName: string;
}

// ユニークID生成用
let mermaidIdCounter = 0;
const getUniqueMermaidId = () => `mermaid-svg-${mermaidIdCounter++}`;

const Mermaid: React.FC<{ chart: string }> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>(getUniqueMermaidId());
  const { colors } = useTheme();
  useEffect(() => {
    const renderMermaid = async () => {
      if (ref.current) {
        try {
          // ダーク/ライト自動切替
          const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
          const { svg } = await mermaid.render(idRef.current, chart);
          ref.current.innerHTML = svg;
          // SVGのoverflow調整 & 背景色設定
          const svgElem = ref.current.querySelector('svg');
          if (svgElem) {
                svgElem.style.maxWidth = '100%';
                svgElem.style.height = 'auto';
                svgElem.style.maxHeight = '90vh'; // 画面高の90%以下に制限
                svgElem.style.overflow = 'visible';
                svgElem.style.background = colors.mermaidBg || '#eaffea';
          }
        } catch (e) {
          ref.current.innerHTML = `<div class="mermaid-error">Mermaidのレンダリングに失敗しました。コードを確認してください。</div>`;
        }
      }
    };
    renderMermaid();
      // 10秒ごとにdmermaid-svg-で始まるIDの要素を削除
      const interval = setInterval(() => {
        document.querySelectorAll('[id^="dmermaid-svg-"]').forEach(el => el.remove());
      }, 10000);
      return () => clearInterval(interval);
  }, [chart, colors.mermaidBg]);
  return <div ref={ref} className="mermaid" />;
};

const MarkdownPreviewTab: React.FC<MarkdownPreviewTabProps> = ({ content, fileName }) => {
  const { colors } = useTheme();
  return (
    <div className="p-4 overflow-auto h-full w-full">
      <div className="font-bold text-lg mb-2">{fileName} プレビュー</div>
      <div
        className="markdown-body prose prose-github max-w-none"
        style={{
          background: colors.background,
          color: colors.foreground,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeRaw]}
          components={{
            code({ node, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const codeString = String(children).replace(/\n$/, '');
              if (match && match[1] === 'mermaid') {
                return <Mermaid chart={codeString} />;
              }
              if (className && match) {
                return <HighlightedCode language={match[1] || ''} value={codeString} />;
              }
              // インラインコード
              return <code {...props}>{children}</code>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

export default MarkdownPreviewTab;
