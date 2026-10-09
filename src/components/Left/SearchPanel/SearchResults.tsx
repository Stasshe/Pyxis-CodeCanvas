import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, FileText, Repeat, Search } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { type ThemeColors, useTheme } from '@/context/ThemeContext';
import type { FileItem } from '@/types';
import ResultRow from '../ResultRow';
import type { SearchFlatItem, SearchResult } from './types';

interface SearchResultsProps {
  searchQuery: string;
  isSearching: boolean;
  searchResults: SearchResult[];
  flatItems: SearchFlatItem[];
  flatResults: SearchResult[];
  selectedIndex: number;
  replaceQuery: string;
  hoveredFileKey: string | null;
  hoveredResultKey: string | null;
  onToggleFile: (key: string) => void;
  onHoverFile: (key: string | null) => void;
  onHoverResult: (key: string | null) => void;
  onResultClick: (result: SearchResult, index: number) => void;
  onReplaceResult: (result: SearchResult, replacement: string) => void;
  onReplaceAllInFile: (file: FileItem, replacement: string) => void;
}

export default function SearchResults({
  searchQuery,
  isSearching,
  searchResults,
  flatItems,
  flatResults,
  selectedIndex,
  replaceQuery,
  hoveredFileKey,
  hoveredResultKey,
  onToggleFile,
  onHoverFile,
  onHoverResult,
  onResultClick,
  onReplaceResult,
  onReplaceAllInFile,
}: SearchResultsProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const resultsScrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => resultsScrollRef.current,
    estimateSize: index => {
      const item = flatItems[index];
      if (item?.type === 'header') return 28;
      return 22;
    },
    overscan: 15,
  });

  return (
    <div ref={resultsScrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
      {searchQuery && !isSearching && searchResults.length === 0 && (
        <div style={{ padding: '0.5rem', textAlign: 'center', color: colors.mutedFg }}>
          <Search
            size={24}
            style={{
              display: 'block',
              margin: '0 auto 0.5rem',
              opacity: 0.5,
              color: colors.mutedFg,
            }}
          />
          <p style={{ fontSize: '0.75rem' }}>{t('searchPanel.noResults')}</p>
        </div>
      )}

      {flatItems.length > 0 && (
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative', padding: '0.14rem' }}
        >
          {virtualizer.getVirtualItems().map(virtualItem => {
            const item = flatItems[virtualItem.index];
            if (!item) return null;

            if (item.type === 'header') {
              const { groupKey, first, resultCount, isCollapsed } = item;
              const isFileHovered = hoveredFileKey === groupKey;
              const isSelectedFile = flatResults[selectedIndex]?.file.id === first.file.id;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: virtualItem.start,
                    left: 0,
                    right: 0,
                    padding: '0.18rem 0.28rem',
                    borderBottom: `1px solid ${colors.border}`,
                    minWidth: 0,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onToggleFile(groupKey)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onToggleFile(groupKey);
                      }
                    }}
                    onMouseEnter={() => onHoverFile(groupKey)}
                    onMouseLeave={() => onHoverFile(null)}
                    onFocus={() => onHoverFile(groupKey)}
                    onBlur={() => onHoverFile(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.22rem',
                      cursor: 'pointer',
                      userSelect: 'none',
                      minWidth: 0,
                    }}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} color={colors.mutedFg} />
                    ) : (
                      <ChevronDown size={14} color={colors.mutedFg} />
                    )}
                    <FileText size={12} color={colors.primary} style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        color: colors.foreground,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '40%',
                        minWidth: 0,
                      }}
                    >
                      {first.file.name}
                    </span>
                    <span
                      style={{ color: colors.mutedFg, marginLeft: '0.3rem', fontSize: '0.6rem' }}
                    >
                      {resultCount} hits
                    </span>
                    <span
                      style={{
                        marginLeft: '0.5rem',
                        color: colors.mutedFg,
                        fontSize: '0.62rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '35%',
                        minWidth: 0,
                      }}
                    >
                      {first.file.path}
                    </span>
                    {(isFileHovered || isSelectedFile) && (
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          onReplaceAllInFile(first.file, replaceQuery);
                        }}
                        title="Replace all in file"
                        style={{
                          marginLeft: 'auto',
                          padding: '0.12rem 0.3rem',
                          borderRadius: '0.28rem',
                          border: `1px solid ${colors.border}`,
                          background: colors.mutedBg,
                          color: colors.mutedFg,
                          fontSize: '0.6rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        <Repeat size={12} />
                        All
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            const { result, globalIndex, idxInGroup } = item;
            const resultKey = `${result.file.id}-${result.line}-${idxInGroup}`;
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: virtualItem.start,
                  left: 0,
                  right: 0,
                  paddingLeft: '1.6rem',
                }}
              >
                <ResultRow
                  result={result}
                  globalIndex={globalIndex}
                  isSelected={globalIndex === selectedIndex}
                  resultKey={resultKey}
                  colors={colors as ThemeColors}
                  isHovered={hoveredResultKey === resultKey}
                  onHoverChange={onHoverResult}
                  onClick={onResultClick}
                  onReplace={onReplaceResult}
                  replaceQuery={replaceQuery}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
