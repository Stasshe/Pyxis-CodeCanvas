// AIレビュータブコンポーネント

'use client';

import React, { useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import DiffViewer from './DiffViewer';
// 差分表示モード
type DiffViewMode = 'block' | 'inline';
import type { Tab } from '@/types';

interface AIReviewTabProps {
  tab: Tab;
  onApplyChanges: (filePath: string, content: string) => void;
  onDiscardChanges: (filePath: string) => void;
  onUpdateSuggestedContent?: (tabId: string, newContent: string) => void;
  onCloseTab?: (filePath: string) => void;
}

export default function AIReviewTab({ 
  tab, 
  onApplyChanges, 
  onDiscardChanges, 
  onUpdateSuggestedContent,
  onCloseTab
}: AIReviewTabProps) {
  const { colors } = useTheme();
  const [currentSuggestedContent, setCurrentSuggestedContent] = useState(
    tab.aiReviewProps?.suggestedContent || ''
  );
  // 差分表示モード: block=ブロックごと, inline=全体＋各ブロックにボタン
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('block');
  // 差分表示モード切り替え
  const handleToggleDiffViewMode = () => {
    setDiffViewMode((prev) => (prev === 'block' ? 'inline' : 'block'));
  };

  if (!tab.aiReviewProps) {
    return (
      <div 
        className="flex items-center justify-center h-full"
        style={{ color: colors.mutedFg }}
      >
        AIレビューデータが見つかりません
      </div>
    );
  }

  const { originalContent, filePath } = tab.aiReviewProps;

  // 部分適用ハンドラー
  const handleApplyBlock = (startLine: number, endLine: number, content: string) => {
    // 簡単な実装：ブロック単位で適用
    const originalLines = originalContent.split('\n');
    const suggestedLines = currentSuggestedContent.split('\n');
    
    // 指定範囲の行を置換
    const newLines = [...originalLines];
    const blockLines = content.split('\n');
    
    // 範囲を置換
    newLines.splice(startLine - 1, endLine - startLine + 1, ...blockLines);
    
    const newContent = newLines.join('\n');
    setCurrentSuggestedContent(newContent);
    
    if (onUpdateSuggestedContent) {
      onUpdateSuggestedContent(tab.id, newContent);
    }
  };

  // 部分破棄ハンドラー
  const handleDiscardBlock = (startLine: number, endLine: number) => {
    // 元の内容に戻す
    const originalLines = originalContent.split('\n');
    const currentLines = currentSuggestedContent.split('\n');
    
    // 指定範囲を元の内容で置換
    const newLines = [...currentLines];
    const originalBlockLines = originalLines.slice(startLine - 1, endLine);
    
    newLines.splice(startLine - 1, endLine - startLine + 1, ...originalBlockLines);
    
    const newContent = newLines.join('\n');
    setCurrentSuggestedContent(newContent);
    
    if (onUpdateSuggestedContent) {
      onUpdateSuggestedContent(tab.id, newContent);
    }
  };

  // 全体適用
  const handleApplyAll = () => {
    onApplyChanges(filePath, currentSuggestedContent);
    // レビュータブを閉じる
    if (onCloseTab) {
      onCloseTab(filePath);
    }
  };

  // 全体破棄
  const handleDiscardAll = () => {
    onDiscardChanges(filePath);
    // レビュータブを閉じる
    if (onCloseTab) {
      onCloseTab(filePath);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div 
        className="flex items-center justify-between p-3 border-b"
        style={{ borderColor: colors.border, background: colors.cardBg }}
      >
        <div>
          <h3 
            className="font-semibold"
            style={{ color: colors.foreground }}
          >
            AI Review: {filePath.split('/').pop()}
          </h3>
          <p 
            className="text-xs mt-1"
            style={{ color: colors.mutedFg }}
          >
            {filePath}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* 差分表示モード切り替え */}
          <button
            className="px-2 py-1 text-xs rounded border hover:opacity-80"
            style={{ background: 'transparent', color: colors.mutedFg, borderColor: colors.border }}
            onClick={handleToggleDiffViewMode}
            title="表示モード切替"
          >
            {diffViewMode === 'block' ? '全体表示' : 'ブロック表示'}
          </button>
          <button
            className="px-3 py-1 text-sm rounded border hover:opacity-90"
            style={{ 
              background: colors.green, 
              color: colors.background,
              borderColor: colors.green,
              fontWeight: 700,
              boxShadow: '0 2px 8px 0 #0003',
              letterSpacing: '0.05em',
              textShadow: '0 1px 2px #0002'
            }}
            onClick={handleApplyAll}
          >
            全て適用
          </button>
          <button
            className="px-3 py-1 text-sm rounded hover:opacity-80"
            style={{ background: colors.red, color: colors.accentFg }}
            onClick={handleDiscardAll}
          >
            全て破棄
          </button>
        </div>
      </div>

      {/* 統計情報 */}
      <div 
        className="px-3 py-2 text-xs border-b"
        style={{ 
          borderColor: colors.border, 
          background: colors.mutedBg,
          color: colors.mutedFg
        }}
      >
        <div className="flex gap-4">
          <span>元: {originalContent.split('\n').length}行</span>
          <span>新: {currentSuggestedContent.split('\n').length}行</span>
          <span>
            差分: {currentSuggestedContent.split('\n').length - originalContent.split('\n').length > 0 ? '+' : ''}
            {currentSuggestedContent.split('\n').length - originalContent.split('\n').length}行
          </span>
        </div>
      </div>

      {/* 差分表示 */}
      <div className="flex-1 overflow-auto">
        <DiffViewer
          oldValue={originalContent}
          newValue={currentSuggestedContent}
          onApplyBlock={handleApplyBlock}
          onDiscardBlock={handleDiscardBlock}
          viewMode={diffViewMode}
        />
      </div>

      {/* フッター */}
      <div 
        className="p-3 border-t text-xs"
        style={{ 
          borderColor: colors.border, 
          background: colors.cardBg,
          color: colors.mutedFg
        }}
      >
        💡 表示モード: <b>{diffViewMode === 'block' ? 'ブロックごと' : '全体＋各ブロックボタン'}</b>。
        <br />
        {diffViewMode === 'block'
          ? '各変更ブロックの「適用」「破棄」ボタンで部分的に変更を適用できます。最終的に「全て適用」を押すとファイルに反映されます。'
          : '全体表示の中で各ブロックに「適用」「破棄」ボタンが表示されます。最終的に「全て適用」を押すとファイルに反映されます。'}
      </div>
    </div>
  );
}
