import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';

interface MarkdownPreviewTabProps {
  content: string;
  fileName: string;
}

const Mermaid: React.FC<{ chart: string }> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const renderMermaid = async () => {
      if (ref.current) {
        try {
          mermaid.initialize({ startOnLoad: false });
          const { svg } = await mermaid.render('mermaid-svg', chart);
          ref.current.innerHTML = svg;
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
      <div className="markdown-body prose max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              if (match && match[1] === 'mermaid') {
                return <Mermaid chart={String(children).trim()} />;
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
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
