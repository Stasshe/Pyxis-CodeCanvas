import { FNM_PATHNAME, fnmatch } from '@/engine/core/fs/fnmatch';
import { type GitIgnoreRule, isPathIgnored } from '@/engine/core/fs/gitignore';
import { normalizePath, posixPath } from '@/engine/core/paths';

export interface FileSearchQuery {
  query: string;
  tokens: string[];
  line?: number;
  column?: number;
}

export interface TextMatch {
  score: number;
  indices: number[];
}

export function parseFileSearchQuery(input: string): FileSearchQuery {
  const query = input.trim();
  const location = query.match(/^(.*?):(\d+)(?::(\d+))?$/);
  const searchText = location?.[1]?.trim() || query;
  const result: FileSearchQuery = {
    query: searchText,
    tokens: searchText.split(/\s+/).filter(Boolean),
  };
  if (location && searchText) {
    result.line = Number(location[2]);
    if (location[3]) result.column = Number(location[3]);
  }
  return result;
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const current = text[index];
  const previous = text[index - 1];
  return (
    /[\s/_.-]/.test(previous) ||
    (current !== current.toLowerCase() && previous === previous.toLowerCase())
  );
}

export function matchText(text: string, query: string): TextMatch | null {
  const needle = query.trim();
  if (!needle) return { score: 0, indices: [] };
  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  let bestMatch: TextMatch | null = null;
  let start = lowerText.indexOf(lowerNeedle);
  while (start >= 0) {
    let score = 100 + lowerNeedle.length;
    if (start === 0) score += 80;
    else if (isBoundary(text, start)) score += 35;
    if (start + lowerNeedle.length === text.length) score += 10;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        score,
        indices: Array.from({ length: lowerNeedle.length }, (_, index) => start + index),
      };
    }
    start = lowerText.indexOf(lowerNeedle, start + 1);
  }

  const indices: number[] = [];
  let textIndex = 0;
  let score = 0;
  let previousIndex = -2;
  for (const character of lowerNeedle) {
    let found = -1;
    while (textIndex < lowerText.length) {
      if (lowerText[textIndex] === character) {
        found = textIndex;
        break;
      }
      textIndex += 1;
    }
    if (found < 0) return null;
    indices.push(found);
    score += 10;
    if (isBoundary(text, found)) score += 80;
    if (found === previousIndex + 1) score += 10;
    previousIndex = found;
    textIndex = found + 1;
  }
  score -= indices[indices.length - 1] - indices[0] - indices.length + 1;
  if (!bestMatch || score > bestMatch.score) return { score, indices };
  return bestMatch;
}

export function scoreFileMatch(name: string, path: string, query: string): number | null {
  const nameMatch = matchText(name, query);
  if (nameMatch) return nameMatch.score + 500;
  const pathMatch = matchText(path, query);
  return pathMatch?.score ?? null;
}

export function normalizeWorkspacePath(filePath: string, rootPath: string): string {
  if (filePath.startsWith('/') && rootPath.startsWith('/')) {
    const normalizedPath = normalizePath(filePath);
    const normalizedRoot = normalizePath(rootPath);
    return posixPath.relative(normalizedRoot, normalizedPath);
  }
  return filePath;
}

function matchesPathGlob(pattern: string, filePath: string): boolean {
  const patternParts = pattern.replace(/^\//, '').split('/');
  const pathParts = filePath.split('/');
  function match(patternIndex: number, pathIndex: number): boolean {
    if (patternIndex === patternParts.length) return pathIndex === pathParts.length;
    const part = patternParts[patternIndex];
    if (part === '**') {
      for (let index = pathIndex; index <= pathParts.length; index += 1) {
        if (match(patternIndex + 1, index)) return true;
      }
      return false;
    }
    return (
      pathIndex < pathParts.length &&
      fnmatch(part, pathParts[pathIndex], FNM_PATHNAME) === 0 &&
      match(patternIndex + 1, pathIndex + 1)
    );
  }
  return match(0, 0);
}

export function matchesExcludePatterns(filePath: string, patterns: string[]): boolean {
  const pathParts = filePath.split('/');
  return patterns.some(pattern => {
    const normalized = pattern.replace(/^\.\//, '').replace(/\/$/, '');
    for (let end = 1; end <= pathParts.length; end += 1) {
      if (matchesPathGlob(normalized, pathParts.slice(0, end).join('/'))) return true;
    }
    return false;
  });
}

export function isQuickOpenPathExcluded(
  filePath: string,
  excludePatterns: string[],
  gitignoreRules: GitIgnoreRule[]
): boolean {
  return (
    matchesExcludePatterns(filePath, excludePatterns) ||
    isPathIgnored(gitignoreRules, filePath, false)
  );
}
