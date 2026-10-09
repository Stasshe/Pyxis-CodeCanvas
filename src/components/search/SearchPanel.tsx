import { Edit3, File, Repeat, Search, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { type ThemeColors, useTheme } from '@/context/ThemeContext';
import { readFileContent } from '@/engine/core/fileContent';
import { basename, fsClient, isPathWithin } from '@/engine/core/fs/index';
import { useSettings } from '@/hooks/settings/useSettings';
import { tabActions } from '@/stores/tabState';
import type { FileItem } from '@/types/index';
import { SearchRequestState } from '../../engine/ide/search/searchRequestState';
import type { SearchFlatItem, SearchResult } from '../../engine/ide/search/types';
import { isCurrentWorkspacePath } from '../../engine/ide/search/workspacePath';
import SearchResults from './SearchResults';

interface SearchPanelProps {
  files: FileItem[];
  rootPath: string;
}

// シンプルなファイルペイロード型（Workerへ送信用）
const REALTIME_FILE_THRESHOLD = 50;

async function readTextForReplace(path: string): Promise<string> {
  const loaded = await readFileContent(path);
  if (loaded.kind === 'binary') {
    throw new Error(`Cannot replace binary file: ${path}`);
  }
  return loaded.content;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

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

export default function SearchPanel({ files, rootPath }: SearchPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { openTab } = tabActions;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [filesystemChangeVersion, setFilesystemChangeVersion] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [searchInFilenames, setSearchInFilenames] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState('');
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredFileKey, setHoveredFileKey] = useState<string | null>(null);
  const [hoveredResultKey, setHoveredResultKey] = useState<string | null>(null);
  const { settings, isExcluded } = useSettings(rootPath);

  // 1文字から検索可能に
  const minQueryLength = 1;
  const debounceDelay = 300;

  const searchTimer = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;
  const searchRequestStateRef = useRef(new SearchRequestState<SearchResult>());

  // per-file collapsed state
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  // 全ファイルを再帰的に取得（isExcludedを適用）- memoized
  const allFiles = useMemo(() => {
    const result: FileItem[] = [];
    const traverse = (items: FileItem[]) => {
      for (const item of items) {
        if (item.type === 'file') {
          if (!isExcluded(item.path.slice(rootPath.length).replace(/^\//, ''))) {
            result.push(item);
          }
        } else if (item.children) {
          traverse(item.children);
        }
      }
    };
    traverse(files);
    return result;
  }, [files, isExcluded, rootPath]);

  // ファイル数
  const fileCount = allFiles.length;

  // リアルタイム検索を行うかどうか
  const isRealtimeSearch = fileCount <= REALTIME_FILE_THRESHOLD;

  // ファイルのバージョン計算（キャッシュ判定用）- memoized
  const filesVersion = useMemo(() => {
    return `${allFiles.length}:${allFiles.map(f => f.path).join(',')}`;
  }, [allFiles]);

  useEffect(() => {
    const removeListener = fsClient.addChangeListener(event => {
      const eventPathInRoot = isPathWithin(event.path, rootPath);
      let oldPathInRoot = false;
      if (event.oldPath) oldPathInRoot = isPathWithin(event.oldPath, rootPath);
      if (!eventPathInRoot && !oldPathInRoot) return;

      setFilesystemChangeVersion(version => version + 1);
    });

    return removeListener;
  }, [rootPath]);

  // 検索オプションキー
  const searchOptionsKey = useMemo(() => {
    return `${caseSensitive}:${wholeWord}:${useRegex}:${searchInFilenames}:${settings?.search?.exclude.join(',') ?? ''}:${settings?.files?.exclude.join(',') ?? ''}:${settings?.search?.useIgnoreFiles ?? false}`;
  }, [caseSensitive, wholeWord, useRegex, searchInFilenames, settings]);

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
    const cachedResults = searchRequestStateRef.current.getCached(
      rootPath,
      query,
      searchOptionsKey
    );
    if (cachedResults) {
      setSearchResults(cachedResults);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const request = searchRequestStateRef.current.start(rootPath, query, searchOptionsKey);

    void (async () => {
      try {
        const results = await fsClient.search(rootPath, {
          query,
          options: {
            caseSensitive,
            wholeWord,
            useRegex,
            searchInFilenames,
            excludeGlobs: [
              ...(settings?.search?.exclude ?? []),
              ...(settings?.files?.exclude ?? []),
            ],
            useIgnoreFiles: settings?.search?.useIgnoreFiles ?? false,
          },
        });

        if (rootPathRef.current !== rootPath) return;
        const fileResults: SearchResult[] = results.map(result => ({
          ...result,
          file: {
            id: result.file.path,
            name: basename(result.file.path),
            path: result.file.path,
            type: result.file.type,
            content: '',
          },
        }));
        if (!searchRequestStateRef.current.complete(request, rootPathRef.current, fileResults))
          return;
        setSearchResults(fileResults);
        setIsSearching(false);
      } catch (err) {
        if (!searchRequestStateRef.current.isCurrent(request, rootPathRef.current)) return;
        console.error('Search worker failed', err);
        setIsSearching(false);
      }
    })();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: search inputs invalidate and restart pending work
  useEffect(() => {
    searchRequestStateRef.current.invalidate();
    setSearchResults([]);
    setIsSearching(false);

    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = null;

    let timer: number | undefined;
    if (searchQuery && searchQuery.length >= minQueryLength && isRealtimeSearch) {
      setIsSearching(true);
      timer = window.setTimeout(() => {
        performSearchRef.current(searchQuery);
      }, debounceDelay);
      searchTimer.current = timer;
    }

    return () => {
      searchRequestStateRef.current.invalidate();
      if (timer !== undefined) window.clearTimeout(timer);
      if (searchTimer.current === timer) searchTimer.current = null;
    };
  }, [
    rootPath,
    searchQuery,
    searchOptionsKey,
    isRealtimeSearch,
    filesVersion,
    filesystemChangeVersion,
  ]);

  // flattened results for keyboard navigation
  const flatResults = searchResults;
  const currentSelected = flatResults[selectedIndex] || null;

  // Grouped results by file (memoized to avoid recomputing groups every render)
  const groupedResults: Array<{
    first: SearchResult;
    results: Array<{ result: SearchResult; globalIndex: number }>;
  }> = useMemo(() => {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex is intentionally excluded — effect only needs to run when results shrink; selectedIndex at that render is always current
  useEffect(() => {
    // keep selection within bounds
    if (selectedIndex >= flatResults.length) {
      setSelectedIndex(Math.max(0, flatResults.length - 1));
    }
  }, [flatResults.length]);

  const handleResultClick = useCallback(async (result: SearchResult) => {
    const requestedRoot = rootPathRef.current;
    if (!isCurrentWorkspacePath(result.file.path, requestedRoot, rootPathRef.current)) return;
    try {
      let isCodeMirror = false;
      if (typeof window !== 'undefined') {
        const defaultEditor = localStorage.getItem('pyxis-defaultEditor');
        isCodeMirror = defaultEditor === 'codemirror';
      }

      const fileWithJump = {
        ...result.file,
        isCodeMirror,
      };

      const loaded = await readFileContent(fileWithJump.path);
      if (!isCurrentWorkspacePath(result.file.path, requestedRoot, rootPathRef.current)) return;
      setFileActionError(null);
      let kind: 'binary' | 'editor' = 'editor';
      let fileToOpen = fileWithJump;
      if (loaded.kind === 'binary') {
        kind = 'binary';
        fileToOpen = {
          ...fileWithJump,
          isBufferArray: true,
          bufferContent: loaded.bufferContent,
        };
      } else {
        fileToOpen = { ...fileWithJump, isBufferArray: false, content: loaded.content };
      }
      await openTab(fileToOpen, {
        kind,
        jumpToLine: result.line,
        jumpToColumn: result.column,
      });
    } catch (err) {
      if (!isCurrentWorkspacePath(result.file.path, requestedRoot, rootPathRef.current)) return;
      console.error('Failed to open file from search result', err);
      setFileActionError(`Failed to open ${result.file.path}: ${errorMessage(err)}`);
    }
  }, []);

  const handleReplaceResult = useCallback(
    async (result: SearchResult, replacement: string) => {
      const requestedRoot = rootPathRef.current;
      if (!isCurrentWorkspacePath(result.file.path, requestedRoot, rootPathRef.current)) return;
      try {
        setReplaceError(null);
        const filePath = result.file.path;

        if (result.line === 0) {
          console.info('Skipping filename replace from SearchPanel');
          return;
        }
        const lines = (await readTextForReplace(filePath)).split('\n');
        if (!isCurrentWorkspacePath(filePath, requestedRoot, rootPathRef.current)) return;
        const lineIdx = result.line - 1;
        const line = lines[lineIdx] || '';
        const before = line.substring(0, result.matchStart);
        const after = line.substring(result.matchEnd);
        lines[lineIdx] = before + replacement + after;
        const updatedContent = lines.join('\n');
        await fsClient.writeFile(filePath, updatedContent);

        // キャッシュをクリアして再検索
        if (!isCurrentWorkspacePath(filePath, requestedRoot, rootPathRef.current)) return;
        searchRequestStateRef.current.invalidate();
        performSearchRef.current(searchQuery);
      } catch (e) {
        if (!isCurrentWorkspacePath(result.file.path, requestedRoot, rootPathRef.current)) return;
        console.error('Replace error', e);
        setReplaceError(errorMessage(e));
      }
    },
    [searchQuery]
  );

  const handleReplaceAllInFile = async (file: FileItem, replacement: string) => {
    const requestedRoot = rootPathRef.current;
    if (!isCurrentWorkspacePath(file.path, requestedRoot, rootPathRef.current)) return;
    try {
      setReplaceError(null);
      const content = await readTextForReplace(file.path);
      if (!isCurrentWorkspacePath(file.path, requestedRoot, rootPathRef.current)) return;
      const flags = caseSensitive ? 'g' : 'gi';
      const pattern = useRegex ? searchQuery : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(wholeWord && !useRegex ? `\\b${pattern}\\b` : pattern, flags);
      const updatedContent = content.replace(regex, replacement);
      await fsClient.writeFile(file.path, updatedContent);

      // キャッシュをクリアして再検索
      if (!isCurrentWorkspacePath(file.path, requestedRoot, rootPathRef.current)) return;
      searchRequestStateRef.current.invalidate();
      performSearchRef.current(searchQuery);
    } catch (e) {
      if (!isCurrentWorkspacePath(file.path, requestedRoot, rootPathRef.current)) return;
      console.error('Replace all error', e);
      setReplaceError(errorMessage(e));
    }
  };

  const handleReplaceAllResults = async (replacement: string) => {
    const requestedRoot = rootPathRef.current;
    if (
      searchResults.some(
        result => !isCurrentWorkspacePath(result.file.path, requestedRoot, rootPathRef.current)
      )
    )
      return;
    try {
      setReplaceError(null);
      const flags = caseSensitive ? 'g' : 'gi';
      const pattern = useRegex ? searchQuery : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(wholeWord && !useRegex ? `\\b${pattern}\\b` : pattern, flags);

      const filesUpdated = new Set<string>();
      const contents = new Map<string, string>();
      for (const r of searchResults) {
        const filePath = r.file.path;
        if (filesUpdated.has(filePath)) continue;
        const content = await readTextForReplace(filePath);
        if (!isCurrentWorkspacePath(filePath, requestedRoot, rootPathRef.current)) return;
        contents.set(filePath, content);
        filesUpdated.add(filePath);
      }
      for (const [filePath, content] of contents) {
        if (!isCurrentWorkspacePath(filePath, requestedRoot, rootPathRef.current)) return;
        await fsClient.writeFile(filePath, content.replace(regex, replacement));
      }

      // キャッシュをクリアして再検索
      if (requestedRoot !== rootPathRef.current) return;
      searchRequestStateRef.current.invalidate();
      performSearchRef.current(searchQuery);
    } catch (e) {
      if (requestedRoot !== rootPathRef.current) return;
      console.error('Replace all results error', e);
      setReplaceError(errorMessage(e));
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
        searchRequestStateRef.current.invalidate();
        setIsSearching(true);
        performSearchRef.current(searchQuery);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    searchRequestStateRef.current.invalidate();
  };

  const toggleFileCollapse = (key: string) => {
    setCollapsedFiles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Flat list for virtualizer: header rows + result rows (collapsed groups omit results)
  const flatItems = useMemo((): SearchFlatItem[] => {
    const items: SearchFlatItem[] = [];
    for (const group of groupedResults) {
      const key = group.first.file.id || group.first.file.path;
      const isCollapsed = !!collapsedFiles[key];
      items.push({
        type: 'header',
        groupKey: key,
        first: group.first,
        resultCount: group.results.length,
        isCollapsed,
      });
      if (!isCollapsed) {
        for (let i = 0; i < group.results.length; i++) {
          const { result, globalIndex } = group.results[i];
          items.push({ type: 'result', groupKey: key, result, globalIndex, idxInGroup: i });
        }
      }
    }
    return items;
  }, [groupedResults, collapsedFiles]);

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
          {replaceError && (
            <div role="alert" style={{ color: colors.red, fontSize: '0.62rem' }}>
              {replaceError}
            </div>
          )}
          {fileActionError && (
            <div role="alert" style={{ color: colors.red, fontSize: '0.62rem' }}>
              {fileActionError}
            </div>
          )}
        </div>
      </div>

      <SearchResults
        searchQuery={searchQuery}
        isSearching={isSearching}
        searchResults={searchResults}
        flatItems={flatItems}
        flatResults={flatResults}
        selectedIndex={selectedIndex}
        replaceQuery={replaceQuery}
        hoveredFileKey={hoveredFileKey}
        hoveredResultKey={hoveredResultKey}
        onToggleFile={toggleFileCollapse}
        onHoverFile={setHoveredFileKey}
        onHoverResult={setHoveredResultKey}
        onResultClick={handleRowClick}
        onReplaceResult={handleReplaceResult}
        onReplaceAllInFile={handleReplaceAllInFile}
      />
    </div>
  );
}
