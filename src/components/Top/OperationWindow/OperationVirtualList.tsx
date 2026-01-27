'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useMemo, useRef, useEffect } from 'react';
import type { OperationListItem } from './OperationWindow';
import type { FileItem } from '@/types';
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
  colors: any;
  queryTokens: string[];
  t: (k: string) => string;
  listRef?: React.RefObject<HTMLDivElement>;
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
  t,
  listRef,
}: Props) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const parentRef = listRef ?? localRef;

  const count = viewMode === 'files' ? filteredFiles.length : filteredItems.length;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current ?? null,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  // Avoid calling virtualizer.getVirtualItems() directly in render (may trigger internal flushSync).
  // Instead, maintain local state and update it asynchronously on scroll/resize/count changes.
  const [virtualItems, setVirtualItems] = React.useState(() => virtualizer.getVirtualItems());

  useEffect(() => {
    let mounted = true;

    const sync = () => {
      if (!mounted) return;
      try {
        const items = virtualizer.getVirtualItems();
        setVirtualItems(prev => {
          if (!prev || prev.length !== items.length) return items;
          for (let i = 0; i < prev.length; i++) {
            const p = prev[i];
            const n = items[i];
            if (!n) return items;
            if (p.index !== n.index || p.start !== n.start || p.size !== n.size) return items;
          }
          return prev;
        });
      } catch (e) {
        // ignore errors
      }
    };

    // initial sync on next microtask to avoid calling during render
    Promise.resolve().then(sync);

    const el = parentRef.current;
    if (el) {
      el.addEventListener('scroll', sync, { passive: true });
    }
    window.addEventListener('resize', sync);

    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(sync);
      if (el) ro.observe(el);
    } catch (e) {
      // ResizeObserver might not be available in test envs
    }

    // Also resync when count or ITEM_HEIGHT changes
    // (these are included in deps below)

    return () => {
      mounted = false;
      if (el) el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      if (ro) ro.disconnect();
    };
  }, [virtualizer, count, ITEM_HEIGHT, parentRef]);

  // Ensure the virtualized list scrolls to the selected index when it changes.
  useEffect(() => {
    if (selectedIndex == null) return;
    if (selectedIndex < 0 || selectedIndex >= count) return;
    // Let the virtualizer handle efficient scrolling/measurement
    try {
      // scrollToIndex is provided by @tanstack/react-virtual virtualizer
      // align 'auto' lets it only scroll when needed
      (virtualizer as any).scrollToIndex?.(selectedIndex, { align: 'auto' });
    } catch (e) {
      // ignore failures silently
    }
  }, [selectedIndex, virtualizer, count]);

  // Empty states
  if (count === 0) {
    return (
      <div
        ref={parentRef as React.RefObject<HTMLDivElement>}
        style={{ flex: 1, overflowY: 'auto', minHeight: '200px', maxHeight: 'calc(40vh - 80px)' }}
      >
        <div style={{ padding: '20px', textAlign: 'center', color: colors.mutedFg }}>
          {viewMode === 'files' ? t('operationWindow.noFilesFound') : t('operationWindow.noItemsFound')}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef as React.RefObject<HTMLDivElement>}
      style={{ flex: 1, overflowY: 'auto', minHeight: '200px', maxHeight: 'calc(40vh - 80px)' }}
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
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
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${size}px`, transform: `translateY(${top}px)` }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <OperationFileRow
                  file={file}
                  isSelected={isSelected}
                  ITEM_HEIGHT={ITEM_HEIGHT}
                  colors={colors}
                  queryTokens={queryTokens}
                  onClick={() => handleFileSelectInOperation(file)}
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
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${size}px`, transform: `translateY(${top}px)` }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <OperationGenericRow
                item={item}
                isSelected={isSelected}
                ITEM_HEIGHT={ITEM_HEIGHT}
                colors={colors}
                queryTokens={queryTokens}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
