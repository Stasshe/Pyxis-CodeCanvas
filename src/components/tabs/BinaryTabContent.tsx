import { FileText } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import type { BinaryTab, EditorTab } from '@/engine/ide/tabs/types';

interface BinaryTabContentProps {
  activeTab: BinaryTab | EditorTab;
  editorHeight: string;
  guessMimeType: (fileName: string, buffer?: ArrayBuffer, mimeType?: string) => string;
}

/**
 * バイナリファイル系タブの内容を返す（画像・動画・PDF・音声・その他バイナリ）
 */
const BinaryTabContent: React.FC<BinaryTabContentProps> = ({
  activeTab,
  editorHeight,
  guessMimeType,
}) => {
  const { t } = useTranslation();
  // If the tab doesn't have bufferContent, nothing to show here
  let buffer: ArrayBuffer | undefined;
  if ('bufferContent' in activeTab) buffer = activeTab.bufferContent;

  let detectedMimeType: string | undefined;
  if ('mimeType' in activeTab) detectedMimeType = activeTab.mimeType;
  const mime = guessMimeType(activeTab.name, buffer, detectedMimeType);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (buffer == null) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob([buffer], { type: mime }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [buffer, mime]);

  if (buffer == null) return null;
  if (!url) return null;
  // 画像ならimg表示
  if (mime.startsWith('image/') && buffer) {
    return (
      <div
        className="flex-1 min-h-0 flex flex-col items-center justify-center"
        style={{ height: editorHeight }}
      >
        <img
          src={url}
          alt={activeTab.name}
          style={{
            maxWidth: '90%',
            maxHeight: '90%',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        />
        <div style={{ marginTop: 12, color: '#aaa', fontSize: 13 }}>{activeTab.name}</div>
      </div>
    );
  }
  // 動画ならvideo表示
  if (mime.startsWith('video/') && buffer) {
    return (
      <div
        className="flex-1 min-h-0 flex flex-col items-center justify-center"
        style={{ height: editorHeight }}
      >
        <video
          controls
          src={url}
          style={{ width: '90%', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        />
        <div style={{ marginTop: 12, color: '#aaa', fontSize: 13 }}>{activeTab.name}</div>
      </div>
    );
  }
  // PDFならiframeで表示
  if (mime === 'application/pdf' && buffer) {
    return (
      <div
        className="flex-1 min-h-0 flex flex-col items-center justify-center"
        style={{ height: editorHeight }}
      >
        <iframe
          src={url}
          title={activeTab.name}
          style={{
            width: '90%',
            height: '90%',
            border: 'none',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        />
        <div style={{ marginTop: 12, color: '#aaa', fontSize: 13 }}>{activeTab.name}</div>
      </div>
    );
  }
  // 音声ファイルならaudio表示
  if ((mime === 'audio/mpeg' || mime === 'audio/wav' || mime === 'audio/ogg') && buffer) {
    return (
      <div
        className="flex-1 min-h-0 flex flex-col items-center justify-center"
        style={{ height: editorHeight }}
      >
        <audio
          controls
          loop
          src={url}
          style={{ width: '90%', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        />
        <div style={{ marginTop: 12, color: '#aaa', fontSize: 13 }}>{activeTab.name}</div>
      </div>
    );
  }
  // それ以外は「表示できません」
  return (
    <div
      className="flex-1 min-h-0 flex flex-col items-center justify-center"
      style={{ height: editorHeight }}
    >
      <FileText size={48} className="mx-auto mb-4 opacity-50" />
      <div style={{ color: '#aaa', fontSize: 15, marginBottom: 8 }}>{activeTab.name}</div>
      <div style={{ color: '#d44', fontSize: 16 }}>{t('binaryTab.unsupportedFormat')}</div>
    </div>
  );
};

export default BinaryTabContent;
