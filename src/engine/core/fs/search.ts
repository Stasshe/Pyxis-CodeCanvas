import { FNM_PATHNAME, fnmatch } from '@/engine/cmd/lib/fnmatch';
import { isLikelyTextFile } from '@/engine/helper/isLikelyTextFile';
import type { ProjectFile } from '@/types';
import { basename, normalizePath } from '../pathUtils';
import type { FsApi } from './types';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  searchInFilenames: boolean;
  excludeGlobs?: string[];
}

export interface SearchRequest {
  query: string;
  options: SearchOptions;
}

export interface SearchResult {
  file: ProjectFile;
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** fnmatch owns segment syntax; globstar alone spans zero or more directories. */
function matchesGlob(pattern: string, path: string): boolean {
  const patterns = pattern.split('/');
  const segments = path.split('/');
  function match(patternIndex: number, pathIndex: number): boolean {
    if (patternIndex === patterns.length) return pathIndex === segments.length;
    const segment = patterns[patternIndex];
    if (segment === '**') {
      for (let index = pathIndex; index <= segments.length; index++) {
        if (match(patternIndex + 1, index)) return true;
      }
      return false;
    }
    return (
      pathIndex < segments.length &&
      fnmatch(segment, segments[pathIndex], FNM_PATHNAME) === 0 &&
      match(patternIndex + 1, pathIndex + 1)
    );
  }
  return match(0, 0);
}

/** Scan in the owner worker; only match metadata crosses the worker boundary. */
export async function searchFiles(
  core: FsApi,
  root: string,
  request: SearchRequest
): Promise<SearchResult[]> {
  const { query, options } = request;
  if (!query.trim()) return [];
  let source = query;
  if (!options.useRegex) {
    source = escapeRegex(query);
    if (options.wholeWord) source = `\\b${source}\\b`;
  }
  let flags = 'gi';
  if (options.caseSensitive) flags = 'g';
  const regex = new RegExp(source, flags);
  const excluded = options.excludeGlobs ?? [];
  const results: SearchResult[] = [];
  const base = normalizePath(root);

  function collect(file: ProjectFile, content: string, line: number): void {
    regex.lastIndex = 0;
    for (let match = regex.exec(content); match; match = regex.exec(content)) {
      results.push({
        file,
        line,
        column: match.index + 1,
        content,
        matchStart: match.index,
        matchEnd: match.index + match[0].length,
      });
      if (!match[0].length) regex.lastIndex++;
    }
  }

  for (const file of await core.walk(base)) {
    if (file.type !== 'file') continue;
    const relative = file.path.slice(base.length).replace(/^\//, '');
    if (excluded.some(pattern => matchesGlob(pattern, file.path) || matchesGlob(pattern, relative)))
      continue;
    if (options.searchInFilenames) collect(file, basename(file.path), 0);
    const bytes = await core.readFile(file.path);
    if (!(await isLikelyTextFile(file.path, bytes))) continue;
    const lines = new TextDecoder().decode(bytes).split('\n');
    for (let index = 0; index < lines.length; index++) collect(file, lines[index], index + 1);
  }
  return results;
}
