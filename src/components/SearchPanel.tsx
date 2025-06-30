import { useState, useEffect } from 'react';
import { Search, X, FileText, Folder } from 'lucide-react';
import { FileItem } from '@/types';

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
        <span className="bg-yellow-400 text-black px-0.5 rounded">{match}</span>
        {after}
      </>
    );
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <div className="h-full flex flex-col">
      {/* 検索入力エリア */}
      <div className="p-3 border-b border-border">
        <div className="space-y-2">
          {/* 検索ボックス */}
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ファイル内を検索..."
              className="w-full pl-8 pr-8 py-1.5 bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring text-xs"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 検索オプション - コンパクトなボタン形式 */}
          <div className="flex gap-1">
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              className={`px-1.5 py-0.5 text-xs rounded border ${
                caseSensitive 
                  ? 'bg-accent text-accent-foreground border-accent' 
                  : 'bg-muted text-muted-foreground border-border hover:bg-accent/50'
              }`}
              title="大文字小文字を区別"
            >
              Aa
            </button>
            <button
              onClick={() => setWholeWord(!wholeWord)}
              className={`px-1.5 py-0.5 text-xs rounded border ${
                wholeWord 
                  ? 'bg-accent text-accent-foreground border-accent' 
                  : 'bg-muted text-muted-foreground border-border hover:bg-accent/50'
              }`}
              title="単語単位で検索"
            >
              Ab
            </button>
            <button
              onClick={() => setUseRegex(!useRegex)}
              className={`px-1.5 py-0.5 text-xs rounded border ${
                useRegex 
                  ? 'bg-accent text-accent-foreground border-accent' 
                  : 'bg-muted text-muted-foreground border-border hover:bg-accent/50'
              }`}
              title="正規表現を使用"
            >
              .*
            </button>
          </div>

          {/* 検索結果サマリー */}
          {searchQuery && (
            <div className="text-xs text-muted-foreground">
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
      <div className="flex-1 overflow-auto">
        {searchQuery && !isSearching && searchResults.length === 0 && (
          <div className="p-3 text-center text-muted-foreground">
            <Search size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-xs">結果が見つかりませんでした</p>
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="p-1">
            {searchResults.map((result, index) => (
              <div
                key={`${result.file.id}-${result.line}-${index}`}
                onClick={() => handleResultClick(result)}
                className="p-2 hover:bg-accent cursor-pointer rounded text-xs border-b border-border/30 last:border-b-0"
              >
                <div className="flex items-center gap-1 mb-1">
                  <FileText size={12} className="text-blue-400 flex-shrink-0" />
                  <span className="font-medium truncate text-xs">{result.file.name}</span>
                  <span className="text-xs text-muted-foreground flex-shrink-0 ml-auto">
                    {result.line}:{result.column}
                  </span>
                </div>
                <div className="ml-3 mb-1">
                  <code className="bg-muted px-1 py-0.5 rounded text-xs block">
                    {highlightMatch(result.content, result.matchStart, result.matchEnd)}
                  </code>
                </div>
                <div className="ml-3 text-xs text-muted-foreground truncate">
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
