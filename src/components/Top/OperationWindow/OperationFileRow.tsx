'use client';

import React from 'react';
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
  
  const highlightedName = highlightMatch(file.name, queryTokens, isSelected, colors);
  const highlightedDir = dirPath ? highlightMatch(dirPath, queryTokens, isSelected, colors) : null;

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

export default OperationFileRowInner;
