// 変更ファイル一覧パネル

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import FileChangeItem from './FileChangeItem';
import { FileCode } from 'lucide-react';
import type { AIEditResponse } from '@/types';

interface ChangedFilesPanelProps {
  changedFiles: AIEditResponse['changedFiles'];
  onOpenReview: (filePath: string, originalContent: string, suggestedContent: string) => void;
  onApplyChanges: (filePath: string, content: string) => void;
  onDiscardChanges: (filePath: string) => void;
  compact?: boolean;
}

export default function ChangedFilesPanel({
  changedFiles,
  onOpenReview,
  onApplyChanges,
  onDiscardChanges,
  compact = false,
}: ChangedFilesPanelProps) {
  const { colors } = useTheme();

  if (changedFiles.length === 0) {
    return null;
  }

  return (
    <div
      className={`${compact ? 'p-2' : 'p-3'} border-t`}
      style={{
        borderColor: colors.border,
        background: colors.cardBg,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <FileCode
          size={16}
          style={{ color: colors.accent }}
        />
        <span
          className="text-sm font-medium"
          style={{ color: colors.foreground }}
        >
          変更提案 ({changedFiles.length})
        </span>
      </div>

      <div className="space-y-2">
        {changedFiles.map((file, index) => (
          <FileChangeItem
            key={`${file.path}-${index}`}
            file={file}
            onOpenReview={onOpenReview}
            onApply={onApplyChanges}
            onDiscard={onDiscardChanges}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
