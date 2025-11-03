'use client';

import type { FileItem, EditorPane } from '@/types';

import OperationWindow from '@/components/OperationWindow';
import { useTheme } from '../context/ThemeContext';

export default function FileSelectModal({
  isOpen,
  onClose,
  files,
  onFileSelect,
  aiMode,
}: {
  isOpen: boolean;
  onClose: () => void;
  files: FileItem[];
  onFileSelect?: (file: FileItem) => void;
  aiMode?: boolean;
}) {
  if (!isOpen) return null;
  // [NEW ARCHITECTURE] OperationWindowに一任。FileTreeや入力欄は不要。
  return (
    <OperationWindow
      isVisible={isOpen}
      onClose={onClose}
      projectFiles={files}
      onFileSelect={onFileSelect}
      aiMode={aiMode}
    />
  );
}
