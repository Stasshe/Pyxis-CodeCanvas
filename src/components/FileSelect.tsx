'use client';

import type { FileItem } from '@/types';

import { useState, useMemo } from 'react';
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
  const [filter, setFilter] = useState('');

  // ファイル名・フォルダ名でフィルタ
  const filteredFiles = useMemo(() => {
    if (!filter.trim()) return files;
    const lower = filter.toLowerCase();
    // 再帰的にフィルタ
    const filterItems = (items: FileItem[]): FileItem[] => {
      return items
        .map(item => {
          if (item.type === 'folder' && item.children) {
            if (item.name.toLowerCase().includes(lower)) {
              // フォルダ名一致時は配下すべて表示
              return item;
            }
            const filteredChildren = filterItems(item.children);
            if (filteredChildren.length > 0) {
              return { ...item, children: filteredChildren };
            }
            return null;
          }
          if (item.name.toLowerCase().includes(lower)) {
            return item;
          }
          return null;
        })
        .filter(Boolean) as FileItem[];
    };
    return filterItems(files);
  }, [filter, files]);

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40"
      onClick={onClose}
    >
      <div
        className="rounded shadow-lg p-4 min-w-[320px] max-h-[80vh] overflow-auto"
        style={{ background: colors.background }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-2">
          <span className="font-bold text-lg" style={{ color: colors.foreground }}>ファイルを選択</span>
          <button
            className="px-2 py-1 text-xs rounded"
            style={{ background: colors.mutedBg, color: colors.mutedFg }}
            onClick={onClose}
          >閉じる</button>
        </div>
        <input
          className="w-full mb-2 px-2 py-1 rounded border"
          style={{ background: colors.mutedBg, color: colors.foreground, borderColor: colors.border }}
          type="text"
          placeholder="ファイル名またはフォルダ名で検索"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          autoFocus
        />
        <div
          className="border rounded p-2"
          style={{ background: colors.mutedBg, borderColor: colors.border }}
        >
          <FileTree
            items={filteredFiles}
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
