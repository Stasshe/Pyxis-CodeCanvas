export type GitIgnoreRule = {
  raw: string;
  pattern: string;
  negation: boolean;
  directoryOnly: boolean;
  anchored: boolean; // leading slash
  hasSlash: boolean; // contains a slash somewhere
  regex: RegExp;
};

// Escape regex special chars
const escapeRegex = (s: string) => s.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');

function patternToRegex(pattern: string, anchored: boolean, hasSlash: boolean): RegExp {
  // Convert gitignore-style pattern to regex
  let i = 0;
  let res = '';
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // Leading '**/' should be optional so '**/dist' matches 'dist' and 'a/dist'
        if (i === 0 && pattern[i + 2] === '/') {
          res += '(?:.*/)?';
          i += 3; // consume '**/'
          continue;
        }
        // '**' => match any sequence including '/'
        res += '.*';
        i += 2;
        continue;
      }
      // '*' => match any except '/'
      res += '[^/]*';
      i++;
      continue;
    }
    if (ch === '?') {
      res += '[^/]';
      i++;
      continue;
    }
    // character class pass-through
    if (ch === '[') {
      // copy until closing ]
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== ']') j++;
      const cls = pattern.slice(i, j + 1);
      res += cls;
      i = j + 1;
      continue;
    }
    res += escapeRegex(ch);
    i++;
  }

  // If pattern has no slash and is not anchored, it should match in any directory -> allow prefix
  if (!anchored && !hasSlash) {
    // Match the pattern as a path segment anywhere in the path, and also match its contents if it's a directory
    // e.g. pattern 'node_modules' should match 'node_modules' and 'node_modules/...'
    return new RegExp(`(^|.*/)?${res}(?:$|/.*)`);
  }

  // anchored patterns match from start
  return new RegExp(`^${res}$`);
}

export function parseGitignore(content: string): GitIgnoreRule[] {
  const lines = content.split(/\r?\n/);
  const rules: GitIgnoreRule[] = [];

  for (let raw of lines) {
    if (raw === '') continue;
    // handle leading/trailing spaces: unescape '\ ' -> ' '
    raw = raw.replace(/\\ /g, ' ');
    if (raw.trim() === '') continue;
    if (raw.startsWith('#')) continue;

    let negation = false;
    if (raw.startsWith('!')) {
      negation = true;
      raw = raw.slice(1);
    }

    const anchored = raw.startsWith('/');
    if (anchored) raw = raw.slice(1);

    const directoryOnly = raw.endsWith('/');
    if (directoryOnly) raw = raw.slice(0, -1);

    const hasSlash = raw.includes('/');

    const regex = patternToRegex(raw, anchored, hasSlash);

    rules.push({ raw, pattern: raw, negation, directoryOnly, anchored, hasSlash, regex });
  }

  return rules;
}

export function isPathIgnored(rules: GitIgnoreRule[], path: string, isDir = false): boolean {
  // normalize path: remove leading slashes
  const normalized = path.replace(/^\/+/, '');
  let ignored = false;
  for (const r of rules) {
    // directory-only: match if isDir or path starts with pattern + '/'
    if (r.directoryOnly) {
      // For directory-only rules we need to check whether any directory prefix matches the rule.
      // e.g. for 'packages/foo/dist/index.js', check 'packages', 'packages/foo', 'packages/foo/dist'
      const parts = normalized.split('/');
      let prefix = '';
      for (let i = 0; i < parts.length - 0; i++) {
        prefix = parts.slice(0, i + 1).join('/');
        if (r.regex.test(prefix)) {
          ignored = !r.negation;
          break;
        }
      }
      continue;
    }

    // test regex for non-directory or file patterns
    if (r.regex.test(normalized)) {
      ignored = !r.negation;
    }
  }
  return ignored;
}

/**
 * Ensure a given ignore entry (e.g. "node_modules") exists in a .gitignore content string.
 *
 * This function is pure and does not touch any filesystem. It returns the new content and
 * whether it was changed. Callers should persist the returned content when `changed === true`.
 *
 * - If `content` is undefined/null/empty, a new minimal .gitignore content is returned.
 * - If the entry (or common variants) already exists, the original content is returned and
 *   `changed` will be false.
 *
 * @param content existing .gitignore content or undefined
 * @param entry ignore entry to ensure (default: 'node_modules')
 */
export function ensureGitignoreContains(
  content: string | undefined,
  entry = 'node_modules'
): { content: string; changed: boolean } {
  const normalizedEntry = entry.trim();

  // Prepare canonical variants we consider equivalent
  const variants = new Set<string>([
    normalizedEntry,
    `${normalizedEntry}/`,
    `/${normalizedEntry}`,
    `/${normalizedEntry}/`,
  ]);

  if (!content || content.trim() === '') {
    const header = '# Auto-generated .gitignore by Pyxis\n# Keep common ignores below\n';
    const newContent = `${header + normalizedEntry}\n`;
    return { content: newContent, changed: true };
  }

  // Check existing lines for an equivalent entry (ignore comments/blank lines)
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\\ /g, ' ').trim();
    if (!line || line.startsWith('#')) continue;
    // strip possible trailing spaces
    if (variants.has(line)) {
      return { content, changed: false };
    }
    // also consider patterns like "/node_modules/*" or "node_modules/**" as present
    if (line.startsWith(normalizedEntry) || line.includes(normalizedEntry)) {
      // e.g. "node_modules/**" or "**/node_modules" -> treat as present
      if (
        line === normalizedEntry ||
        line.startsWith(`${normalizedEntry}/`) ||
        line.includes(`/${normalizedEntry}`) ||
        line.includes(`${normalizedEntry}*`)
      ) {
        return { content, changed: false };
      }
    }
  }

  // Not found -> append at end (preserve trailing newline behavior)
  const needsTrailingNewline = content.endsWith('\n') || content.endsWith('\r');
  const appended = `${(needsTrailingNewline ? content : `${content}\n`) + normalizedEntry}\n`;
  return { content: appended, changed: true };
}
