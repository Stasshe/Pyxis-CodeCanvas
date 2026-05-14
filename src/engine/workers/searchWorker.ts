import * as Comlink from 'comlink';

export type FilePayload = {
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

export interface SearchResult {
  file: { id: string; path: string; name: string; type: 'file' };
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

// cached files to avoid receiving the full payload on every search message
let cachedFiles: FilePayload[] = [];

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

export interface SearchWorkerApi {
  updateFiles(files: FilePayload[]): Promise<void>;
  search(request: {
    query: string;
    options: SearchOptions;
    files?: FilePayload[];
  }): Promise<SearchResult[]>;
}

const api: SearchWorkerApi = {
  async updateFiles(files) {
    cachedFiles = files.map(f => ({ ...f }));
  },

  async search({ query, options, files }) {
    if (!query || !query.trim()) {
      return [];
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

    const filesToSearch = files?.length ? files : cachedFiles;

    for (const file of filesToSearch) {
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
            file: {
              id: file.id || file.path,
              path: file.path,
              name: file.name || '',
              type: 'file',
            },
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
            file: {
              id: file.id || file.path,
              path: file.path,
              name: file.name || '',
              type: 'file',
            },
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

    return results;
  },
};

Comlink.expose(api);
