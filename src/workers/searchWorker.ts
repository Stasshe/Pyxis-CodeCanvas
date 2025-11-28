// Web Worker for file search
// Receives messages: { type: 'search', searchId, query, options, files }
// Responds with: { type: 'result', searchId, results }

type FilePayload = {
  id?: string;
  path: string;
  name?: string;
  content?: string;
  isBufferArray?: boolean;
};

type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  searchInFilenames: boolean;
};

function escapeForRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

self.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'search') return;

  const { searchId, query, options, files } = msg as {
    searchId: number;
    query: string;
    options: SearchOptions;
    files: FilePayload[];
  };

  try {
    if (!query || !query.trim()) {
      (self as any).postMessage({ type: 'result', searchId, results: [] });
      return;
    }

    let searchRegex: RegExp;
    if (options.useRegex) {
      const flags = options.caseSensitive ? 'g' : 'gi';
      searchRegex = new RegExp(query, flags);
    } else {
      const escaped = escapeForRegex(query);
      const pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped;
      const flags = options.caseSensitive ? 'g' : 'gi';
      searchRegex = new RegExp(pattern, flags);
    }

    const results: any[] = [];

    for (const file of files) {
      if (options.searchInFilenames) {
        const targetName = `${file.name || ''} ${file.path}`;
        const localRegex = new RegExp(searchRegex.source, searchRegex.flags);
        let m: RegExpExecArray | null;
        while ((m = localRegex.exec(targetName)) !== null) {
          results.push({
            file: { id: file.id, path: file.path, name: file.name },
            line: 0,
            column: m.index + 1,
            content: targetName,
            matchStart: m.index,
            matchEnd: m.index + m[0].length,
          });
          if (!localRegex.global) break;
        }
      }

      if (!file.content) continue;

      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        searchRegex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = searchRegex.exec(line)) !== null) {
          results.push({
            file: { id: file.id, path: file.path, name: file.name },
            line: i + 1,
            column: m.index + 1,
            content: line,
            matchStart: m.index,
            matchEnd: m.index + m[0].length,
          });
          if (!searchRegex.global) break;
        }
      }
    }

    (self as any).postMessage({ type: 'result', searchId, results });
  } catch (err) {
    (self as any).postMessage({ type: 'result', searchId, results: [], error: String(err) });
  }
});

export {};
