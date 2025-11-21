import { UnixCommandBase } from './base';

import type { ProjectFile } from '@/types';
// use cached helpers from UnixCommandBase instead of direct fileRepository access

/**
 * grep - ファイル内のパターンを検索
 *
 * 使用法:
 *   grep [options] pattern [file...]
 *
 * オプション:
 *   -i, --ignore-case      大文字小文字を区別しない
 *   -v, --invert-match     一致しない行を表示
 *   -n, --line-number      行番号を表示
 *   -r, -R, --recursive    ディレクトリを再帰的に検索
 *   -l, --files-with-matches  一致したファイル名のみ表示
 *   -c, --count            一致した行数のみ表示
 *
 * 動作:
 *   - ワイルドカード対応
 *   - 再帰検索対応
 */
export class GrepCommand extends UnixCommandBase {
  async execute(
    args: string[],
    stdin: NodeJS.ReadableStream | string | null = null
  ): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (positional.length === 0) {
      throw new Error('grep: no pattern specified\nUsage: grep [OPTION]... PATTERN [FILE]...');
    }

    const pattern = positional[0];
    let files = positional.slice(1);

    const ignoreCase = options.has('-i') || options.has('--ignore-case');
    const invertMatch = options.has('-v') || options.has('--invert-match');
    const showLineNumber = options.has('-n') || options.has('--line-number');
    const recursive = options.has('-r') || options.has('-R') || options.has('--recursive');
    const filesWithMatches = options.has('-l') || options.has('--files-with-matches');
    const countOnly = options.has('-c') || options.has('--count');
    const fixedStrings = options.has('-F') || options.has('--fixed-strings');
    const extendedRegexp = options.has('-E') || options.has('--extended-regexp');

    // Build regex according to options (-F: fixed strings, -E: extended regexp)
    let regex: RegExp;
    try {
      if (fixedStrings) {
        // escape regex metacharacters to treat pattern as fixed string
        const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(esc, ignoreCase ? 'i' : '');
      } else {
        // For JS RegExp, -E (extended) and default behave similarly; keep simple
        regex = new RegExp(pattern, ignoreCase ? 'i' : '');
      }
    } catch (e) {
      throw new Error(`grep: invalid regular expression: ${(e as Error).message}`);
    }

    // If -r specified and no files provided, default to currentDir (like GNU grep -r)
    if (files.length === 0 && recursive) {
      files = [this.currentDir];
    }

    // If no files provided and stdin exists, read and search stdin (linux grep behavior)
    if (files.length === 0 && stdin !== null) {
      let contentStr = '';
      if (typeof stdin === 'string') {
        contentStr = stdin;
      } else {
        // read from stream until end
        contentStr = await new Promise<string>(resolve => {
          let buf = '';
          const s = stdin as NodeJS.ReadableStream;
          s.on('data', (c: any) => (buf += String(c)));
          s.on('end', () => resolve(buf));
          s.on('close', () => resolve(buf));
          // If stream is already ended or no events, give a tick to allow producers
          setTimeout(() => resolve(buf), 50);
        });
      }
      const lines = String(contentStr).split('\n');
      const matches: string[] = [];
      let matchCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isMatch = regex.test(line);
        if ((isMatch && !invertMatch) || (!isMatch && invertMatch)) {
          matchCount++;
          matches.push(line);
        }
      }

      if (matchCount === 0) return '';
      if (countOnly) return String(matchCount);
      return matches.join('\n');
    }

    const results: string[] = [];

    for (const fileArg of files) {
      const expanded = await this.expandPathPattern(fileArg);

      for (const path of expanded) {
        try {
          const normalizedPath = this.normalizePath(path);
          const isDir = await this.isDirectory(normalizedPath);

          if (isDir) {
            if (recursive) {
              const dirResults = await this.grepDirectory(
                normalizedPath,
                regex,
                invertMatch,
                showLineNumber,
                filesWithMatches,
                countOnly,
                files.length > 1
              );
              results.push(...dirResults);
            } else {
              results.push(`grep: ${path}: Is a directory`);
            }
          } else {
            const fileResults = await this.grepFile(
              normalizedPath,
              regex,
              invertMatch,
              showLineNumber,
              filesWithMatches,
              countOnly,
              files.length > 1
            );
            if (fileResults) {
              results.push(fileResults);
            }
          }
        } catch (error) {
          results.push(`grep: ${path}: ${(error as Error).message}`);
        }
      }
    }

    return results.join('\n');
  }

  /**
   * ファイル内を検索
   */
  private async grepFile(
    path: string,
    regex: RegExp,
    invertMatch: boolean,
    showLineNumber: boolean,
    filesWithMatches: boolean,
    countOnly: boolean,
    showFilename: boolean
  ): Promise<string | null> {
    try {
      // DB からファイルを取得
      const relative = this.getRelativePathFromProject(path);
      const file = await this.getFileFromDB(relative);
      if (!file) throw new Error('No such file or directory');

      let content = '';
      if (file.isBufferArray && file.bufferContent) {
        const decoder = new TextDecoder('utf-8');
        content = decoder.decode(file.bufferContent as ArrayBuffer);
      } else if (typeof file.content === 'string') {
        content = file.content;
      } else {
        content = '';
      }
      const lines = content.split('\n');
      const matches: string[] = [];
      let matchCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isMatch = regex.test(line);

        if ((isMatch && !invertMatch) || (!isMatch && invertMatch)) {
          matchCount++;

          if (!filesWithMatches && !countOnly) {
            let result = '';
            if (showFilename) {
              result += `${path}:`;
            }
            if (showLineNumber) {
              result += `${i + 1}:`;
            }
            result += line;
            matches.push(result);
          }
        }
      }

      if (matchCount === 0) {
        return null;
      }

      if (filesWithMatches) {
        return path;
      }

      if (countOnly) {
        return showFilename ? `${path}:${matchCount}` : `${matchCount}`;
      }

      return matches.join('\n');
    } catch (error) {
      throw new Error('No such file or directory');
    }
  }

  /**
   * ディレクトリ内を再帰的に検索
   */
  private async grepDirectory(
    dirPath: string,
    regex: RegExp,
    invertMatch: boolean,
    showLineNumber: boolean,
    filesWithMatches: boolean,
    countOnly: boolean,
    showFilename: boolean
  ): Promise<string[]> {
    const relativePath = this.getRelativePathFromProject(dirPath);
    const prefix = relativePath === '/' ? '' : `${relativePath}/`;
    const files: ProjectFile[] = await this.cachedGetFilesByPrefix(prefix);
    const results: string[] = [];

    for (const file of files) {
      if (file.type !== 'file') continue;

      const fullPath = `${this.getProjectRoot()}${file.path}`;

      try {
        const result = await this.grepFile(
          fullPath,
          regex,
          invertMatch,
          showLineNumber,
          filesWithMatches,
          countOnly,
          true // always show filename in recursive mode
        );
        if (result) {
          results.push(result);
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }
}
