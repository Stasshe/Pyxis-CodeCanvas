// 変更ファイルアイテム

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import { FileCode, Eye, Check, X } from 'lucide-react';
import type { AIEditResponse } from '@/types';

interface FileChangeItemProps {
  file: AIEditResponse['changedFiles'][0];
  onOpenReview?: (filePath: string, originalContent: string, suggestedContent: string) => void;
  onApply?: (filePath: string, content: string) => void;
  onDiscard?: (filePath: string) => void;
  compact?: boolean;
}

export default function FileChangeItem({
  file,
  onOpenReview,
  onApply,
  onDiscard,
  compact = false,
}: FileChangeItemProps) {
  const { colors } = useTheme();

  const originalLines = file.originalContent.split('\n').length;
  const suggestedLines = file.suggestedContent.split('\n').length;
  const fileName = file.path.split('/').pop() || file.path;

  return (
    <div
      className={`rounded border ${compact ? 'p-2' : 'p-3'}`}
      style={{
        borderColor: colors.border,
        background: colors.cardBg,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <FileCode
              size={14}
              style={{ color: colors.accent }}
            />
            <span
              className={`font-mono font-medium ${compact ? 'text-xs' : 'text-sm'} truncate`}
              style={{ color: colors.foreground }}
              title={file.path}
            >
              {fileName}
            </span>
          </div>

          {file.explanation && (
            <p
              className={`${compact ? 'text-xs' : 'text-sm'} mb-2`}
              style={{ color: colors.mutedFg }}
            >
              {file.explanation}
            </p>
          )}

          <div
            className="flex items-center gap-2 text-xs"
            style={{ color: colors.mutedFg }}
          >
            <span>{originalLines}行</span>
            <span>→</span>
            <span>{suggestedLines}行</span>
            <span
              className={`ml-1 ${
                suggestedLines > originalLines
                  ? 'text-green-500'
                  : suggestedLines < originalLines
                    ? 'text-red-500'
                    : ''
              }`}
            >
              ({suggestedLines > originalLines ? '+' : ''}
              {suggestedLines - originalLines})
            </span>
          </div>
        </div>
      </div>

      {/* アクションボタン */}
      {(onOpenReview || onApply || onDiscard) && (
        <div className="flex items-center gap-2 mt-2">
          {onOpenReview && (
            <button
              onClick={() => onOpenReview(file.path, file.originalContent, file.suggestedContent)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:opacity-80 transition-all"
              style={{
                background: colors.mutedBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
            >
              <Eye size={14} />
              <span>確認</span>
            </button>
          )}

          {onApply && (
            <button
              onClick={() => onApply(file.path, file.suggestedContent)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:opacity-90 transition-all"
              style={{
                background: colors.accent,
                color: colors.accentFg,
              }}
            >
              <Check size={14} />
              <span>適用</span>
            </button>
          )}

          {onDiscard && (
            <button
              onClick={() => onDiscard(file.path)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:opacity-80 transition-all"
              style={{
                background: 'transparent',
                color: colors.mutedFg,
                border: `1px solid ${colors.border}`,
              }}
            >
              <X size={14} />
              <span>破棄</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
