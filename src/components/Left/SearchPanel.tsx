import { ChevronDown, ChevronRight, Edit3, File, FileText, Repeat, Search, X } from 'lucide-react';
import { PropsWithChildren, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { type ThemeColors, useTheme } from '@/context/ThemeContext';
import { fileRepository } from '@/engine/core/fileRepository';
import { useSettings } from '@/hooks/state/useSettings';
import { tabActions } from '@/stores/tabState';
import type { FileItem } from '@/types';
import ResultRow from './ResultRow';

interface SearchPanelProps {
  files: FileItem[];
  projectId: string;
}

interface SearchResult {
  file: FileItem;
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

// シンプルなファイルペイロード型（Workerへ送信用）
interface FilePayload {
  id: string;
  path: string;
  name: string;
  content: string | undefined;
  isBufferArray: boolean | undefined;
}

// ファイル数閾値：この数以下ならリアルタイム検索
const REALTIME_FILE_THRESHOLD = 50;

// Module-level memoized ResultRow to avoid recreating component each render
export type ResultRowProps = {
  result: SearchResult;
  globalIndex: number;
  isSelected: boolean;
  resultKey: string;
  colors: ThemeColors;
  isHovered: boolean;
  onHoverChange: (key: string | null) => void;
  onClick: (result: SearchResult, idx: number) => void;
  onReplace: (result: SearchResult, replacement: string) => void;
  replaceQuery: string;
};

export default function SearchPanel({ files, projectId }: SearchPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { openTab } = tabActions;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [searchInFilenames, setSearchInFilenames] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredFileKey, setHoveredFileKey] = useState<string | null>(null);
  const [hoveredResultKey, setHoveredResultKey] = useState<string | null>(null);
  const { isExcluded } = useSettings(projectId);

  // 1文字から検索可能に
  const minQueryLength = 1;
  const debounceDelay = 300;

  const searchTimer = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const searchIdRef = useRef(0);

  // キャッシュ用ref
  const cachedFilesRef = useRef<FilePayload[] | null>(null);
  const lastFilesVersionRef = useRef<string>('');
  const lastFilesSentVersionRef = useRef<string | null>(null);
  const lastSearchOptionsRef = useRef<string>('');
  const lastSearchQueryRef = useRef<string>('');
  const lastSearchResultsRef = useRef<SearchResult[]>([]);

  // per-file collapsed state
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  // 全ファイルを再帰的に取得（isExcludedを適用）- memoized
  const allFiles = useMemo(() => {
    const result: FileItem[] = [];
    const traverse = (items: FileItem[]) => {
      for (const item of items) {
        if (item.type === 'file') {
          if (!isExcluded(item.path)) {
            result.push(item);
          }
        } else if (item.children) {
          traverse(item.children);
        }
      }
    };
    traverse(files);
    return result;
  }, [files, isExcluded]);

  // ファイル数
  const fileCount = allFiles.length;

  // リアルタイム検索を行うかどうか
  const isRealtimeSearch = fileCount <= REALTIME_FILE_THRESHOLD;

  // ファイルのバージョン計算（キャッシュ判定用）- memoized
  const filesVersion = useMemo(() => {
    return `${allFiles.length}:${allFiles.map(f => f.path).join(',')}`;
  }, [allFiles]);

  // 検索オプションキー
  const searchOptionsKey = useMemo(() => {
    return `${caseSensitive}:${wholeWord}:${useRegex}:${searchInFilenames}`;
  }, [caseSensitive, wholeWord, useRegex, searchInFilenames]);

  // ファイルペイロード - memoized
  const filePayloads = useMemo((): FilePayload[] => {
    // キャッシュが有効な場合は再利用
    if (cachedFilesRef.current && lastFilesVersionRef.current === filesVersion) {
      return cachedFilesRef.current;
    }

    // 新しいペイロードを構築
    const payloads: FilePayload[] = allFiles.map(f => ({
      id: f.id,
      path: f.path,
      name: f.name,
      content: f.content,
      isBufferArray: f.isBufferArray,
    }));

    // キャッシュを更新
    cachedFilesRef.current = payloads;
    lastFilesVersionRef.current = filesVersion;

    return payloads;
  }, [allFiles, filesVersion]);

  // 検索実行関数をrefで保持（useEffectの依存関係からステートを分離するため）
  // このパターンは最新のステート値を参照しつつ、useEffectの再実行を防ぐ
  const performSearchRef = useRef<(query: string) => void>(() => {});

  performSearchRef.current = (query: string) => {
    if (!query || !query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // 同じクエリ・オプションの場合はキャッシュを返す
    if (
      query === lastSearchQueryRef.current &&
      searchOptionsKey === lastSearchOptionsRef.current &&
      lastSearchResultsRef.current.length > 0
    ) {
      setSearchResults(lastSearchResultsRef.current);
      setIsSearching(false);
      return;
    }

    // Worker初期化
    if (!workerRef.current) {
      try {
        workerRef.current = new Worker(
          new URL('../../engine/workers/searchWorker.ts', import.meta.url),
          {
            type: 'module',
          }
        );

        workerRef.current.onmessage = e => {
          const msg = e.data;
          if (!msg) return;
          if (msg.type === 'result') {
            const id = msg.searchId;
            if (id !== searchIdRef.current) return; // stale
            const results = msg.results || [];
            setSearchResults(results);
            setIsSearching(false);

            // キャッシュを更新
            lastSearchResultsRef.current = results;
          }
        };
      } catch (err) {
        console.error('Failed to create search worker', err);
        setIsSearching(false);
        return;
      }
    }

    setIsSearching(true);
    const sid = (searchIdRef.current = (searchIdRef.current || 0) + 1);

    // キャッシュを更新
    lastSearchQueryRef.current = query;
    lastSearchOptionsRef.current = searchOptionsKey;

    try {
      // send files only if the file list/version changed to avoid expensive structured-clone copies on each search
      if (lastFilesSentVersionRef.current !== filesVersion) {
        workerRef.current?.postMessage({
          type: 'updateFiles',
          files: filePayloads,
          filesVersion,
        });
        lastFilesSentVersionRef.current = filesVersion;
      }

      // then send the actual search request without files (worker will reuse cached files)
      workerRef.current?.postMessage({
        type: 'search',
        searchId: sid,
        query,
        options: { caseSensitive, wholeWord, useRegex, searchInFilenames },
      });
    } catch (err) {
      console.error('Worker postMessage failed', err);
      setIsSearching(false);
    }
  };

  // 検索クエリ変更時の処理
  useEffect(() => {
    // タイマーをクリア
    if (searchTimer.current) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }

    // クエリが空または短すぎる場合
    if (!searchQuery || searchQuery.length < minQueryLength) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // リアルタイム検索モードの場合のみ自動検索
    if (isRealtimeSearch) {
      setIsSearching(true);
      searchTimer.current = window.setTimeout(() => {
        performSearchRef.current(searchQuery);
      }, debounceDelay);
    }

    return () => {
      if (searchTimer.current) {
        window.clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
    };
  }, [searchQuery, isRealtimeSearch, minQueryLength, debounceDelay]);

  // 検索オプション変更時にリアルタイム検索を再実行
  useEffect(() => {
    if (isRealtimeSearch && searchQuery && searchQuery.length >= minQueryLength) {
      // キャッシュをクリアして検索
      lastSearchResultsRef.current = [];
      performSearchRef.current(searchQuery);
    }
  }, [
    caseSensitive,
    wholeWord,
    useRegex,
    searchInFilenames,
    isRealtimeSearch,
    searchQuery,
    minQueryLength,
  ]);

  // Workerのクリーンアップ
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // ファイルが変更された場合、キャッシュをクリア
  useEffect(() => {
    // ファイルが変更されたのでキャッシュをクリア
    lastSearchResultsRef.current = [];
    lastSearchQueryRef.current = '';
  }, [filesVersion]);

  // flattened results for keyboard navigation
  const flatResults = searchResults;
  const currentSelected = flatResults[selectedIndex] || null;

  // Grouped results by file (memoized to avoid recomputing groups every render)
  const groupedResults: Array<{
    first: SearchResult;
    results: Array<{ result: SearchResult; globalIndex: number }>;
  }> = useMemo(() => {
    // Build groups while preserving each result's global index to avoid repeated indexOf calls during render
    const groupsMap: Record<
      string,
      { first: SearchResult; results: Array<{ result: SearchResult; globalIndex: number }> }
    > = {};
    for (let i = 0; i < searchResults.length; i++) {
      const r = searchResults[i];
      const key = r.file.id || r.file.path;
      if (!groupsMap[key]) groupsMap[key] = { first: r, results: [] };
      groupsMap[key].results.push({ result: r, globalIndex: i });
    }
    return Object.values(groupsMap);
  }, [searchResults]);

  useEffect(() => {
    // keep selection within bounds
    if (selectedIndex >= flatResults.length) {
      setSelectedIndex(Math.max(0, flatResults.length - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatResults.length]);

  const handleResultClick = useCallback(
    async (result: SearchResult) => {
      try {
        const projId = projectId;
        const fileEntry = await fileRepository.getFileByPath(projId, result.file.path);

        let isCodeMirror = false;
        if (typeof window !== 'undefined') {
          const defaultEditor = localStorage.getItem('pyxis-defaultEditor');
          isCodeMirror = defaultEditor === 'codemirror';
        }

        const fileWithJump = {
          ...(fileEntry || result.file),
          isCodeMirror,
          isBufferArray: fileEntry ? fileEntry.isBufferArray : result.file.isBufferArray,
          bufferContent: fileEntry
            ? (fileEntry as any).bufferContent
            : (result.file as any).bufferContent,
        };

        const kind = fileWithJump.isBufferArray ? 'binary' : 'editor';
        await openTab(fileWithJump, {
          kind,
          jumpToLine: result.line,
          jumpToColumn: result.column,
        });
      } catch (err) {
        console.error('Failed to open file from search result', err);
      }
    },
    [projectId, openTab]
  );

  const handleReplaceResult = useCallback(
    async (result: SearchResult, replacement: string) => {
      try {
        const projId = projectId;
        const filePath = result.file.path;

        if (result.line === 0) {
          console.info('Skipping filename replace from SearchPanel');
          return;
        }
        const fileEntry = await fileRepository.getFileByPath(projId, filePath);
        if (!fileEntry || typeof fileEntry.content !== 'string')
          throw new Error('file not found or not text');
        const lines = fileEntry.content.split('\n');
        const lineIdx = result.line - 1;
        const line = lines[lineIdx] || '';
        const before = line.substring(0, result.matchStart);
        const after = line.substring(result.matchEnd);
        lines[lineIdx] = before + replacement + after;
        const updatedContent = lines.join('\n');
        const updated: any = { ...fileEntry, content: updatedContent, updatedAt: new Date() };
        await fileRepository.saveFile(updated);

        // キャッシュをクリアして再検索
        lastSearchResultsRef.current = [];
        performSearchRef.current(searchQuery);
      } catch (e) {
        console.error('Replace error', e);
      }
    },
    [projectId, searchQuery]
  );

  const handleReplaceAllInFile = async (file: FileItem, replacement: string) => {
    try {
      const projId = projectId;
      const fileEntry = await fileRepository.getFileByPath(projId, file.path);
      if (!fileEntry || typeof fileEntry.content !== 'string') return;
      const flags = caseSensitive ? 'g' : 'gi';
      const pattern = useRegex ? searchQuery : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(wholeWord && !useRegex ? `\\b${pattern}\\b` : pattern, flags);
      const updatedContent = fileEntry.content.replace(regex, replacement);
      const updated: any = { ...fileEntry, content: updatedContent, updatedAt: new Date() };
      await fileRepository.saveFile(updated);

      // キャッシュをクリアして再検索
      lastSearchResultsRef.current = [];
      performSearchRef.current(searchQuery);
    } catch (e) {
      console.error('Replace all error', e);
    }
  };

  const handleReplaceAllResults = async (replacement: string) => {
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const pattern = useRegex ? searchQuery : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(wholeWord && !useRegex ? `\\b${pattern}\\b` : pattern, flags);

      const filesUpdated = new Set<string>();
      for (const r of searchResults) {
        const filePath = r.file.path;
        if (filesUpdated.has(filePath)) continue;
        const fileEntry = await fileRepository.getFileByPath(projectId, filePath);
        if (!fileEntry || typeof fileEntry.content !== 'string') continue;
        const updatedContent = fileEntry.content.replace(regex, replacement);
        const updated: any = { ...fileEntry, content: updatedContent, updatedAt: new Date() };
        await fileRepository.saveFile(updated);
        filesUpdated.add(filePath);
      }

      // キャッシュをクリアして再検索
      lastSearchResultsRef.current = [];
      performSearchRef.current(searchQuery);
    } catch (e) {
      console.error('Replace all results error', e);
    }
  };

  const handleRowClick = useCallback(
    (r: SearchResult, idx: number) => {
      setSelectedIndex(idx);
      handleResultClick(r);
    },
    [handleResultClick]
  );
  // Enterキーでの検索確定
  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchTimer.current) {
        window.clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
      if (searchQuery && searchQuery.length >= minQueryLength) {
        // キャッシュをクリアして強制検索
        lastSearchResultsRef.current = [];
        setIsSearching(true);
        performSearchRef.current(searchQuery);
      }
    }
  };

  const handleKeyDown = (e: any) => {
    if (flatResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(flatResults.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = flatResults[selectedIndex];
      if (r) handleResultClick(r);
    }
  };

  const highlightMatch = (content: string, matchStart: number, matchEnd: number) => {
    const before = content.substring(0, matchStart);
    const match = content.substring(matchStart, matchEnd);
    const after = content.substring(matchEnd);
    return (
      <>
        {before}
        <span
          style={{
            background: colors.primary,
            color: colors.background,
            padding: '0.125rem 0.25rem',
            borderRadius: '0.25rem',
          }}
        >
          {match}
        </span>
        {after}
      </>
    );
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    lastSearchResultsRef.current = [];
    lastSearchQueryRef.current = '';
  };

  const toggleFileCollapse = (key: string) => {
    setCollapsedFiles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 検索モードの表示用テキスト
  const searchModeText = isRealtimeSearch
    ? t('searchPanel.realtimeMode') || 'Realtime'
    : t('searchPanel.enterToSearch') || 'Press Enter to search';

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', fontSize: '0.68rem' }}
    >
      {/* 検索入力エリア */}
      <div style={{ padding: '0.3rem', borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
          {/* 検索ボックス */}
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '0.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: colors.mutedFg,
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchInputKeyDown}
              placeholder={t('searchPanel.searchInFiles')}
              style={{
                width: '100%',
                paddingLeft: '1.4rem',
                paddingRight: '1.2rem',
                paddingTop: '0.14rem',
                paddingBottom: '0.14rem',
                background: colors.mutedBg,
                border: `1px solid ${colors.border}`,
                borderRadius: '0.375rem',
                fontSize: '0.64rem',
                outline: 'none',
                color: colors.foreground,
                lineHeight: '1rem',
              }}
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: colors.mutedFg,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 検索モード表示 */}
          <div style={{ fontSize: '0.58rem', color: colors.mutedFg, marginTop: '0.08rem' }}>
            {searchModeText} ({fileCount} files)
          </div>

          {/* 検索オプション - コンパクトなボタン形式 */}
          <div style={{ display: 'flex', gap: '0.12rem' }}>
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              style={{
                padding: '0.14rem 0.28rem',
                fontSize: '0.6rem',
                borderRadius: '0.28rem',
                border: `1px solid ${caseSensitive ? colors.accentBg : colors.border}`,
                background: caseSensitive ? colors.accentBg : colors.mutedBg,
                color: caseSensitive ? colors.accentFg : colors.mutedFg,
                cursor: 'pointer',
              }}
              title={t('searchPanel.caseSensitive')}
            >
              Aa
            </button>
            <button
              onClick={() => setWholeWord(!wholeWord)}
              style={{
                padding: '0.25rem 0.4rem',
                fontSize: '0.65rem',
                borderRadius: '0.3125rem',
                border: `1px solid ${wholeWord ? colors.accentBg : colors.border}`,
                background: wholeWord ? colors.accentBg : colors.mutedBg,
                color: wholeWord ? colors.accentFg : colors.mutedFg,
                cursor: 'pointer',
              }}
              title={t('searchPanel.wholeWord')}
            >
              Ab
            </button>
            <button
              onClick={() => setUseRegex(!useRegex)}
              style={{
                padding: '0.25rem 0.4rem',
                fontSize: '0.65rem',
                borderRadius: '0.3125rem',
                border: `1px solid ${useRegex ? colors.accentBg : colors.border}`,
                background: useRegex ? colors.accentBg : colors.mutedBg,
                color: useRegex ? colors.accentFg : colors.mutedFg,
                cursor: 'pointer',
              }}
              title={t('searchPanel.useRegex')}
            >
              .*
            </button>
            <button
              onClick={() => setSearchInFilenames(!searchInFilenames)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.28rem',
                padding: '0.16rem 0.32rem',
                fontSize: '0.62rem',
                borderRadius: '0.3125rem',
                border: `1px solid ${searchInFilenames ? colors.accentBg : colors.border}`,
                background: searchInFilenames ? colors.accentBg : colors.mutedBg,
                color: searchInFilenames ? colors.accentFg : colors.mutedFg,
                cursor: 'pointer',
              }}
              title="Search filenames"
            >
              <File size={12} color={searchInFilenames ? colors.accentFg : colors.mutedFg} />
            </button>
          </div>

          {/* 置換入力（全体） */}
          <div style={{ display: 'flex', gap: '0.12rem', marginTop: '0.12rem' }}>
            <input
              type="text"
              value={replaceQuery}
              onChange={e => setReplaceQuery(e.target.value)}
              placeholder="Replace..."
              style={{
                flex: 1,
                padding: '0.14rem 0.28rem',
                fontSize: '0.62rem',
                borderRadius: '0.28rem',
                border: `1px solid ${colors.border}`,
                background: colors.mutedBg,
                color: colors.foreground,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '0.12rem' }}>
              <button
                onClick={() => {
                  const r = flatResults[selectedIndex];
                  if (r && r.line !== 0) handleReplaceResult(r, replaceQuery);
                }}
                title={
                  currentSelected && currentSelected.line === 0
                    ? 'Replace not available for filename matches'
                    : 'Replace'
                }
                disabled={!!(currentSelected && currentSelected.line === 0)}
                style={{
                  padding: '0.12rem',
                  fontSize: '0.62rem',
                  borderRadius: '0.28rem',
                  border: `1px solid ${colors.border}`,
                  background: colors.mutedBg,
                  color: colors.foreground,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Edit3 size={14} />
              </button>

              <button
                onClick={() => handleReplaceAllResults(replaceQuery)}
                title="Replace all in results"
                style={{
                  padding: '0.12rem',
                  fontSize: '0.62rem',
                  borderRadius: '0.28rem',
                  border: `1px solid ${colors.border}`,
                  background: colors.mutedBg,
                  color: colors.foreground,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Repeat size={14} />
              </button>
            </div>
          </div>

          {/* 検索結果サマリー */}
          {searchQuery && (
            <div style={{ fontSize: '0.62rem', color: colors.mutedFg }}>
              {isSearching
                ? t('searchPanel.searching')
                : t('searchPanel.resultCount', { params: { count: searchResults.length } })}
            </div>
          )}
        </div>
      </div>

      {/* 検索結果 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
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

        {searchResults.length > 0 && (
          <div style={{ padding: '0.14rem' }}>
            {/* Group results by file (memoized) */}
            {groupedResults.map((group, gIdx) => {
              const first = group.first;
              const key = first.file.id || first.file.path;
              const isCollapsed = !!collapsedFiles[key];
              return (
                <div
                  key={`${key}-${gIdx}`}
                  style={{
                    padding: '0.18rem 0.28rem',
                    borderRadius: '0.28rem',
                    borderBottom: `1px solid ${colors.border}`,
                    marginBottom: '0.125rem',
                    overflow: 'hidden',
                    minWidth: 0,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleFileCollapse(key)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleFileCollapse(key);
                      }
                    }}
                    onMouseEnter={() => setHoveredFileKey(key)}
                    onMouseLeave={() => setHoveredFileKey(null)}
                    onFocus={() => setHoveredFileKey(key)}
                    onBlur={() => setHoveredFileKey(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.22rem',
                      marginBottom: '0.1rem',
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
                      {group.results.length} hits
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

                    {/* Replace all in file button (show on hover/selection like VSCode) */}
                    {(hoveredFileKey === key ||
                      group.results.some(g => flatResults[selectedIndex] === g.result)) && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleReplaceAllInFile(first.file, replaceQuery);
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

                  {!isCollapsed && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.12rem',
                        paddingLeft: '0.8rem',
                      }}
                    >
                      {group.results.map(({ result, globalIndex }, idx) => {
                        const isSelected = globalIndex === selectedIndex;
                        const resultKey = `${result.file.id}-${result.line}-${idx}`;
                        const isHovered = hoveredResultKey === resultKey;
                        return (
                          <ResultRow
                            key={`${result.file.id}-${result.line}-${idx}`}
                            result={result}
                            globalIndex={globalIndex}
                            isSelected={isSelected}
                            resultKey={resultKey}
                            colors={colors}
                            isHovered={isHovered}
                            onHoverChange={setHoveredResultKey}
                            onClick={handleRowClick}
                            onReplace={handleReplaceResult}
                            replaceQuery={replaceQuery}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
