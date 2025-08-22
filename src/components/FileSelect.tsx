'use client';

import type { FileItem, EditorPane } from '@/types';

import OperationWindow from '@/components/OperationWindow';
import { useTheme } from '../context/ThemeContext';

export default function FileSelectModal({ isOpen, onClose, files, onFileSelect, onFileOperation, currentProjectName, onFilePreview, editors, setEditors, setFileSelectState, currentPaneIndex }: {
  isOpen: boolean,
  onClose: () => void,
  files: FileItem[],
  onFileSelect: (file: FileItem) => void,
  onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>,
  currentProjectName?: string,
  onFilePreview?: (file: FileItem) => void,
  editors: EditorPane[],
  setEditors: React.Dispatch<React.SetStateAction<EditorPane[]>>,
  setFileSelectState: (state: { open: boolean; paneIdx: number | null }) => void,
  currentPaneIndex: number | null
}) {
  const { colors } = useTheme();
  if (!isOpen) return null;
  // OperationWindowに一任。FileTreeや入力欄は不要。
  return (
    <OperationWindow
      isVisible={isOpen}
      onClose={onClose}
      projectFiles={files}
      onFileSelect={onFileSelect}
      editors={editors}
      setEditors={setEditors}
      setFileSelectState={setFileSelectState}
      currentPaneIndex={currentPaneIndex}
    />
  );
}