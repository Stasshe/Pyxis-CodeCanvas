// カスタム差分表示コンポーネント

'use client';

import React, { useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { calculateDiff, groupDiffLines, calculateWordDiff } from '@/utils/ai/diffProcessor';
import type { DiffLine, DiffBlock } from '@/utils/ai/diffProcessor';

type DiffViewMode = 'block' | 'inline';
interface DiffViewerProps {
  oldValue: string;
  newValue: string;
  onApplyBlock?: (startLine: number, endLine: number, content: string) => void;
  onDiscardBlock?: (startLine: number, endLine: number) => void;
  viewMode?: DiffViewMode;
}

export default function DiffViewer({
  oldValue,
  newValue,
  onApplyBlock,
  onDiscardBlock,
  viewMode = 'block',
}: DiffViewerProps) {
  const { colors } = useTheme();
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());

  const diffLines = calculateDiff(oldValue, newValue);
  const diffBlocks = groupDiffLines(diffLines);

  const toggleBlockExpansion = (blockIndex: number) => {
    const newExpanded = new Set(expandedBlocks);
    if (newExpanded.has(blockIndex)) {
      newExpanded.delete(blockIndex);
    } else {
      newExpanded.add(blockIndex);
    }
    setExpandedBlocks(newExpanded);
  };

  const handleApplyBlock = (block: DiffBlock) => {
    if (onApplyBlock) {
      const addedLines = block.lines.filter(line => line.type === 'added');
      const content = addedLines.map(line => line.content).join('\n');
      onApplyBlock(block.startLine, block.endLine, content);
    }
  };

  const handleDiscardBlock = (block: DiffBlock) => {
    if (onDiscardBlock) {
      onDiscardBlock(block.startLine, block.endLine);
    }
  };

  if (viewMode === 'inline') {
    // 全体リストで各変更ブロックの先頭にボタンを表示
    let lineGlobalIndex = 0;
    return (
      <div
        className="font-mono text-sm border rounded"
        style={{ borderColor: colors.border }}
      >
        {diffBlocks.map((block, blockIndex) => {
          if (block.type === 'changed') {
            return (
              <React.Fragment key={blockIndex}>
                {/* 変更ブロック先頭にボタン */}
                <div
                  className="flex gap-1 items-center px-2 py-1"
                  style={{ background: colors.mutedBg }}
                >
                  <span
                    className="text-xs font-medium"
                    style={{ color: colors.foreground }}
                  >
                    変更ブロック {blockIndex + 1}（行 {block.startLine}-{block.endLine}）
                  </span>
                  <button
                    className="text-xs px-2 py-1 rounded hover:opacity-90 border"
                    style={{
                      background: colors.green,
                      color: colors.background,
                      borderColor: colors.green,
                      fontWeight: 600,
                      boxShadow: '0 1px 4px 0 #0002',
                    }}
                    onClick={() => handleApplyBlock(block)}
                  >
                    適用
                  </button>
                  <button
                    className="text-xs px-2 py-1 rounded hover:opacity-80"
                    style={{ background: colors.red, color: colors.background }}
                    onClick={() => handleDiscardBlock(block)}
                  >
                    破棄
                  </button>
                </div>
                {block.lines.map((line, lineIndex) => {
                  lineGlobalIndex++;
                  return (
                    <DiffLineComponent
                      key={lineGlobalIndex}
                      line={line}
                      colors={colors}
                    />
                  );
                })}
              </React.Fragment>
            );
          } else {
            // unchanged
            return block.lines.map((line, lineIndex) => {
              lineGlobalIndex++;
              return (
                <DiffLineComponent
                  key={lineGlobalIndex}
                  line={line}
                  colors={colors}
                />
              );
            });
          }
        })}
      </div>
    );
  }
  // blockモード（従来通り）
  return (
    <div
      className="font-mono text-sm border rounded"
      style={{ borderColor: colors.border }}
    >
      {diffBlocks.map((block, blockIndex) => (
        <div key={blockIndex}>
          {block.type === 'changed' ? (
            <div>
              {/* 変更ブロックヘッダー */}
              <div
                className="flex items-center justify-between px-3 py-2 border-b cursor-pointer hover:opacity-80"
                style={{
                  background: colors.mutedBg,
                  borderColor: colors.border,
                }}
                onClick={() => toggleBlockExpansion(blockIndex)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-medium"
                    style={{ color: colors.foreground }}
                  >
                    {expandedBlocks.has(blockIndex) ? '▼' : '▶'}
                    変更ブロック {blockIndex + 1}
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: colors.mutedFg }}
                  >
                    行 {block.startLine}-{block.endLine}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    className="text-xs px-2 py-1 rounded hover:opacity-90 border"
                    style={{
                      background: colors.green,
                      color: colors.background,
                      borderColor: colors.green,
                      fontWeight: 600,
                      boxShadow: '0 1px 4px 0 #0002',
                    }}
                    onClick={e => {
                      e.stopPropagation();
                      handleApplyBlock(block);
                    }}
                  >
                    適用
                  </button>
                  <button
                    className="text-xs px-2 py-1 rounded hover:opacity-80"
                    style={{ background: colors.red, color: colors.background }}
                    onClick={e => {
                      e.stopPropagation();
                      handleDiscardBlock(block);
                    }}
                  >
                    破棄
                  </button>
                </div>
              </div>

              {/* 変更内容 */}
              {expandedBlocks.has(blockIndex) && (
                <div>
                  {block.lines.map((line, lineIndex) => (
                    <DiffLineComponent
                      key={lineIndex}
                      line={line}
                      colors={colors}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            // 未変更ブロック（最初の3行と最後の3行のみ表示）
            <div>
              {block.lines.length > 6 ? (
                <>
                  {block.lines.slice(0, 3).map((line, lineIndex) => (
                    <DiffLineComponent
                      key={lineIndex}
                      line={line}
                      colors={colors}
                    />
                  ))}
                  <div
                    className="flex items-center justify-center py-2 text-xs cursor-pointer hover:opacity-80"
                    style={{
                      background: colors.mutedBg,
                      color: colors.mutedFg,
                    }}
                    onClick={() => toggleBlockExpansion(blockIndex)}
                  >
                    {expandedBlocks.has(blockIndex)
                      ? '▲ 折りたたむ'
                      : `▼ ${block.lines.length - 6}行を展開`}
                  </div>
                  {expandedBlocks.has(blockIndex) &&
                    block.lines.slice(3, -3).map((line, lineIndex) => (
                      <DiffLineComponent
                        key={lineIndex + 3}
                        line={line}
                        colors={colors}
                      />
                    ))}
                  {block.lines.slice(-3).map((line, lineIndex) => (
                    <DiffLineComponent
                      key={lineIndex + block.lines.length - 3}
                      line={line}
                      colors={colors}
                    />
                  ))}
                </>
              ) : (
                block.lines.map((line, lineIndex) => (
                  <DiffLineComponent
                    key={lineIndex}
                    line={line}
                    colors={colors}
                  />
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// 個別の差分行コンポーネント
function DiffLineComponent({ line, colors }: { line: DiffLine; colors: any }) {
  const getLineStyle = () => {
    switch (line.type) {
      case 'added':
        return {
          background: `${colors.green}20`, // 緑系背景
          borderLeft: `3px solid ${colors.green}`, // 緑系ボーダー
        };
      case 'removed':
        return {
          background: `${colors.red}20`,
          borderLeft: `3px solid ${colors.red}`,
        };
      default:
        return {
          background: 'none', // 既存行は色なし
        };
    }
  };

  const getLinePrefix = () => {
    switch (line.type) {
      case 'added':
        return '+';
      case 'removed':
        return '-';
      default:
        return ' ';
    }
  };

  return (
    <div
      className="flex hover:opacity-90"
      style={{
        ...getLineStyle(),
        color: colors.editorFg,
      }}
    >
      {/* 行番号 */}
      <div
        className="flex-shrink-0 px-2 py-1 text-right min-w-[60px] text-xs"
        style={{
          background: colors.mutedBg,
          color: colors.mutedFg,
          borderRight: `1px solid ${colors.border}`,
        }}
      >
        {line.oldLineNumber || ''}
      </div>
      <div
        className="flex-shrink-0 px-2 py-1 text-right min-w-[60px] text-xs"
        style={{
          background: colors.mutedBg,
          color: colors.mutedFg,
          borderRight: `1px solid ${colors.border}`,
        }}
      >
        {line.newLineNumber || ''}
      </div>

      {/* プレフィックス */}
      <div
        className="flex-shrink-0 px-2 py-1 text-xs font-bold"
        style={{
          color:
            line.type === 'added'
              ? colors.accent
              : line.type === 'removed'
                ? colors.red
                : colors.mutedFg,
        }}
      >
        {getLinePrefix()}
      </div>

      {/* コンテンツ */}
      <div className="flex-1 px-2 py-1 whitespace-pre-wrap">{line.content || ' '}</div>
    </div>
  );
}
