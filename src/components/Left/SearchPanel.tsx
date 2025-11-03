import { useState, useEffect } from 'react';
import { Search, X, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { FileItem } from '@/types';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';
import { useSettings } from '@/hooks/useSettings';
import { useTabContext } from '@/context/TabContext';

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
  const { openTab } = useTabContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const { isExcluded } = useSettings(projectId);

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
              content: line, // trim()を外す
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

  // 検索クエリが変更された時の処理（デバウンス）
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, caseSensitive, wholeWord, useRegex, files]);

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
    openTab(fileWithJump, {
      kind: 'editor',
      jumpToLine: result.line,
      jumpToColumn: result.column,
    });
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontSize: '0.68rem' }}>
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
                        marginLeft: 'auto',
                        color: colors.mutedFg,
                        fontSize: '0.62rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '45%',
                      }}
                    >
                      {first.file.path}
                    </span>
                  </div>

                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem' }}>
                      {group.map((result, idx) => (
                        <div
                          key={`${result.file.id}-${result.line}-${idx}`}
                          onClick={() => handleResultClick(result)}
                          style={{
                            padding: '0.12rem',
                            borderRadius: '0.2rem',
                            cursor: 'pointer',
                            background: 'transparent',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ display: 'flex', gap: '0.32rem', alignItems: 'center' }}>
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
                                maxWidth: 'calc(100% - 3.2rem)',
                              }}
                              title={result.content}
                            >
                              {highlightMatch(result.content, result.matchStart, result.matchEnd)}
                            </code>
                          </div>
                        </div>
                      ))}
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
