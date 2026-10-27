import React from 'react';
import { getIconSrcForFile, highlightMatch } from '@/components/operation-window/itemRendering';
import type { ThemeColors } from '@/context/ThemeContext';
import type { FileItem } from '@/types/index';

interface Props {
  file: FileItem;
  isSelected: boolean;
  ITEM_HEIGHT: number;
  colors: ThemeColors;
  queryTokens: string[];
  optionId: string;
  rootPath: string | null;
  // Stable callback invoked with the file when a row is activated
  onActivate?: (file: FileItem) => void;
}

function OperationFileRowInner({
  file,
  isSelected,
  ITEM_HEIGHT,
  colors,
  queryTokens,
  optionId,
  rootPath,
  onActivate,
}: Props) {
  let relativePath = file.path;
  if (rootPath && file.path.startsWith(`${rootPath}/`)) {
    relativePath = file.path.slice(rootPath.length + 1);
  }
  const lastSlash = relativePath.lastIndexOf('/');
  let dirPath = '';
  if (lastSlash >= 0) dirPath = relativePath.slice(0, lastSlash);
  const highlightedName = highlightMatch(file.name, queryTokens, isSelected, colors);
  let highlightedDir: React.ReactNode = null;
  if (dirPath) highlightedDir = highlightMatch(dirPath, queryTokens, isSelected, colors);
  let background = 'transparent';
  let color = colors.foreground;
  if (isSelected) {
    background = colors.editorSelection;
    color = colors.editorFg;
  }

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={isSelected}
      onClick={() => onActivate?.(file)}
      style={{
        height: ITEM_HEIGHT,
        boxSizing: 'border-box',
        padding: '0 6px',
        background,
        color,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: 0,
      }}
    >
      <img
        src={getIconSrcForFile(file.name)}
        alt=""
        style={{ width: 16, height: 16, flex: '0 0 16px' }}
      />
      <span
        style={{
          fontSize: '13px',
          fontWeight: '400',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {highlightedName}
      </span>
      {dirPath && (
        <span
          style={{
            fontSize: '11px',
            color: isSelected ? colors.editorFg : colors.mutedFg,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginLeft: 0,
            minWidth: 0,
          }}
        >
          {highlightedDir}
        </span>
      )}
    </div>
  );
}

export default React.memo(OperationFileRowInner);
