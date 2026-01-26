'use client';
import React, { memo } from 'react';

interface FileItemProps {
  file: string;
  color: string;
  onPrimaryAction: (file: string) => void;
  onSecondaryAction?: (file: string) => void;
  onFileClick?: (file: string) => void;
  primaryIcon: React.ReactNode;
  secondaryIcon?: React.ReactNode;
  primaryTitle: string;
  secondaryTitle?: string;
  fileClickTitle?: string;
  colors: {
    mutedBg: string;
    primary: string;
    red: string;
  };
}

const FileItem = memo(function FileItem({
  file,
  color,
  onPrimaryAction,
  onSecondaryAction,
  onFileClick,
  primaryIcon,
  secondaryIcon,
  primaryTitle,
  secondaryTitle,
  fileClickTitle,
  colors,
}: FileItemProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.75rem',
        padding: '0.25rem 0',
      }}
    >
      <span
        style={{
          color,
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: onFileClick ? 'pointer' : 'default',
          textDecoration: onFileClick ? 'underline' : 'none',
        }}
        className="select-text"
        title={fileClickTitle}
        onClick={onFileClick ? () => onFileClick(file) : undefined}
      >
        {file}
      </span>
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        <button
          onClick={() => onPrimaryAction(file)}
          style={{
            padding: '0.25rem',
            background: 'transparent',
            borderRadius: '0.375rem',
            border: 'none',
            cursor: 'pointer',
          }}
          title={primaryTitle}
          className="select-none"
          onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {primaryIcon}
        </button>
        {onSecondaryAction && secondaryIcon && (
          <button
            onClick={() => onSecondaryAction(file)}
            style={{
              padding: '0.25rem',
              background: 'transparent',
              borderRadius: '0.375rem',
              border: 'none',
              cursor: 'pointer',
            }}
            title={secondaryTitle}
            className="select-none"
            onMouseEnter={e => (e.currentTarget.style.background = colors.mutedBg)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {secondaryIcon}
          </button>
        )}
      </div>
    </div>
  );
});

export default FileItem;
