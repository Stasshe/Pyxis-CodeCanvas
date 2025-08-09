// 選択されたファイルコンテキスト表示コンポーネント

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import type { AIFileContext } from '@/types';

interface ContextFileListProps {
  contexts: AIFileContext[];
  onToggleSelection: (path: string) => void;
  compact?: boolean;
}

export default function ContextFileList({ contexts, onToggleSelection, compact = false }: ContextFileListProps) {
  const { colors } = useTheme();

  const selectedContexts = contexts.filter(ctx => ctx.selected);

  if (contexts.length === 0) {
    return (
      <div 
        className="text-xs py-1 flex items-center gap-1 opacity-60"
        style={{ color: colors.mutedFg }}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
        </svg>
        プロジェクトファイルなし
      </div>
    );
  }

  if (selectedContexts.length === 0) {
    return (
      <div 
        className="text-xs py-1 flex items-center gap-1 opacity-60"
        style={{ color: colors.mutedFg }}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        ファイルを選択してコンテキストに追加
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {selectedContexts.map(ctx => (
        <div
          key={ctx.path}
          className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded group hover:opacity-80 transition"
          style={{
            background: colors.accent,
            color: colors.accentFg,
            border: `1px solid ${colors.accent}`,
          }}
          title={`${ctx.path} (${ctx.content.split('\n').length}行)`}
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="max-w-16 truncate">{ctx.name}</span>
          <button
            className="opacity-60 hover:opacity-100 transition"
            onClick={() => onToggleSelection(ctx.path)}
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
