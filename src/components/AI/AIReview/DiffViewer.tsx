'use client';

import React, { useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { calculateDiff, groupDiffLines, calculateWordDiff } from '@/engine/ai/diffProcessor';
import type { DiffLine, DiffBlock } from '@/engine/ai/diffProcessor';
import { ChevronDown, ChevronRight, Check, Trash2 } from 'lucide-react';

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

  // Helper: apply alpha to hex or rgb/rgba color strings.
  // TODO: 簡易実装のため、エッジケースは未対応
  //  - hsl形式には非対応
  //  - rgbaでalphaが既にある場合は置換しない
  //  - 不正な色文字列はそのまま返す
  const withAlpha = (color: string | undefined, alpha = 0.12) => {
    if (!color) return undefined;
    const a = Math.max(0, Math.min(1, alpha));
    // hex 7 chars: #rrggbb
    if (color.startsWith('#')) {
      // normalize #rgb to #rrggbb
      if (color.length === 4) {
        const r = color[1];
        const g = color[2];
        const b = color[3];
        const hex = `#${r}${r}${g}${g}${b}${b}`;
        // convert alpha to two-hex
        const alphaHex = Math.round(a * 255)
          .toString(16)
          .padStart(2, '0');
        return `${hex}${alphaHex}`;
      }
      if (color.length === 7) {
        const alphaHex = Math.round(a * 255)
          .toString(16)
          .padStart(2, '0');
        return `${color}${alphaHex}`;
      }
      // already has alpha or other form
      return color;
    }
    // rgba or rgb
    if (color.startsWith('rgb')) {
      // replace existing alpha if rgba
      const parts = color
        .replace(/rgba?\(|\)/g, '')
        .split(',')
        .map(p => p.trim());
      const [r, g, b] = parts;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    // fallback: return original
    return color;
  };

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
        style={{ borderColor: colors.border, background: colors.cardBg }}
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
                  <div className="flex items-center gap-2">
                    {/** expand icon is not interactive here, just a visual marker */}
                    <span style={{ display: 'inline-flex' }}>
                      <ChevronRight
                        size={14}
                        color={colors.mutedFg}
                      />
                    </span>
                    <span
                      className="text-xs font-medium"
                      style={{ color: colors.foreground }}
                    >
                      変更ブロック {blockIndex + 1}（行 {block.startLine}-{block.endLine}）
                    </span>
                  </div>
                  <button
                    className="text-xs px-2 py-1 rounded hover:opacity-90 border"
                    style={{
                      background: colors.green,
                      color: '#fff',
                      borderColor: colors.green,
                      fontWeight: 600,
                      boxShadow: '0 1px 4px 0 #0002',
                    }}
                    onClick={() => handleApplyBlock(block)}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Check size={12} /> 適用
                    </span>
                  </button>
                  <button
                    className="text-xs px-2 py-1 rounded hover:opacity-80"
                    style={{ background: colors.red, color: '#fff' }}
                    onClick={() => handleDiscardBlock(block)}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Trash2 size={12} /> 破棄
                    </span>
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
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {expandedBlocks.has(blockIndex) ? (
                      <ChevronDown
                        size={14}
                        color={colors.mutedFg}
                      />
                    ) : (
                      <ChevronRight
                        size={14}
                        color={colors.mutedFg}
                      />
                    )}
                  </span>
                  <span
                    className="text-xs font-medium"
                    style={{ color: colors.foreground }}
                  >
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
                      color: '#fff',
                      borderColor: colors.green,
                      fontWeight: 600,
                      boxShadow: '0 1px 4px 0 #0002',
                    }}
                    onClick={e => {
                      e.stopPropagation();
                      handleApplyBlock(block);
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Check size={12} /> 適用
                    </span>
                  </button>
                  <button
                    className="text-xs px-2 py-1 rounded hover:opacity-80"
                    style={{ background: colors.red, color: '#fff' }}
                    onClick={e => {
                      e.stopPropagation();
                      handleDiscardBlock(block);
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Trash2 size={12} /> 破棄
                    </span>
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
                      withAlpha={withAlpha}
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
                      withAlpha={withAlpha}
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
                    {expandedBlocks.has(blockIndex) ? (
                      <span className="inline-flex items-center gap-2">
                        <ChevronDown
                          size={14}
                          color={colors.mutedFg}
                        />{' '}
                        折りたたむ
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <ChevronRight
                          size={14}
                          color={colors.mutedFg}
                        />{' '}
                        {block.lines.length - 6}行を展開
                      </span>
                    )}
                  </div>
                  {expandedBlocks.has(blockIndex) &&
                    block.lines.slice(3, -3).map((line, lineIndex) => (
                      <DiffLineComponent
                        key={lineIndex + 3}
                        line={line}
                        colors={colors}
                        withAlpha={withAlpha}
                      />
                    ))}
                  {block.lines.slice(-3).map((line, lineIndex) => (
                    <DiffLineComponent
                      key={lineIndex + block.lines.length - 3}
                      line={line}
                      colors={colors}
                      withAlpha={withAlpha}
                    />
                  ))}
                </>
              ) : (
                block.lines.map((line, lineIndex) => (
                  <DiffLineComponent
                    key={lineIndex}
                    line={line}
                    colors={colors}
                    withAlpha={withAlpha}
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
function DiffLineComponent({
  line,
  colors,
  withAlpha,
}: {
  line: DiffLine;
  colors: any;
  withAlpha?: (color: string | undefined, alpha?: number) => string | undefined;
}) {
  const getLineStyle = () => {
    switch (line.type) {
      case 'added':
        return {
          background: withAlpha ? withAlpha(colors.green, 0.12) : `${colors.green}20`, // 緑系背景
          borderLeft: `3px solid ${colors.green}`, // 緑系ボーダー
        };
      case 'removed':
        return {
          background: withAlpha ? withAlpha(colors.red, 0.12) : `${colors.red}20`,
          borderLeft: `3px solid ${colors.red}`,
        };
      default:
        return {
          background: 'transparent', // 既存行は色なし
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

  const prefixColor =
    line.type === 'added' ? colors.green : line.type === 'removed' ? colors.red : colors.mutedFg;

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
        {typeof line.oldLineNumber !== 'undefined' && line.oldLineNumber !== null
          ? line.oldLineNumber
          : ''}
      </div>
      <div
        className="flex-shrink-0 px-2 py-1 text-right min-w-[60px] text-xs"
        style={{
          background: colors.mutedBg,
          color: colors.mutedFg,
          borderRight: `1px solid ${colors.border}`,
        }}
      >
        {typeof line.newLineNumber !== 'undefined' && line.newLineNumber !== null
          ? line.newLineNumber
          : ''}
      </div>

      {/* プレフィックス */}
      <div
        className="flex-shrink-0 px-2 py-1 text-xs font-bold"
        style={{
          color: prefixColor,
        }}
      >
        {getLinePrefix()}
      </div>

      {/* コンテンツ */}
      <div className="flex-1 px-2 py-1 whitespace-pre-wrap">{line.content || ' '}</div>
    </div>
  );
}
