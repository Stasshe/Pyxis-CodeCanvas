'use client';

import { getIconSrcForFile, highlightMatch } from '@/components/Top/OperationWindow/OperationUtils';
import type { ThemeColors } from '@/context/ThemeContext';
import type { FileItem } from '@/types';
import React from 'react';

interface Props {
  file: FileItem;
  isSelected: boolean;
  ITEM_HEIGHT: number;
  colors: ThemeColors;
  queryTokens: string[];
  // Stable callback invoked with the file when a row is activated
  onActivate?: (file: FileItem) => void;
}

function OperationFileRowInner({
  file,
  isSelected,
  ITEM_HEIGHT,
  colors,
  queryTokens,
  onActivate,
}: Props) {
  const pathParts = file.path.split('/');
  const dirPath = pathParts.slice(0, -1).join('/');

  const highlightedName = highlightMatch(file.name, queryTokens, isSelected, colors);
  const highlightedDir = dirPath ? highlightMatch(dirPath, queryTokens, isSelected, colors) : null;

  return (
    <div
      onClick={() => onActivate?.(file)}
      style={{
        height: ITEM_HEIGHT,
        boxSizing: 'border-box',
        padding: '2px 12px',
        background: isSelected ? colors.primary : 'transparent',
        color: isSelected ? colors.cardBg : colors.foreground,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        borderLeft: isSelected ? `3px solid ${colors.accentBg}` : '3px solid transparent',
      }}
    >
      <img
        src={getIconSrcForFile(file.name)}
        alt="icon"
        style={{ width: 16, height: 16, flex: '0 0 16px' }}
      />
      <span
        style={{
          fontSize: '13px',
          fontWeight: isSelected ? '600' : '400',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: '120px',
          maxWidth: '200px',
        }}
      >
        {highlightedName}
      </span>
      {dirPath && (
        <span
          style={{
            fontSize: '11px',
            color: isSelected ? 'rgba(255,255,255,0.8)' : colors.mutedFg,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginLeft: 'auto',
            fontFamily: 'monospace',
            textAlign: 'right',
          }}
        >
          {highlightedDir}
        </span>
      )}
    </div>
  );
}

function arePropsEqual(prev: Props, next: Props) {
  // quick shallow comparisons for frequently changing inputs
  if (prev.file.id !== next.file.id) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.ITEM_HEIGHT !== next.ITEM_HEIGHT) return false;
  if (prev.onActivate !== next.onActivate) return false;
  // shallow compare query tokens
  const a = prev.queryTokens || [];
  const b = next.queryTokens || [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  // colors comparisons (check few keys)
  if (prev.colors?.foreground !== next.colors?.foreground) return false;
  if (prev.colors?.primary !== next.colors?.primary) return false;
  if (prev.colors?.accentBg !== next.colors?.accentBg) return false;
  return true;
}

export default React.memo(OperationFileRowInner, arePropsEqual);
