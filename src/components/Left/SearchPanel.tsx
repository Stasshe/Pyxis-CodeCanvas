import { Search, X, FileText, ChevronDown, ChevronRight, File, Edit3, Repeat } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { useSettings } from '@/hooks/useSettings';
import { useTabStore } from '@/stores/tabStore';
import { FileItem } from '@/types';
import { fileRepository } from '@/engine/core/fileRepository';

interface SearchPanelProps {
  files: FileItem[];
  projectId: string; // 設定読み込み用
}

interface SearchResult {
  file: FileItem;
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

export default function SearchPanel({ files, projectId }: SearchPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { openTab } = useTabStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [searchInFilenames, setSearchInFilenames] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { isExcluded } = useSettings(projectId);
  const minQueryLength = 2; // 最低何文字で検索を開始するか
  const debounceDelay = 400; // ms
  const searchTimer = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 全ファイルを再帰的に取得（isExcludedを適用）
  const getAllFiles = (items: FileItem[]): FileItem[] => {
    const result: FileItem[] = [];
    const traverse = (items: FileItem[]) => {
      for (const item of items) {
        if (item.type === 'file') {
          if (!isExcluded || !isExcluded(item.path)) {
            result.push(item);
          }
        } else if (item.children) {
          traverse(item.children);
        }
      }
    };
    traverse(items);
    return result;
  };

  // 検索実行
  const performSearch = (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const allFiles = getAllFiles(files);
    const results: SearchResult[] = [];

    try {
      let searchRegex: RegExp;

      if (useRegex) {
        const flags = caseSensitive ? 'g' : 'gi';
        searchRegex = new RegExp(query, flags);
      } else {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = wholeWord ? `\\b${escapedQuery}\\b` : escapedQuery;
        const flags = caseSensitive ? 'g' : 'gi';
        searchRegex = new RegExp(pattern, flags);
      }

      allFiles.forEach(file => {
        // ファイル名/パスも検索対象にするオプション
        if (searchInFilenames) {
          const targetName = `${file.name} ${file.path}`;
          let m;
          const localRegex = new RegExp(searchRegex.source, searchRegex.flags);
          while ((m = localRegex.exec(targetName)) !== null) {
            results.push({
              file,
              line: 0,
              column: m.index + 1,
              content: targetName,
              matchStart: m.index,
              matchEnd: m.index + m[0].length,
            });
            if (!localRegex.global) break;
          }
        }

        if (!file.content) return;

        const lines = file.content.split('\n');
        lines.forEach((line, lineIndex) => {
          let match;
          searchRegex.lastIndex = 0; // RegExpをリセット

          while ((match = searchRegex.exec(line)) !== null) {
            results.push({
              file,
              line: lineIndex + 1,
              column: match.index + 1,
              content: line,
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });

            // 無限ループ防止
            if (!searchRegex.global) break;
          }
        });
      });

      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // 検索クエリが変更された時の処理（デバウンス + min length）
  useEffect(() => {
    // clear any existing timer
    if (searchTimer.current) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }

    if (!searchQuery || searchQuery.length < minQueryLength) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    // schedule search after debounceDelay
    searchTimer.current = window.setTimeout(() => {
      performSearch(searchQuery);
    }, debounceDelay);

    return () => {
      if (searchTimer.current) {
        window.clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
    };
  }, [searchQuery, caseSensitive, wholeWord, useRegex, files]);

  // flattened results for keyboard navigation
  const flatResults = searchResults;
  const currentSelected = flatResults[selectedIndex] || null;

  useEffect(() => {
    // keep selection within bounds
    if (selectedIndex >= flatResults.length) {
      setSelectedIndex(Math.max(0, flatResults.length - 1));
    }
  }, [flatResults.length]);

  const handleResultClick = (result: SearchResult) => {
    // localStorageのpyxis-defaultEditorを参照しisCodeMirrorを明示的に付与
    let isCodeMirror = false;
    if (typeof window !== 'undefined') {
      const defaultEditor = localStorage.getItem('pyxis-defaultEditor');
      isCodeMirror = defaultEditor === 'codemirror';
    }
    const fileWithJump = {
      ...result.file,
      isCodeMirror,
      isBufferArray: result.file.isBufferArray,
      bufferContent: result.file.bufferContent,
    };
    // バイナリファイルの場合は binary タブで開く
    const kind = result.file.isBufferArray ? 'binary' : 'editor';
    openTab(fileWithJump, {
      kind,
      jumpToLine: result.line,
      jumpToColumn: result.column,
    });
  };

  const handleReplaceResult = async (result: SearchResult, replacement: string) => {
    // allow empty replacement (deletion)
    try {
      const projId = projectId;
      const filePath = result.file.path;

      if (result.line === 0) {
        // Skip filename/path replacement — renaming is not supported from search panel
        console.info('Skipping filename replace from SearchPanel');
        return;
      } else {
        const fileEntry = await fileRepository.getFileByPath(projId, filePath);
        if (!fileEntry || typeof fileEntry.content !== 'string') throw new Error('file not found or not text');
        const lines = fileEntry.content.split('\n');
        const lineIdx = result.line - 1;
        const line = lines[lineIdx] || '';
        const before = line.substring(0, result.matchStart);
        const after = line.substring(result.matchEnd);
        lines[lineIdx] = before + replacement + after;
        const updatedContent = lines.join('\n');
        const updated: any = { ...fileEntry, content: updatedContent, updatedAt: new Date() };
        await fileRepository.saveFile(updated);
      }

      performSearch(searchQuery);
    } catch (e) {
      console.error('Replace error', e);
    }
  };

  const handleReplaceAllInFile = async (file: FileItem, replacement: string) => {
    // allow empty replacement (deletion)
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
      performSearch(searchQuery);
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

      performSearch(searchQuery);
    } catch (e) {
      console.error('Replace all results error', e);
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
  };

  // per-file collapsed state
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  const toggleFileCollapse = (key: string) => {
    setCollapsedFiles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
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
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  // immediate search on Enter if query long enough
                  if (searchTimer.current) {
                    window.clearTimeout(searchTimer.current);
                    searchTimer.current = null;
                  }
                  if (searchQuery && searchQuery.length >= minQueryLength) {
                    setIsSearching(true);
                    performSearch(searchQuery);
                  }
                }
              }}
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
              autoFocus
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
                onMouseEnter={e => (e.currentTarget.style.color = colors.foreground)}
                onMouseLeave={e => (e.currentTarget.style.color = colors.mutedFg)}
              >
                <X size={14} />
              </button>
            )}
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
                title={currentSelected && currentSelected.line === 0 ? 'Replace not available for filename matches' : 'Replace'}
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
      <div style={{ flex: 1, overflow: 'auto' }}>
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
            {/* Group results by file */}
            {Object.values(
              searchResults.reduce((acc: Record<string, SearchResult[]>, r) => {
                const key = r.file.id || r.file.path;
                if (!acc[key]) acc[key] = [];
                acc[key].push(r);
                return acc;
              }, {})
            ).map((group: SearchResult[], gIdx) => {
              const first = group[0];
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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.22rem',
                      marginBottom: '0.1rem',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    {isCollapsed ? (
                      <ChevronRight
                        size={14}
                        color={colors.mutedFg}
                      />
                    ) : (
                      <ChevronDown
                        size={14}
                        color={colors.mutedFg}
                      />
                    )}
                    <FileText
                      size={12}
                      color={colors.primary}
                      style={{ flexShrink: 0 }}
                    />
                    <span
                      style={{
                        color: colors.foreground,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '40%',
                      }}
                    >
                      {first.file.name}
                    </span>
                    <span
                      style={{ color: colors.mutedFg, marginLeft: '0.3rem', fontSize: '0.6rem' }}
                    >
                      {group.length} hits
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
                      }}
                    >
                      {first.file.path}
                    </span>

                    {/* Replace all in file button */}
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
                  </div>

                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem', paddingLeft: '0.8rem' }}>
                      {group.map((result, idx) => {
                        const globalIndex = flatResults.indexOf(result);
                        const isSelected = globalIndex === selectedIndex;
                        return (
                          <div
                            key={`${result.file.id}-${result.line}-${idx}`}
                            onClick={() => {
                              setSelectedIndex(globalIndex);
                              handleResultClick(result);
                            }}
                            style={{
                              padding: '0.12rem',
                              borderRadius: '0.2rem',
                              cursor: 'pointer',
                              background: isSelected ? colors.accentBg : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.32rem',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
                            onMouseLeave={e => (e.currentTarget.style.background = isSelected ? colors.accentBg : 'transparent')}
                          >
                            <div style={{ display: 'flex', gap: '0.32rem', alignItems: 'center', flex: 1 }}>
                              <span
                                style={{
                                  color: colors.mutedFg,
                                  width: '2.6rem',
                                  flexShrink: 0,
                                  fontSize: '0.62rem',
                                }}
                              >
                                {result.line}:{result.column}
                              </span>
                              <code
                                style={{
                                  background: colors.mutedBg,
                                  padding: '0.08rem 0.26rem',
                                  borderRadius: '0.2rem',
                                  color: colors.foreground,
                                  display: 'block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: 'calc(100% - 6rem)',
                                }}
                                title={result.content}
                              >
                                {highlightMatch(result.content, result.matchStart, result.matchEnd)}
                              </code>
                            </div>

                            {/* per-result replace button (VSCode-like) */}
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                if (result.line !== 0) handleReplaceResult(result, replaceQuery);
                              }}
                              title={result.line === 0 ? 'Replace not available for filename matches' : 'Replace'}
                              disabled={result.line === 0}
                              style={{
                                padding: '0.08rem',
                                borderRadius: '0.22rem',
                                border: `1px solid ${colors.border}`,
                                background: colors.mutedBg,
                                color: colors.foreground,
                                cursor: result.line === 0 ? 'not-allowed' : 'pointer',
                                fontSize: '0.6rem',
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            >
                              <Edit3 size={12} />
                            </button>
                          </div>
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
