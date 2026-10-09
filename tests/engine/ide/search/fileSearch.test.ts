import { describe, expect, it } from 'vitest';
import { parseGitignore } from '@/engine/core/fs/gitignore';
import {
  isQuickOpenPathExcluded,
  matchesExcludePatterns,
  matchText,
  normalizeWorkspacePath,
  parseFileSearchQuery,
  scoreFileMatch,
} from '@/engine/ide/search/fileSearch';

describe('file search helpers', () => {
  it('parses a trailing line and column without searching the suffix', () => {
    expect(parseFileSearchQuery('src/OperationWindow.tsx:14:7')).toEqual({
      query: 'src/OperationWindow.tsx',
      tokens: ['src/OperationWindow.tsx'],
      line: 14,
      column: 7,
    });
  });

  it('matches fuzzy filename sequences case-insensitively and ranks filenames above paths', () => {
    expect(matchText('OperationWindow.tsx', 'ow')?.indices).toEqual([0, 9]);
    expect(scoreFileMatch('QuickOpen.tsx', 'src/editor/QuickOpen.tsx', 'qo')).toBeGreaterThan(
      scoreFileMatch('panel.tsx', 'src/QuickOpen/panel.tsx', 'qo') ?? 0
    );
  });

  it('matches excluded directory patterns at the workspace root and nested paths', () => {
    expect(matchesExcludePatterns('node_modules/pkg/index.js', ['**/node_modules'])).toBe(true);
    expect(matchesExcludePatterns('apps/demo/node_modules/pkg.js', ['**/node_modules'])).toBe(true);
    expect(matchesExcludePatterns('src/node_modules.ts', ['**/node_modules'])).toBe(false);
  });

  it('applies root gitignore rules to workspace-relative paths', () => {
    const rules = parseGitignore('*.log\n!keep.log');
    expect(isQuickOpenPathExcluded('src/debug.log', [], rules)).toBe(true);
    expect(isQuickOpenPathExcluded('src/keep.log', [], rules)).toBe(false);
    expect(isQuickOpenPathExcluded('src/node_modules/pkg.js', ['**/node_modules'], rules)).toBe(
      true
    );
  });

  it('preserves a backslash that is a POSIX filename character', () => {
    expect(normalizeWorkspacePath('/project/folder\\name.ts', '/project')).toBe('folder\\name.ts');
  });
});
