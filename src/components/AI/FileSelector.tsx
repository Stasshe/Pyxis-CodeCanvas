// AI用ファイル選択コンポーネント（OperationWindowの再利用）

'use client';

import React from 'react';
import type { FileItem } from '@/types';
import OperationWindow from '@/components/OperationWindow';

interface FileSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileItem[];
  onFileSelect: (file: FileItem) => void;
}

export default function FileSelector({ isOpen, onClose, files, onFileSelect }: FileSelectorProps) {
  // OperationWindowを使用してファイル選択（AI用）
  // AIの場合はファイルをタブで開くのではなく、コンテキストに追加するだけ
  return (
    <OperationWindow
      isVisible={isOpen}
      onClose={onClose}
      projectFiles={files}
      onFileSelect={onFileSelect}
      editors={[]} // ダミー値（AIモードでは使用されない）
      setEditors={() => {}} // ダミー値（AIモードでは使用されない）
      setFileSelectState={() => {}} // ダミー値（AIモードでは使用されない）
      aiMode={true} // AI用モード
    />
  );
}
