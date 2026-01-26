'use client';

import React from 'react';
import type { FileItem } from '@/types';
import type { OperationListItem } from '@/components/Top/OperationWindow';
import { getIconSrcForFile, highlightMatch } from '@/components/Top/OperationUtils';

interface Props {
  viewMode: 'files' | 'list';
  filteredFiles: FileItem[];
  filteredItems: OperationListItem[];
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  handleFileSelectInOperation: (file: FileItem) => void;
  ITEM_HEIGHT: number;
  colors: any;
  queryTokens: string[];
  t: (k: string) => string;
}

export default function OperationList({
  viewMode,
  filteredFiles,
  filteredItems,
  selectedIndex,
  setSelectedIndex,
  handleFileSelectInOperation,
  ITEM_HEIGHT,
  colors,
  queryTokens,
  t,
}: Props) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: '200px', maxHeight: 'calc(40vh - 80px)' }}>
      {viewMode === 'files' ? (
        filteredFiles.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: colors.mutedFg }}>
            {t('operationWindow.noFilesFound')}
          </div>
        ) : (
          filteredFiles.map((file, index) => {
            const isSelected = index === selectedIndex;
            const pathParts = file.path.split('/');
            const dirPath = pathParts.slice(0, -1).join('/');

            return (
              <div
                key={file.id}
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
                onClick={() => handleFileSelectInOperation(file)}
                onMouseEnter={() => setSelectedIndex(index)}
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
                  {highlightMatch(file.name, queryTokens, isSelected, colors)}
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
                    {highlightMatch(dirPath, queryTokens, isSelected, colors)}
                  </span>
                )}
              </div>
            );
          })
        )
      ) : filteredItems.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: colors.mutedFg }}>
          {t('operationWindow.noItemsFound') || 'No items found'}
        </div>
      ) : (
        filteredItems.map((item, index) => {
          const isSelected = index === selectedIndex;

          return (
            <div
              key={item.id}
              className="group"
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
                position: 'relative',
              }}
              onClick={() => !item.isEditing && item.onClick?.()}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {item.icon && (
                <div
                  style={{
                    width: 16,
                    height: 16,
                    flex: '0 0 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {typeof item.icon === 'string' ? (
                    <img src={item.icon} alt="" style={{ width: '100%', height: '100%' }} />
                  ) : (
                    item.icon
                  )}
                </div>
              )}

              {item.isEditing ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="text"
                    value={item.editValue ?? item.label}
                    onChange={e => item.onEditChange?.(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        item.onEditConfirm?.();
                      } else if (e.key === 'Escape') {
                        e.stopPropagation();
                        item.onEditCancel?.();
                      }
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      flex: 1,
                      height: '18px',
                      fontSize: '13px',
                      padding: '0 4px',
                      border: `1px solid ${colors.accent}`,
                      background: colors.background,
                      color: colors.foreground,
                      borderRadius: '2px',
                      outline: 'none',
                    }}
                  />
                </div>
              ) : (
                <>
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: isSelected || item.isActive ? '600' : '400',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1,
                    }}
                  >
                    {highlightMatch(item.label, queryTokens, isSelected, colors)}
                  </span>
                  {item.description && (
                    <span
                      style={{
                        fontSize: '11px',
                        color: isSelected ? 'rgba(255,255,255,0.8)' : colors.mutedFg,
                        marginLeft: '8px',
                      }}
                    >
                      {highlightMatch(item.description, queryTokens, isSelected, colors)}
                    </span>
                  )}
                </>
              )}

              {!item.isEditing && item.actions && item.actions.length > 0 && (
                <div
                  style={{ display: isSelected ? 'flex' : 'none', gap: '4px', marginLeft: 'auto' }}
                >
                  {item.actions.map(action => (
                    <button
                      key={action.id}
                      onClick={e => {
                        e.stopPropagation();
                        action.onClick(e);
                      }}
                      title={action.label}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: action.danger
                          ? isSelected
                            ? '#ffcccc'
                            : colors.destructive
                          : isSelected
                            ? 'white'
                            : colors.foreground,
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: '3px',
                      }}
                      onMouseEnter={e =>
                        (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')
                      }
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {action.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
