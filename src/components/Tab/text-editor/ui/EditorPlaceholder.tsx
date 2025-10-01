import { FileText } from 'lucide-react';

interface EditorPlaceholderProps {
  type: 'no-tab' | 'loading' | 'editor-loading';
  message?: string;
}

export default function EditorPlaceholder({ type, message }: EditorPlaceholderProps) {
  const height = '100%';

  if (type === 'no-tab') {
    return (
      <div
        className="flex-1 min-h-0 select-none"
        style={{ height }}
      >
        <div className="h-full flex items-center justify-center text-muted-foreground select-none">
          <div className="text-center select-none">
            <FileText
              size={48}
              className="mx-auto mb-4 opacity-50"
            />
            <p className="select-none">ファイルを選択してください</p>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'loading') {
    return (
      <div
        className="flex-1 min-h-0 select-none"
        style={{ height }}
      >
        <div className="h-full flex items-center justify-center text-muted-foreground select-none">
          <div className="text-center select-none">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
            <p className="select-none">{message || 'ファイル内容を復元中...'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'editor-loading') {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm">エディターを読み込み中...</p>
        </div>
      </div>
    );
  }

  return null;
}
