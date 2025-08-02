import { useState, useEffect } from 'react';
import { Search, X, FileText, Folder } from 'lucide-react';
import { FileItem } from '@/types';
import { useTheme } from '@/context/ThemeContext';

interface SearchPanelProps {
  files: FileItem[];
  onFileOpen: (file: FileItem) => void;
}

interface SearchResult {
  file: FileItem;
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

export default function SearchPanel({ files, onFileOpen }: SearchPanelProps) {
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);

  // 全ファイルを再帰的に取得
  const getAllFiles = (items: FileItem[]): FileItem[] => {
    const result: FileItem[] = [];
    
    const traverse = (items: FileItem[]) => {
      for (const item of items) {
        if (item.type === 'file') {
          result.push(item);
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
              content: line.trim(),
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
    onFileOpen(result.file);
    // TODO: 将来的にエディターの特定行にジャンプする機能を追加
  };

  const highlightMatch = (content: string, matchStart: number, matchEnd: number) => {
    const before = content.substring(0, matchStart);
    const match = content.substring(matchStart, matchEnd);
    const after = content.substring(matchEnd);
    return (
      <>
        {before}
        <span style={{ background: colors.primary, color: colors.background, padding: '0.125rem 0.25rem', borderRadius: '0.25rem' }}>{match}</span>
        {after}
      </>
    );
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 検索入力エリア */}
      <div style={{ padding: '0.75rem', borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* 検索ボックス */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: colors.mutedFg }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ファイル内を検索..."
              style={{
                width: '100%',
                paddingLeft: '2rem',
                paddingRight: '2rem',
                paddingTop: '0.375rem',
                paddingBottom: '0.375rem',
                background: colors.mutedBg,
                border: `1px solid ${colors.border}`,
                borderRadius: '0.375rem',
                fontSize: '0.75rem',
                outline: 'none',
                color: colors.foreground,
              }}
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: colors.mutedFg }}
                onMouseEnter={e => (e.currentTarget.style.color = colors.foreground)}
                onMouseLeave={e => (e.currentTarget.style.color = colors.mutedFg)}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 検索オプション - コンパクトなボタン形式 */}
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              style={{
                padding: '0.375rem 0.5rem',
                fontSize: '0.75rem',
                borderRadius: '0.375rem',
                border: `1px solid ${caseSensitive ? colors.accentBg : colors.border}`,
                background: caseSensitive ? colors.accentBg : colors.mutedBg,
                color: caseSensitive ? colors.accentFg : colors.mutedFg,
                cursor: 'pointer',
              }}
              title="大文字小文字を区別"
            >
              Aa
            </button>
            <button
              onClick={() => setWholeWord(!wholeWord)}
              style={{
                padding: '0.375rem 0.5rem',
                fontSize: '0.75rem',
                borderRadius: '0.375rem',
                border: `1px solid ${wholeWord ? colors.accentBg : colors.border}`,
                background: wholeWord ? colors.accentBg : colors.mutedBg,
                color: wholeWord ? colors.accentFg : colors.mutedFg,
                cursor: 'pointer',
              }}
              title="単語単位で検索"
            >
              Ab
            </button>
            <button
              onClick={() => setUseRegex(!useRegex)}
              style={{
                padding: '0.375rem 0.5rem',
                fontSize: '0.75rem',
                borderRadius: '0.375rem',
                border: `1px solid ${useRegex ? colors.accentBg : colors.border}`,
                background: useRegex ? colors.accentBg : colors.mutedBg,
                color: useRegex ? colors.accentFg : colors.mutedFg,
                cursor: 'pointer',
              }}
              title="正規表現を使用"
            >
              .*
            </button>
          </div>

          {/* 検索結果サマリー */}
          {searchQuery && (
            <div style={{ fontSize: '0.75rem', color: colors.mutedFg }}>
              {isSearching ? (
                '検索中...'
              ) : (
                `${searchResults.length} 件の結果`
              )}
            </div>
          )}
        </div>
      </div>

      {/* 検索結果 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {searchQuery && !isSearching && searchResults.length === 0 && (
          <div style={{ padding: '0.75rem', textAlign: 'center', color: colors.mutedFg }}>
            <Search size={24} style={{ display: 'block', margin: '0 auto 0.5rem', opacity: 0.5, color: colors.mutedFg }} />
            <p style={{ fontSize: '0.75rem' }}>結果が見つかりませんでした</p>
          </div>
        )}

        {searchResults.length > 0 && (
          <div style={{ padding: '0.25rem' }}>
            {searchResults.map((result, index) => (
              <div
                key={`${result.file.id}-${result.line}-${index}`}
                onClick={() => handleResultClick(result)}
                style={{
                  padding: '0.5rem',
                  background: 'transparent',
                  borderRadius: '0.375rem',
                  fontSize: '0.75rem',
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                  marginBottom: '0.125rem',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.accentBg)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.25rem' }}>
                  <FileText size={12} color={colors.primary} style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.75rem' }}>{result.file.name}</span>
                  <span style={{ fontSize: '0.75rem', color: colors.mutedFg, flexShrink: 0, marginLeft: 'auto' }}>
                    {result.line}:{result.column}
                  </span>
                </div>
                <div style={{ marginLeft: '0.75rem', marginBottom: '0.25rem' }}>
                  <code style={{ background: colors.mutedBg, padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', display: 'block', color: colors.foreground }}>
                    {highlightMatch(result.content, result.matchStart, result.matchEnd)}
                  </code>
                </div>
                <div style={{ marginLeft: '0.75rem', fontSize: '0.75rem', color: colors.mutedFg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {result.file.path}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
