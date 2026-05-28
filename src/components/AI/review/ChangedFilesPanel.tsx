// 変更ファイル一覧パネル

'use client';

import { FileCode } from 'lucide-react';
import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import type { AIEditResponse } from '@/types';
import FileChangeItem from './FileChangeItem';

interface ChangedFilesPanelProps {
  changedFiles: AIEditResponse['changedFiles'];
  onOpenReview: (filePath: string, originalContent: string, suggestedContent: string) => void;
  onApplyChanges: (filePath: string, content: string) => void;
  onDiscardChanges: (filePath: string) => void;
}

export default function ChangedFilesPanel({
  changedFiles,
  onOpenReview,
  onApplyChanges,
  onDiscardChanges,
}: ChangedFilesPanelProps) {
  const { colors } = useTheme();

  if (changedFiles.length === 0) {
    return null;
  }

  return (
    <div
      className={'p-2 border-t'}
      style={{
        borderColor: colors.border,
        background: colors.cardBg,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <FileCode size={14} style={{ color: colors.accent }} />
        <span className="text-xs font-medium" style={{ color: colors.foreground }}>
          変更提案 ({changedFiles.length})
        </span>
      </div>

      <div className="space-y-2">
        {changedFiles.map(file => (
          <FileChangeItem
            key={file.path}
            file={file}
            onOpenReview={onOpenReview}
            onApply={onApplyChanges}
            onDiscard={onDiscardChanges}
          />
        ))}
      </div>
    </div>
  );
}
