import React from 'react';
import { FileText } from 'lucide-react';
import { useTranslation } from '@/context/I18nContext';
import { BinaryTab, EditorTab } from '@/engine/tabs/types';

interface BinaryTabContentProps {
  activeTab: BinaryTab | EditorTab;
  editorHeight: string;
  guessMimeType: (fileName: string, buffer?: ArrayBuffer) => string;
  isBufferArray: (arg: any) => boolean;
}

/**
 * バイナリファイル系タブの内容を返す（画像・動画・PDF・音声・その他バイナリ）
 */
const BinaryTabContent: React.FC<BinaryTabContentProps> = ({
  activeTab,
  editorHeight,
  guessMimeType,
  isBufferArray,
}) => {
  const { t } = useTranslation();
  if (!('bufferContent' in activeTab) || !isBufferArray(activeTab.bufferContent)) return null;
  const buffer = activeTab.bufferContent as ArrayBuffer | undefined;
  const mime = guessMimeType(activeTab.name, buffer);
  // 画像ならimg表示
  if (mime.startsWith('image/') && buffer) {
    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
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
    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
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
    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
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
    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
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
      <FileText
        size={48}
        className="mx-auto mb-4 opacity-50"
      />
      <div style={{ color: '#aaa', fontSize: 15, marginBottom: 8 }}>{activeTab.name}</div>
      <div style={{ color: '#d44', fontSize: 16 }}>{t('binaryTab.unsupportedFormat')}</div>
    </div>
  );
};

export default BinaryTabContent;
