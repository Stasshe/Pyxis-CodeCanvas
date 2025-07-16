import React from 'react';
import ReactMarkdown from 'react-markdown';

interface MarkdownPreviewTabProps {
  content: string;
  fileName: string;
}

const MarkdownPreviewTab: React.FC<MarkdownPreviewTabProps> = ({ content, fileName }) => {
  return (
    <div className="p-4 overflow-auto h-full w-full">
      <div className="font-bold text-lg mb-2">{fileName} プレビュー</div>
      <div className="markdown-body prose max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
};

export default MarkdownPreviewTab;
