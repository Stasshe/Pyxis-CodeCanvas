'use client';

import type { FileItem } from '@/types';

import OperationWindow from '@/components/OperationWindow';
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
  // OperationWindowに一任。FileTreeや入力欄は不要。
  return (
    <OperationWindow
      isVisible={isOpen}
      onClose={onClose}
      projectFiles={files}
      tabs={[]}
      setTabs={() => {}}
      setActiveTabId={() => {}}
      onFileSelect={onFileSelect}
    />
  );
}
