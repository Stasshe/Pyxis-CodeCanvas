'use client';

import type { FileItem } from '@/types';
import FileTree from '@/components/Left/FileTree';
import { useTheme } from '../context/ThemeContext';

export default function FileSelectModal({ isOpen, onClose, files, onFileSelect, onFileOperation, currentProjectName, onFilePreview }: {
  isOpen: boolean,
  onClose: () => void,
  files: FileItem[],
  onFileSelect: (file: FileItem) => void,
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>,
  currentProjectName?: string,
  onFilePreview?: (file: FileItem) => void
}) {
  const { colors } = useTheme();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div
        className="rounded shadow-lg p-4 min-w-[320px] max-h-[80vh] overflow-auto"
        style={{ background: colors.background }}
      >
        <div className="flex justify-between items-center mb-2">
          <span className="font-bold text-lg" style={{ color: colors.foreground }}>ファイルを選択</span>
          <button
            className="px-2 py-1 text-xs rounded"
            style={{ background: colors.mutedBg, color: colors.mutedFg }}
            onClick={onClose}
          >閉じる</button>
        </div>
        <div
          className="border rounded p-2"
          style={{ background: colors.mutedBg, borderColor: colors.border }}
        >
          <FileTree
            items={files}
            onFileOpen={file => {
              let defaultEditor = 'monaco';
              if (typeof window !== 'undefined') {
                defaultEditor = localStorage.getItem('pyxis-defaultEditor') || 'monaco';
              }
              onFileSelect({ ...file, isCodeMirror: defaultEditor === 'codemirror' });
            }}
            onFileOperation={onFileOperation}
            currentProjectName={currentProjectName || ''}
            onFilePreview={onFilePreview}
            isFileSelectModal={true}
          />
        </div>
      </div>
    </div>
  );
}
