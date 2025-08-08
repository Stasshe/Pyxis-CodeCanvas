import React, { useEffect, useRef } from 'react';

interface WebPreviewTabProps {
  filePath: string;
  content: string;
  onContentChange: (newContent: string) => void;
}

const WebPreviewTab: React.FC<WebPreviewTabProps> = ({ filePath, content, onContentChange }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current) {
      const iframeDocument = iframeRef.current.contentDocument;
      if (iframeDocument) {
        iframeDocument.open();
        iframeDocument.write(content);
        iframeDocument.close();
      }
    }
  }, [content]);

  useEffect(() => {
    const handleFileChange = (event: MessageEvent) => {
      if (event.data.type === 'file-change' && event.data.filePath === filePath) {
        onContentChange(event.data.newContent);
      }
    };

    window.addEventListener('message', handleFileChange);
    return () => {
      window.removeEventListener('message', handleFileChange);
    };
  }, [filePath, onContentChange]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <iframe ref={iframeRef} style={{ border: 'none', width: '100%', height: '100%' }} />
    </div>
  );
};

export default WebPreviewTab;
