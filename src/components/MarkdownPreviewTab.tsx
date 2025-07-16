import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { HighlightedCode } from './HighlightedCode'; // Assuming you have a HighlightedCode component for syntax highlighting

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
            svgElem.style.overflow = 'visible';
            svgElem.style.background = '#eaffea'; // 薄い黄緑
          }
        } catch (e) {
          ref.current.innerHTML = `<pre style='color:red;'>Mermaid render error: ${String(e)}</pre>`;
        }
      }
    };
    renderMermaid();
  }, [chart]);
  return <div ref={ref} className="mermaid" />;
};

const MarkdownPreviewTab: React.FC<MarkdownPreviewTabProps> = ({ content, fileName }) => {
  return (
    <div className="p-4 overflow-auto h-full w-full">
      <div className="font-bold text-lg mb-2">{fileName} プレビュー</div>
      <div className="markdown-body prose prose-github max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
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
