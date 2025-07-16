'use client';

import type { FileItem } from '@/types';
import FileTree from '@/components/FileTree';

export default function FileSelectModal({ isOpen, onClose, files, onFileSelect }: { isOpen: boolean, onClose: () => void, files: FileItem[], onFileSelect: (file: FileItem) => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-background rounded shadow-lg p-4 min-w-[320px] max-h-[80vh] overflow-auto">
        <div className="flex justify-between items-center mb-2">
          <span className="font-bold text-lg">ファイルを選択</span>
          <button className="px-2 py-1 text-xs bg-muted rounded" onClick={onClose}>閉じる</button>
        </div>
        <div className="border rounded p-2 bg-muted">
          <FileTree items={files} onFileOpen={onFileSelect} />
        </div>
      </div>
    </div>
  );
}
