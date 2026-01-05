import { UnixCommandBase } from './base';
import { parseArgs } from '../../lib';

import type { ProjectFile } from '@/types';

/**
 * grep - ファイル内のパターンを検索 (POSIX/GNU準拠)
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
 *   -L, --files-without-match 一致しないファイル名のみ表示
 *   -c, --count            一致した行数のみ表示
 *   -H, --with-filename    ファイル名を常に表示
 *   -h, --no-filename      ファイル名を表示しない
 *   -o, --only-matching    マッチした部分のみ表示
 *   -w, --word-regexp      単語単位でマッチ
 *   -x, --line-regexp      行全体でマッチ
 *   -q, --quiet, --silent  出力なし（終了コードのみ）
 *   -s, --no-messages      エラーメッセージを抑制
 *   -F, --fixed-strings    パターンを固定文字列として扱う
 *   -E, --extended-regexp  拡張正規表現を使用
 *   -A NUM                 マッチ後NUM行も表示
 *   -B NUM                 マッチ前NUM行も表示
 *   -C NUM                 マッチ前後NUM行を表示
 *   --include=GLOB         指定パターンのファイルのみ検索
 *   --exclude=GLOB         指定パターンのファイルを除外
 *
 * stdinからの入力もサポート
 */
export class GrepCommand extends UnixCommandBase {
  async execute(
    args: string[],
    stdin: NodeJS.ReadableStream | string | null = null
  ): Promise<string> {
    const { flags, values, positional } = parseArgs(args, [
      '-A', '-B', '-C', '-e', '-f', '--include', '--exclude',
    ]);

    if (positional.length === 0) {
      throw new Error('grep: no pattern specified\nUsage: grep [OPTION]... PATTERN [FILE]...');
    }

    const pattern = positional[0];
    let files = positional.slice(1);

    // オプション解析
    const ignoreCase = flags.has('-i') || flags.has('--ignore-case');
    const invertMatch = flags.has('-v') || flags.has('--invert-match');
    const showLineNumber = flags.has('-n') || flags.has('--line-number');
    const recursive = flags.has('-r') || flags.has('-R') || flags.has('--recursive');
    const filesWithMatches = flags.has('-l') || flags.has('--files-with-matches');
    const filesWithoutMatch = flags.has('-L') || flags.has('--files-without-match');
    const countOnly = flags.has('-c') || flags.has('--count');
    const fixedStrings = flags.has('-F') || flags.has('--fixed-strings');
    const wordRegexp = flags.has('-w') || flags.has('--word-regexp');
    const lineRegexp = flags.has('-x') || flags.has('--line-regexp');
    const onlyMatching = flags.has('-o') || flags.has('--only-matching');
    const quiet = flags.has('-q') || flags.has('--quiet') || flags.has('--silent');
    const noMessages = flags.has('-s') || flags.has('--no-messages');
    const forceFilename = flags.has('-H') || flags.has('--with-filename');
    const noFilename = flags.has('-h') || flags.has('--no-filename');

    // コンテキスト行
    const afterContext = Number.parseInt(values.get('-A') || '0', 10);
    const beforeContext = Number.parseInt(values.get('-B') || '0', 10);
    const context = Number.parseInt(values.get('-C') || '0', 10);
    const showAfter = context || afterContext;
    const showBefore = context || beforeContext;

    // include/exclude パターン
    const includePattern = values.get('--include') || null;
    const excludePattern = values.get('--exclude') || null;

    // 正規表現を構築
    let regex: RegExp;
    try {
      let pat = pattern;
      if (fixedStrings) {
        pat = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      if (wordRegexp) {
        pat = `\\b${pat}\\b`;
      }
      if (lineRegexp) {
        pat = `^${pat}$`;
      }
      // gフラグは-oオプションでのみ使用（複数マッチ取得）
      // test()での状態問題を避けるため、通常は使用しない
      regex = new RegExp(pat, ignoreCase ? 'i' : '');
    } catch (e) {
      throw new Error(`grep: invalid regular expression: ${(e as Error).message}`);
    }

    // -r で検索ファイルが指定されていない場合、カレントディレクトリ
    if (files.length === 0 && recursive) {
      files = ['.'];
    }

    // ファイルなしでstdinがある場合
    if (files.length === 0 && stdin !== null) {
      const content = await this.readStdin(stdin);
      const result = this.grepContent(
        content, regex, invertMatch, showLineNumber, onlyMatching,
        showAfter, showBefore, ''
      );
      if (quiet) return result.matchCount > 0 ? '' : '';
      if (countOnly) return String(result.matchCount);
      return result.lines.join('\n');
    }

    const results: string[] = [];
    let anyMatch = false;
    const multipleFiles = files.length > 1 || recursive;
    const showFilename = forceFilename || (multipleFiles && !noFilename);

    for (const fileArg of files) {
      const expanded = await this.expandPathPattern(fileArg);

      for (const path of expanded) {
        try {
          const normalizedPath = this.normalizePath(path);
          const isDir = await this.isDirectory(normalizedPath);

          if (isDir) {
            if (recursive) {
              const dirResults = await this.grepDirectory(
                normalizedPath, regex, invertMatch, showLineNumber, 
                filesWithMatches, filesWithoutMatch, countOnly, onlyMatching,
                showFilename, showAfter, showBefore, quiet,
                includePattern, excludePattern
              );
              if (dirResults.anyMatch) anyMatch = true;
              results.push(...dirResults.lines);
            } else if (!noMessages) {
              results.push(`grep: ${path}: Is a directory`);
            }
          } else {
            // include/exclude チェック
            const basename = path.split('/').pop() || '';
            if (includePattern && !this.matchGlob(includePattern, basename)) continue;
            if (excludePattern && this.matchGlob(excludePattern, basename)) continue;

            const fileResult = await this.grepFile(
              normalizedPath, regex, invertMatch, showLineNumber,
              filesWithMatches, filesWithoutMatch, countOnly, onlyMatching,
              showFilename, showAfter, showBefore
            );
            if (fileResult.matchCount > 0) anyMatch = true;
            if (fileResult.output) results.push(fileResult.output);
          }
        } catch (error) {
          if (!noMessages) {
            results.push(`grep: ${path}: ${(error as Error).message}`);
          }
        }
      }
    }

    if (quiet) {
      // 終了コードで示す（ここでは空文字を返す）
      return anyMatch ? '' : '';
    }

    return results.join('\n');
  }

  /**
   * stdinを読み取り
   */
  private async readStdin(stdin: NodeJS.ReadableStream | string): Promise<string> {
    if (typeof stdin === 'string') return stdin;
    return new Promise<string>(resolve => {
      let buf = '';
      stdin.on('data', (c: any) => (buf += String(c)));
      stdin.on('end', () => resolve(buf));
      stdin.on('close', () => resolve(buf));
      setTimeout(() => resolve(buf), 50);
    });
  }

  /**
   * コンテンツ内を検索
   */
  private grepContent(
    content: string,
    regex: RegExp,
    invertMatch: boolean,
    showLineNumber: boolean,
    onlyMatching: boolean,
    afterContext: number,
    beforeContext: number,
    prefix: string
  ): { lines: string[]; matchCount: number } {
    const lines = content.split('\n');
    const output: string[] = [];
    let matchCount = 0;
    const matchedLineIndices = new Set<number>();
    const contextLines = new Set<number>();

    // 最初にマッチ行を特定
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      regex.lastIndex = 0;
      const isMatch = regex.test(line);
      if ((isMatch && !invertMatch) || (!isMatch && invertMatch)) {
        matchCount++;
        matchedLineIndices.add(i);
        // コンテキスト行を追加
        for (let j = Math.max(0, i - beforeContext); j < i; j++) {
          contextLines.add(j);
        }
        for (let j = i + 1; j <= Math.min(lines.length - 1, i + afterContext); j++) {
          contextLines.add(j);
        }
      }
    }

    // 出力を構築
    let lastPrinted = -2;
    for (let i = 0; i < lines.length; i++) {
      if (!matchedLineIndices.has(i) && !contextLines.has(i)) continue;

      // セパレータ（非連続の場合）
      if (lastPrinted >= 0 && i > lastPrinted + 1 && (beforeContext > 0 || afterContext > 0)) {
        output.push('--');
      }
      lastPrinted = i;

      const line = lines[i];
      const isMatch = matchedLineIndices.has(i);
      let result = '';

      if (prefix) result += prefix;
      if (showLineNumber) {
        result += `${i + 1}${isMatch ? ':' : '-'}`;
      }

      if (onlyMatching && isMatch) {
        regex.lastIndex = 0;
        const matches = line.match(regex);
        if (matches) {
          for (const m of matches) {
            output.push(prefix + m);
          }
        }
        continue;
      }

      result += line;
      output.push(result);
    }

    return { lines: output, matchCount };
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
    filesWithoutMatch: boolean,
    countOnly: boolean,
    onlyMatching: boolean,
    showFilename: boolean,
    afterContext: number,
    beforeContext: number
  ): Promise<{ output: string | null; matchCount: number }> {
    const relative = this.getRelativePathFromProject(path);
    const file = await this.getFileFromDB(relative);
    if (!file) throw new Error('No such file or directory');

    let content = '';
    if (file.isBufferArray && file.bufferContent) {
      content = new TextDecoder('utf-8').decode(file.bufferContent as ArrayBuffer);
    } else if (typeof file.content === 'string') {
      content = file.content;
    }

    const prefix = showFilename ? `${path}:` : '';
    const result = this.grepContent(
      content, regex, invertMatch, showLineNumber, onlyMatching,
      afterContext, beforeContext, prefix
    );

    if (filesWithMatches) {
      return { output: result.matchCount > 0 ? path : null, matchCount: result.matchCount };
    }
    if (filesWithoutMatch) {
      return { output: result.matchCount === 0 ? path : null, matchCount: result.matchCount };
    }
    if (countOnly) {
      return {
        output: showFilename ? `${path}:${result.matchCount}` : String(result.matchCount),
        matchCount: result.matchCount,
      };
    }
    if (result.matchCount === 0) {
      return { output: null, matchCount: 0 };
    }
    return { output: result.lines.join('\n'), matchCount: result.matchCount };
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
    filesWithoutMatch: boolean,
    countOnly: boolean,
    onlyMatching: boolean,
    showFilename: boolean,
    afterContext: number,
    beforeContext: number,
    quiet: boolean,
    includePattern: string | null,
    excludePattern: string | null
  ): Promise<{ lines: string[]; anyMatch: boolean }> {
    const relativePath = this.getRelativePathFromProject(dirPath);
    const prefix = relativePath === '/' ? '' : `${relativePath}/`;
    const files: ProjectFile[] = await this.cachedGetFilesByPrefix(prefix);
    const results: string[] = [];
    let anyMatch = false;

    for (const file of files) {
      if (file.type !== 'file') continue;

      const basename = file.name || file.path.split('/').pop() || '';
      if (includePattern && !this.matchGlob(includePattern, basename)) continue;
      if (excludePattern && this.matchGlob(excludePattern, basename)) continue;

      const fullPath = `${this.getProjectRoot()}${file.path}`;

      try {
        const result = await this.grepFile(
          fullPath, regex, invertMatch, showLineNumber,
          filesWithMatches, filesWithoutMatch, countOnly, onlyMatching,
          true, afterContext, beforeContext
        );
        if (result.matchCount > 0) anyMatch = true;
        if (result.output && !quiet) results.push(result.output);
      } catch {
        // スキップ
      }
    }

    return { lines: results, anyMatch };
  }

  /**
   * シンプルなglobマッチ
   */
  private matchGlob(pattern: string, str: string): boolean {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(str);
  }
}
