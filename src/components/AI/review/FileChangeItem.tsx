// 変更ファイルアイテム

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';
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
  const { t } = useTranslation();

  // use diff processor to compute a pure diff summary (added/removed/unchanged)
  const diffLines = calculateDiff(file.originalContent, file.suggestedContent);
  const added = diffLines.filter(l => l.type === 'added').length;
  const removed = diffLines.filter(l => l.type === 'removed').length;
  const unchanged = diffLines.filter(l => l.type === 'unchanged').length;
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

          <div
            className="flex items-center gap-3 text-xs"
            style={{ color: colors.mutedFg }}
          >
            <div className="flex items-center gap-1">
              <span>{originalLines}行</span>
              <span className="mx-1">→</span>
              <span>{suggestedLines}行</span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="text-xs"
                style={{ color: added > 0 ? 'var(--tw-color-green-500, #16a34a)' : colors.mutedFg }}
              >
                +{added}
              </span>
              <span
                className="text-xs"
                style={{ color: removed > 0 ? 'var(--tw-color-red-500, #dc2626)' : colors.mutedFg }}
              >
                -{removed}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* アクションボタン: 常に表示する。ハンドラが渡されていない場合は見た目を無効化し、安全に no-op とする */}
      <div className="flex items-center gap-2 mt-2">
        {/* 確認 (レビュー) */}
        <button
          onClick={() => {
            if (onOpenReview) {
              onOpenReview(file.path, file.originalContent, file.suggestedContent);
            } else {
              // ハンドラがない場合は no-op でログ出力（安全策）
              console.warn('[FileChangeItem] onOpenReview handler not provided');
            }
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all transition-transform active:scale-95 ${onOpenReview ? 'hover:opacity-80' : 'opacity-50 cursor-not-allowed'}`}
          style={{
            background: colors.mutedBg,
            color: colors.foreground,
            border: `1px solid ${colors.border}`,
          }}
          aria-disabled={!onOpenReview}
          title={!onOpenReview ? t('ai.fileChangeItem.noHandler') : undefined}
        >
          <Eye size={14} />
          <span>{t('ai.fileChangeItem.confirm')}</span>
        </button>

        {/* 採用 */}
        <button
          onClick={() => {
            if (onApply) {
              onApply(file.path, file.suggestedContent);
            } else {
              console.warn('[FileChangeItem] onApply handler not provided');
            }
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all transition-transform active:scale-95 active:bg-opacity-80 ${onApply ? 'hover:opacity-90' : 'opacity-50 cursor-not-allowed'}`}
          style={{
            background: colors.accent,
            color: colors.accentFg,
          }}
          aria-disabled={!onApply}
          title={!onApply ? t('ai.fileChangeItem.noHandler') : undefined}
        >
          <Check size={14} />
          <span>{t('ai.fileChangeItem.apply')}</span>
        </button>

        {/* 破棄 */}
        <button
          onClick={() => {
            if (onDiscard) {
              onDiscard(file.path);
            } else {
              console.warn('[FileChangeItem] onDiscard handler not provided');
            }
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all transition-transform active:scale-95 ${onDiscard ? 'hover:opacity-80' : 'opacity-50 cursor-not-allowed'}`}
          style={{
            background: 'transparent',
            color: colors.mutedFg,
            border: `1px solid ${colors.border}`,
          }}
          aria-disabled={!onDiscard}
          title={!onDiscard ? t('ai.fileChangeItem.noHandler') : undefined}
        >
          <X size={14} />
          <span>{t('ai.fileChangeItem.discard')}</span>
        </button>
      </div>
    </div>
  );
}
