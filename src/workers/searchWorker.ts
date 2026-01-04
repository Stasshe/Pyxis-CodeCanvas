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
  excludeGlobs?: string[];
};

interface SearchResult {
  file: { id?: string; path: string; name?: string };
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchResultMessage {
  type: 'result';
  searchId: number;
  results: SearchResult[];
  error?: string;
}

// Worker global scope with proper typing
type WorkerSelf = typeof globalThis & {
  postMessage(message: SearchResultMessage): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
};

// TypeScript knows `self` exists in worker context
const workerSelf = self as unknown as WorkerSelf;

function escapeForRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(pattern: string, caseSensitive: boolean) {
  const p = pattern.replace(/\\/g, '/');
  let regexStr = '';
  for (let i = 0; i < p.length; ) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        regexStr += '.*';
        i += 2;
      } else {
        regexStr += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      regexStr += '.';
      i += 1;
    } else {
      regexStr += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${regexStr}$`, caseSensitive ? '' : 'i');
}

workerSelf.addEventListener('message', (ev: MessageEvent) => {
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
      workerSelf.postMessage({
        type: 'result',
        searchId,
        results: [],
      } satisfies SearchResultMessage);
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

    const results: SearchResult[] = [];

    // Prepare exclude regexes from provided glob patterns (if any).
    const excludePatterns: RegExp[] = (options.excludeGlobs || []).map(g =>
      globToRegex(g, options.caseSensitive)
    );

    for (const file of files) {
      const normalizedPath = (file.path || '').replace(/\\/g, '/');

      // Skip if path matches any exclude pattern
      let excluded = false;
      for (const regex of excludePatterns) {
        if (regex.test(normalizedPath)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;

      // Skip binary files
      if (file.isBufferArray) continue;

      const targetName = file.name || file.path.split('/').pop() || '';

      if (options.searchInFilenames && searchRegex.test(targetName)) {
        const localRegex = new RegExp(searchRegex.source, searchRegex.flags);
        let m: RegExpExecArray | null = localRegex.exec(targetName);
        while (m !== null) {
          results.push({
            file: { id: file.id, path: file.path, name: file.name },
            line: 0,
            column: m.index + 1,
            content: targetName,
            matchStart: m.index,
            matchEnd: m.index + m[0].length,
          });
          if (!localRegex.global) break;
          m = localRegex.exec(targetName);
        }
      }

      if (!file.content) continue;

      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        searchRegex.lastIndex = 0;
        let m: RegExpExecArray | null = searchRegex.exec(line);
        while (m !== null) {
          results.push({
            file: { id: file.id, path: file.path, name: file.name },
            line: i + 1,
            column: m.index + 1,
            content: line,
            matchStart: m.index,
            matchEnd: m.index + m[0].length,
          });
          if (!searchRegex.global) break;
          m = searchRegex.exec(line);
        }
      }
    }

    workerSelf.postMessage({ type: 'result', searchId, results } satisfies SearchResultMessage);
  } catch (err) {
    workerSelf.postMessage({
      type: 'result',
      searchId,
      results: [],
      error: String(err),
    } satisfies SearchResultMessage);
  }
});

export {};
