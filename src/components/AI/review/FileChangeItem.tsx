// 変更ファイルアイテム

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import { FileCode, Eye, Check, X } from 'lucide-react';
import { calculateDiff } from '@/engine/ai/diffProcessor';
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

  // use diff processor to compute a pure diff summary (added/removed/unchanged)
  const diffLines = calculateDiff(file.originalContent, file.suggestedContent);
  const added = diffLines.filter((l) => l.type === 'added').length;
  const removed = diffLines.filter((l) => l.type === 'removed').length;
  const unchanged = diffLines.filter((l) => l.type === 'unchanged').length;
  const originalLines = unchanged + removed;
  const suggestedLines = unchanged + added;
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

          <div className="flex items-center gap-3 text-xs" style={{ color: colors.mutedFg }}>
            <div className="flex items-center gap-1">
              <span>{originalLines}行</span>
              <span className="mx-1">→</span>
              <span>{suggestedLines}行</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: added > 0 ? 'var(--tw-color-green-500, #16a34a)' : colors.mutedFg }}>
                +{added}
              </span>
              <span className="text-xs" style={{ color: removed > 0 ? 'var(--tw-color-red-500, #dc2626)' : colors.mutedFg }}>
                -{removed}
              </span>
            </div>
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
