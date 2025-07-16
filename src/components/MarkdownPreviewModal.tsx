import React from 'react';
import ReactMarkdown from 'react-markdown';

interface MarkdownPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  fileName: string;
}

const MarkdownPreviewModal: React.FC<MarkdownPreviewModalProps> = ({ isOpen, onClose, content, fileName }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-background rounded shadow-lg p-4 min-w-[320px] max-h-[80vh] overflow-auto w-[600px]">
        <div className="flex justify-between items-center mb-2">
          <span className="font-bold text-lg">{fileName} プレビュー</span>
          <button className="ml-2 px-2 py-1 bg-muted rounded" onClick={onClose}>閉じる</button>
        </div>
        <div className="markdown-body prose max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

export default MarkdownPreviewModal;
