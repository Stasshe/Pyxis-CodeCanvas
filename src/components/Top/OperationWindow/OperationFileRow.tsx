'use client';

import React, { useMemo } from 'react';
import { getIconSrcForFile, highlightMatch } from '@/components/Top/OperationWindow/OperationUtils';
import type { FileItem } from '@/types';

interface Props {
  file: FileItem;
  isSelected: boolean;
  ITEM_HEIGHT: number;
  colors: any;
  queryTokens: string[];
  onClick?: () => void;
}

function OperationFileRowInner({ file, isSelected, ITEM_HEIGHT, colors, queryTokens, onClick }: Props) {
  const pathParts = file.path.split('/');
  const dirPath = pathParts.slice(0, -1).join('/');

  const highlightedName = useMemo(
    () => highlightMatch(file.name, queryTokens, isSelected, colors),
    [file.name, queryTokens, isSelected, colors]
  );

  const highlightedDir = useMemo(
    () => (dirPath ? highlightMatch(dirPath, queryTokens, isSelected, colors) : null),
    [dirPath, queryTokens, isSelected, colors]
  );

  return (
    <div
      onClick={onClick}
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
      <img src={getIconSrcForFile(file.name)} alt="icon" style={{ width: 16, height: 16, flex: '0 0 16px' }} />
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

export default React.memo(OperationFileRowInner, (prev, next) => {
  // Only re-render when selection or visible content changes
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.ITEM_HEIGHT !== next.ITEM_HEIGHT) return false;
  if (prev.colors !== next.colors) return false;
  if (prev.file.id !== next.file.id) return false;
  if (prev.file.name !== next.file.name) return false;
  // shallow compare queryTokens length and contents
  const a = prev.queryTokens || [];
  const b = next.queryTokens || [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
});
