import React, { useEffect, useRef, useState } from 'react';

// Lightning-FSの仮想ファイルシステム取得関数
import { getFileSystem } from '@/utils/filesystem';

interface WebPreviewTabProps {
  filePath: string;
  onContentChange: (version: string) => void; // version(hashやランダム文字列)
}

const WebPreviewTab: React.FC<WebPreviewTabProps> = ({ filePath, onContentChange }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fileContent, setFileContent] = useState('');
  const [version, setVersion] = useState('');

  // ファイルシステムから直接ファイル内容を取得
  const fetchFileContent = async () => {
    try {
      const fs = getFileSystem();
      if (!fs) return;
      const content = await fs.promises.readFile(filePath, { encoding: 'utf8' });
      setFileContent(content);
      // バージョンとしてランダムなハッシュを生成
      const hash = Math.random().toString(36).slice(2) + Date.now();
      setVersion(hash);
      onContentChange(hash);
    } catch (e) {
      setFileContent('ファイルが見つかりません');
    }
  };

  useEffect(() => {
    fetchFileContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // ファイル内容が変わったらiframeに反映
  useEffect(() => {
    if (iframeRef.current) {
      const iframeDocument = iframeRef.current.contentDocument;
      if (iframeDocument) {
        iframeDocument.open();
        iframeDocument.write(fileContent);
        iframeDocument.close();
      }
    }
  }, [fileContent]);

  // ファイル変更通知を受けたら再取得
  useEffect(() => {
    const handleFileChange = (event: MessageEvent) => {
      if (event.data.type === 'file-change' && event.data.filePath === filePath) {
        fetchFileContent();
      }
    };
    window.addEventListener('message', handleFileChange);
    return () => {
      window.removeEventListener('message', handleFileChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <iframe ref={iframeRef} style={{ border: 'none', width: '100%', height: '100%' }} />
    </div>
  );
};

export default WebPreviewTab;
