// ファイルコンテキストバー

'use client';

import { FileCode, X } from 'lucide-react';
import React from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { AIFileContext } from '@/types';

interface FileContextBarProps {
  contexts: AIFileContext[];
  onToggleSelection: (path: string) => void;
  onOpenSelector?: () => void;
}

export default function FileContextBar({
  contexts,
  onToggleSelection,
  onOpenSelector,
}: FileContextBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const selectedContexts = contexts.filter(ctx => ctx.selected);

  if (selectedContexts.length === 0 && !onOpenSelector) {
    return null;
  }

  return (
    <div
      className="px-3 py-2 border-b flex items-center gap-2 flex-wrap"
      style={{
        borderColor: colors.border,
        background: colors.mutedBg,
      }}
    >
      <div
        className="flex items-center gap-1 text-xs"
        style={{ color: colors.mutedFg }}
      >
        <FileCode size={14} />
        <span>{t('ai.fileContextBar.context')}</span>
      </div>

      {selectedContexts.length === 0 ? (
        <span
          className="text-xs"
          style={{ color: colors.mutedFg }}
        >
          {t('ai.fileContextBar.noFileSelected')}
        </span>
      ) : (
        selectedContexts.map(ctx => (
          <button
            key={ctx.path}
            onClick={() => onToggleSelection(ctx.path)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono hover:opacity-80 transition-all"
            style={{
              background: colors.accent,
              color: colors.accentFg,
              border: `1px solid ${colors.border}`,
            }}
            title={`${ctx.path}\nクリックして削除`}
          >
            <span className="max-w-32 truncate">{ctx.name}</span>
            <X size={12} />
          </button>
        ))
      )}

      {onOpenSelector && (
        <button
          onClick={onOpenSelector}
          className="px-2 py-1 rounded text-xs hover:opacity-80 transition-all"
          style={{
            background: colors.cardBg,
            color: colors.mutedFg,
            border: `1px solid ${colors.border}`,
          }}
        >
          {t('ai.fileContextBar.addFile')}
        </button>
      )}
    </div>
  );
}
