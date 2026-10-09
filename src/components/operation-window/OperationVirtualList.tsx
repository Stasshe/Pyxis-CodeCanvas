import { useVirtualizer } from '@tanstack/react-virtual';
import type React from 'react';
import { useEffect, useRef } from 'react';
import type { ThemeColors } from '@/context/ThemeContext';
import type { FileItem } from '@/types/index';
import type { OperationListItem } from '../../engine/ide/search/operationWindowTypes';
import OperationFileRow from './OperationFileRow';
import OperationGenericRow from './OperationGenericRow';

interface Props {
  viewMode: 'files' | 'list';
  filteredFiles: FileItem[];
  filteredItems: OperationListItem[];
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  handleFileSelectInOperation: (file: FileItem) => void;
  ITEM_HEIGHT: number;
  colors: ThemeColors;
  queryTokens: string[];
  onActivateItem: (item: OperationListItem) => void;
  loading: boolean;
  emptyMessage?: string;
  disabled: boolean;
  t: (k: string) => string;
  listId: string;
  rootPath: string | null;
  // allow nullable ref objects (useRef<HTMLDivElement | null>(null) is common)
  listRef?: React.RefObject<HTMLDivElement | null>;
}

export default function OperationVirtualList({
  viewMode,
  filteredFiles,
  filteredItems,
  selectedIndex,
  setSelectedIndex,
  handleFileSelectInOperation,
  ITEM_HEIGHT,
  colors,
  queryTokens,
  onActivateItem,
  loading,
  emptyMessage,
  disabled,
  t,
  listId,
  rootPath,
  listRef,
}: Props) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const parentRef = listRef ?? localRef;

  const count = viewMode === 'files' ? filteredFiles.length : filteredItems.length;

  const optionId = (index: number) => `${listId}-option-${index}`;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current ?? null,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Ensure the virtualized list scrolls to the selected index when it changes.
  useEffect(() => {
    if (selectedIndex == null) return;
    if (selectedIndex < 0 || selectedIndex >= count) return;
    virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex, virtualizer, count]);

  // Empty states
  if (count === 0) {
    return (
      <div
        id={listId}
        role="listbox"
        aria-label="Quick pick results"
        ref={parentRef as React.RefObject<HTMLDivElement | null>}
        style={{ maxHeight: 440, overflowY: 'auto', minHeight: 0 }}
      >
        <div style={{ padding: '20px', textAlign: 'center', color: colors.mutedFg }}>
          {loading
            ? 'Loading…'
            : (emptyMessage ??
              (viewMode === 'files'
                ? t('operationWindow.noFilesFound')
                : t('operationWindow.noItemsFound')))}
        </div>
      </div>
    );
  }

  return (
    <div
      id={listId}
      role="listbox"
      aria-label="Quick pick results"
      ref={parentRef as React.RefObject<HTMLDivElement | null>}
      style={{ maxHeight: 440, overflowY: 'auto', minHeight: 0 }}
    >
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
      >
        {virtualItems.map(virtualItem => {
          const index = virtualItem.index;
          const top = virtualItem.start;
          const size = virtualItem.size;

          if (viewMode === 'files') {
            const file = filteredFiles[index];
            if (!file) return null;

            const isSelected = index === selectedIndex;

            return (
              <div
                key={file.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${size}px`,
                  transform: `translateY(${top}px)`,
                }}
                onMouseMove={() => setSelectedIndex(index)}
              >
                <OperationFileRow
                  file={file}
                  isSelected={isSelected}
                  ITEM_HEIGHT={ITEM_HEIGHT}
                  colors={colors}
                  queryTokens={queryTokens}
                  optionId={optionId(index)}
                  rootPath={rootPath}
                  onActivate={handleFileSelectInOperation}
                />
              </div>
            );
          }

          const item = filteredItems[index];
          if (!item) return null;
          const isSelected = index === selectedIndex;

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${size}px`,
                transform: `translateY(${top}px)`,
              }}
              onMouseMove={() => setSelectedIndex(index)}
            >
              <OperationGenericRow
                item={item}
                isSelected={isSelected}
                ITEM_HEIGHT={ITEM_HEIGHT}
                colors={colors}
                queryTokens={queryTokens}
                optionId={optionId(index)}
                onActivate={onActivateItem}
                disabled={disabled}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
