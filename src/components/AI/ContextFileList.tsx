// 選択されたファイルコンテキスト表示コンポーネント

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import type { AIFileContext } from '@/types';

interface ContextFileListProps {
  contexts: AIFileContext[];
  onToggleSelection: (path: string) => void;
}

export default function ContextFileList({ contexts, onToggleSelection }: ContextFileListProps) {
  const { colors } = useTheme();

  const selectedContexts = contexts.filter(ctx => ctx.selected);
  const availableContexts = contexts.filter(ctx => !ctx.selected);

  if (contexts.length === 0) {
    return (
      <div 
        className="text-xs text-center py-2"
        style={{ color: colors.mutedFg }}
      >
        プロジェクトファイルがありません
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* 選択されたファイル */}
      {selectedContexts.length > 0 && (
        <div>
          <div 
            className="text-xs font-medium mb-1"
            style={{ color: colors.foreground }}
          >
            選択中 ({selectedContexts.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {selectedContexts.map(ctx => (
              <button
                key={ctx.path}
                className="text-xs px-2 py-1 rounded border flex items-center gap-1 hover:opacity-80"
                style={{
                  background: colors.accent,
                  color: colors.background,
                  borderColor: colors.accent
                }}
                onClick={() => onToggleSelection(ctx.path)}
                title={`${ctx.path} (${ctx.content.split('\n').length}行)`}
              >
                <span>{ctx.name}</span>
                <span className="opacity-70">×</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 利用可能なファイル（最初の5つのみ表示） */}
      {availableContexts.length > 0 && (
        <div>
          <div 
            className="text-xs font-medium mb-1"
            style={{ color: colors.mutedFg }}
          >
            利用可能 ({availableContexts.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {availableContexts.slice(0, 8).map(ctx => (
              <button
                key={ctx.path}
                className="text-xs px-2 py-1 rounded border hover:opacity-80"
                style={{
                  background: colors.mutedBg,
                  color: colors.mutedFg,
                  borderColor: colors.border
                }}
                onClick={() => onToggleSelection(ctx.path)}
                title={`${ctx.path} (${ctx.content.split('\n').length}行)`}
              >
                {ctx.name}
              </button>
            ))}
            {availableContexts.length > 8 && (
              <span 
                className="text-xs px-2 py-1"
                style={{ color: colors.mutedFg }}
              >
                +{availableContexts.length - 8}個...
              </span>
            )}
          </div>
        </div>
      )}

      {selectedContexts.length === 0 && (
        <div 
          className="text-xs text-center py-2"
          style={{ color: colors.mutedFg }}
        >
          ファイルを選択してコンテキストに追加
        </div>
      )}
    </div>
  );
}
