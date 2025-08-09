// AI用ファイル選択コンポーネント（FileSelectの再利用）

'use client';

import React from 'react';
import type { FileItem } from '@/types';
import FileSelect from '@/components/FileSelect';

interface FileSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileItem[];
  onFileSelect: (file: FileItem) => void;
}

export default function FileSelector({ 
  isOpen, 
  onClose, 
  files, 
  onFileSelect 
}: FileSelectorProps) {
  // 既存のFileSelectコンポーネントを再利用
  return (
    <FileSelect
      isOpen={isOpen}
      onClose={onClose}
      files={files}
      onFileSelect={onFileSelect}
      currentProjectName="AI Context"
    />
  );
}
