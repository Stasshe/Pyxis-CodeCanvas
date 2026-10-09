import { posixPath } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase, UnixCommandFailure } from './base';

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
    const patternOptions = await collectPatternOptions(args, path =>
      this.readText(this.resolvePath(path))
    );
    const optstring = 'ivnrRlLscHhoxwqFEA:B:C:e:f:';
    const longopts = [
      'ignore-case',
      'invert-match',
      'line-number',
      'recursive',
      'files-with-matches',
      'files-without-match',
      'count',
      'with-filename',
      'no-filename',
      'only-matching',
      'word-regexp',
      'line-regexp',
      'quiet',
      'silent',
      'no-messages',
      'fixed-strings',
      'extended-regexp',
      'include=',
      'exclude=',
      'help',
    ];
    const { flags, values, orderedOptions, positional, errors } = parseWithGetOpt(
      patternOptions.args,
      optstring,
      longopts
    );
    if (errors.length) throw new Error(errors.join('; '));

    const hasFixedStrings = orderedOptions.some(
      option => option.option === 'F' || option.option === 'fixed-strings'
    );
    const hasExtendedRegexp = orderedOptions.some(
      option => option.option === 'E' || option.option === 'extended-regexp'
    );
    if (hasFixedStrings && hasExtendedRegexp) {
      throw new Error('grep: conflicting matchers specified');
    }

    // --help only (we don't override -h behavior)
    if (flags.has('--help')) {
      return 'Usage: grep [OPTION]... PATTERN [FILE]...\nSearch for PATTERN in each FILE or standard input.\n\nCommon options:\n  -i, --ignore-case\t\tignore case distinctions\n  -v, --invert-match\t\tselect non-matching lines\n  -n, --line-number\t\tprint line number with output lines\n  -r, --recursive\t\tread all files under each directory, recursively\n  -H, --with-filename\t\tprint filename with matches\n  -h, --no-filename\t\tdo not print filename';
    }

    if (!patternOptions.hasPatternOption && positional.length === 0) {
      throw new Error('grep: no pattern specified\nUsage: grep [OPTION]... PATTERN [FILE]...');
    }

    const patterns = patternOptions.hasPatternOption ? patternOptions.patterns : [positional[0]];
    let files = patternOptions.hasPatternOption ? positional : positional.slice(1);

    // オプション解析
    const ignoreCase = flags.has('-i') || flags.has('--ignore-case');
    const invertMatch = flags.has('-v') || flags.has('--invert-match');
    const showLineNumber = flags.has('-n') || flags.has('--line-number');
    const recursive = flags.has('-r') || flags.has('-R') || flags.has('--recursive');
    let filesWithMatches = false;
    let filesWithoutMatch = false;
    const countOnly = flags.has('-c') || flags.has('--count');
    const fixedStrings = hasFixedStrings;
    const extendedRegexp = hasExtendedRegexp;
    const wordRegexp = flags.has('-w') || flags.has('--word-regexp');
    const lineRegexp = flags.has('-x') || flags.has('--line-regexp');
    const onlyMatching = flags.has('-o') || flags.has('--only-matching');
    const quiet = flags.has('-q') || flags.has('--quiet') || flags.has('--silent');
    const noMessages = flags.has('-s') || flags.has('--no-messages');
    let forceFilename = false;
    let noFilename = false;
    for (const option of orderedOptions) {
      if (option.option === 'l' || option.option === 'files-with-matches') {
        filesWithMatches = true;
        filesWithoutMatch = false;
      }
      if (option.option === 'L' || option.option === 'files-without-match') {
        filesWithMatches = false;
        filesWithoutMatch = true;
      }
      if (option.option === 'H' || option.option === 'with-filename') {
        forceFilename = true;
        noFilename = false;
      }
      if (option.option === 'h' || option.option === 'no-filename') {
        forceFilename = false;
        noFilename = true;
      }
    }

    // コンテキスト行
    const afterContext = parseContextCount(values.get('-A'));
    const beforeContext = parseContextCount(values.get('-B'));
    const context = parseContextCount(values.get('-C'));
    let showAfter = context;
    let showBefore = context;
    if (values.has('-A')) showAfter = afterContext;
    if (values.has('-B')) showBefore = beforeContext;

    // include/exclude パターン
    const includePattern = values.get('--include') || null;
    const excludePattern = values.get('--exclude') || null;

    // 正規表現を構築
    let regex: RegExp;
    try {
      const sourcePatterns = patterns.map(pattern => {
        let source = fixedStrings
          ? escapeRegularExpression(pattern)
          : extendedRegexp
            ? pattern
            : convertBasicRegex(pattern);
        if (wordRegexp) source = `\\b${source}\\b`;
        if (lineRegexp) source = `^${source}$`;
        return `(?:${source})`;
      });
      const pat = sourcePatterns.length === 0 ? '(?!)' : sourcePatterns.join('|');
      regex = new RegExp(pat, onlyMatching ? (ignoreCase ? 'ig' : 'g') : ignoreCase ? 'i' : '');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`grep: invalid regular expression: ${detail}`);
    }

    // -r で検索ファイルが指定されていない場合、カレントディレクトリ
    if (files.length === 0 && recursive) {
      files = ['.'];
    }

    const multipleFiles = files.length > 1 || recursive;
    const showFilename = forceFilename || (multipleFiles && !noFilename);

    // ファイルなしでstdinがある場合
    if (files.length === 0 && stdin !== null) {
      const content = await this.readStdin(stdin);
      const result = await this.grepFile(
        null,
        '(standard input)',
        regex,
        invertMatch,
        showLineNumber,
        filesWithMatches,
        filesWithoutMatch,
        countOnly,
        onlyMatching,
        showFilename,
        showAfter,
        showBefore,
        content
      );
      if (quiet && result.matchCount > 0) return '';
      if (quiet) throw new UnixCommandFailure('', 1);
      if (result.matchCount === 0) {
        throw new UnixCommandFailure('', 1, result.output ?? '');
      }
      return result.output ?? '';
    }

    const results: string[] = [];
    const failures: string[] = [];
    let hadFileError = false;
    let anyMatch = false;
    let stdinRead = false;
    for (const fileArg of files) {
      const isStdin = fileArg === '-';
      let path: string | null = null;
      let displayPath = fileArg;
      if (!isStdin) path = this.resolvePath(fileArg);
      else displayPath = '(standard input)';
      try {
        if (path !== null && (await this.isDirectory(path))) {
          if (recursive) {
            const dirResults = await this.grepDirectory(
              path,
              fileArg,
              regex,
              invertMatch,
              showLineNumber,
              filesWithMatches,
              filesWithoutMatch,
              countOnly,
              onlyMatching,
              showFilename,
              showAfter,
              showBefore,
              quiet,
              noMessages,
              includePattern,
              excludePattern
            );
            if (dirResults.anyMatch) anyMatch = true;
            results.push(...dirResults.lines);
            failures.push(...dirResults.errors);
            if (dirResults.hadError) hadFileError = true;
          } else if (!noMessages) {
            hadFileError = true;
            failures.push(`grep: ${fileArg}: Is a directory`);
          } else {
            hadFileError = true;
          }
        } else {
          // include/exclude チェック
          const basename = path === null ? '' : posixPath.basename(path);
          if (includePattern && !this.matchGlob(includePattern, basename)) continue;
          if (excludePattern && this.matchGlob(excludePattern, basename)) continue;

          let stdinContent: string | undefined;
          if (isStdin) {
            stdinContent = '';
            if (!stdinRead) stdinContent = await this.readStdin(stdin);
            stdinRead = true;
          }
          const fileResult = await this.grepFile(
            path,
            displayPath,
            regex,
            invertMatch,
            showLineNumber,
            filesWithMatches,
            filesWithoutMatch,
            countOnly,
            onlyMatching,
            showFilename,
            showAfter,
            showBefore,
            stdinContent
          );
          if (fileResult.matchCount > 0) anyMatch = true;
          if (fileResult.output !== null) results.push(fileResult.output);
        }
      } catch (error) {
        hadFileError = true;
        if (!noMessages) {
          const detail = error instanceof Error ? error.message : String(error);
          failures.push(`grep: ${fileArg}: ${detail}`);
        }
      }
    }

    if (quiet && anyMatch) return '';
    if (hadFileError)
      throw new UnixCommandFailure(failures.join('\n'), 2, quiet ? '' : results.join(''));
    if (!anyMatch) throw new UnixCommandFailure('', 1, quiet ? '' : results.join(''));
    if (quiet) return '';
    return results.join('');
  }

  /**
   * stdinを読み取り
   */
  private async readStdin(stdin: NodeJS.ReadableStream | string | null): Promise<string> {
    if (stdin === null) return '';
    if (typeof stdin === 'string') return stdin;
    return new Promise<string>(resolve => {
      const decoder = new TextDecoder();
      let content = '';
      const finish = () => {
        content += decoder.decode();
        resolve(content);
      };
      stdin.on('data', (chunk: unknown) => {
        if (typeof chunk === 'string') content += chunk;
        else if (chunk instanceof Uint8Array) content += decoder.decode(chunk, { stream: true });
      });
      stdin.on('end', finish);
      stdin.on('close', finish);
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
    if (content.endsWith('\n')) lines.pop();
    if (content.length === 0) lines.length = 0;
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
      if (onlyMatching && !isMatch) continue;
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
            const linePrefix = showLineNumber ? `${i + 1}:` : '';
            output.push(`${prefix}${linePrefix}${m}`);
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
    path: string | null,
    displayPath: string,
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
    stdinContent?: string
  ): Promise<{ output: string | null; matchCount: number }> {
    let content = stdinContent ?? '';
    if (stdinContent === undefined) {
      if (path === null) throw new Error('Missing input path');
      const file = await this.getFile(path);
      if (!file) throw new Error('No such file or directory');
      content = await this.readText(path);
    }

    const prefix = showFilename ? `${displayPath}:` : '';
    const result = this.grepContent(
      content,
      regex,
      invertMatch,
      showLineNumber,
      onlyMatching,
      afterContext,
      beforeContext,
      prefix
    );

    if (filesWithMatches) {
      let output: string | null = null;
      if (result.matchCount > 0) output = `${displayPath}\n`;
      return { output, matchCount: result.matchCount };
    }
    if (filesWithoutMatch) {
      let output: string | null = null;
      if (result.matchCount === 0) output = `${displayPath}\n`;
      return { output, matchCount: result.matchCount };
    }
    if (countOnly) {
      return {
        output: formatLineOutput([
          showFilename ? `${displayPath}:${result.matchCount}` : String(result.matchCount),
        ]),
        matchCount: result.matchCount,
      };
    }
    if (result.matchCount === 0) {
      return { output: null, matchCount: 0 };
    }
    return { output: formatLineOutput(result.lines), matchCount: result.matchCount };
  }

  /**
   * ディレクトリ内を再帰的に検索
   */
  private async grepDirectory(
    dirPath: string,
    displayRoot: string,
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
    noMessages: boolean,
    includePattern: string | null,
    excludePattern: string | null
  ): Promise<{ lines: string[]; errors: string[]; anyMatch: boolean; hadError: boolean }> {
    const files: ProjectFile[] = await this.getDescendants(dirPath);
    const results: string[] = [];
    const errors: string[] = [];
    let anyMatch = false;
    let hadError = false;

    for (const file of files) {
      if (file.type !== 'file') continue;

      const basename = posixPath.basename(file.path);
      if (includePattern && !this.matchGlob(includePattern, basename)) continue;
      if (excludePattern && this.matchGlob(excludePattern, basename)) continue;

      const fullPath = file.path;
      const relativePath = fullPath.slice(dirPath.length).replace(/^\/+/, '');
      const displayPath = formatDisplayPath(displayRoot, relativePath);

      try {
        const result = await this.grepFile(
          fullPath,
          displayPath,
          regex,
          invertMatch,
          showLineNumber,
          filesWithMatches,
          filesWithoutMatch,
          countOnly,
          onlyMatching,
          true,
          afterContext,
          beforeContext
        );
        if (result.matchCount > 0) anyMatch = true;
        if (result.output !== null && !quiet) results.push(result.output);
      } catch (error) {
        hadError = true;
        if (!noMessages) {
          const detail = error instanceof Error ? error.message : String(error);
          errors.push(`grep: ${displayPath}: ${detail}`);
        }
      }
    }

    return { lines: results, errors, anyMatch, hadError };
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

async function collectPatternOptions(
  args: string[],
  readPatternFile: (path: string) => Promise<string>
): Promise<{ args: string[]; patterns: string[]; hasPatternOption: boolean }> {
  const cleanArgs: string[] = [];
  const patterns: string[] = [];
  let hasPatternOption = false;
  let optionsEnded = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (optionsEnded) {
      cleanArgs.push(argument);
      continue;
    }
    if (argument === '--') {
      optionsEnded = true;
      cleanArgs.push(argument);
      continue;
    }
    if (argument === '--regexp' || argument === '--file') {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`grep: option '${argument}' requires an argument`);
      index += 1;
      hasPatternOption = true;
      if (argument === '--regexp') patterns.push(value);
      else patterns.push(...readPatternLines(await readPatternFile(value)));
      continue;
    }
    if (argument === '--include' || argument === '--exclude') {
      cleanArgs.push(argument);
      if (index + 1 < args.length) {
        index += 1;
        cleanArgs.push(args[index]);
      }
      continue;
    }
    if (argument.startsWith('--regexp=') || argument.startsWith('--file=')) {
      hasPatternOption = true;
      const value = argument.slice(argument.indexOf('=') + 1);
      if (argument.startsWith('--regexp=')) patterns.push(value);
      else patterns.push(...readPatternLines(await readPatternFile(value)));
      continue;
    }
    if (argument.startsWith('-') && !argument.startsWith('--') && argument.length > 1) {
      let retained = '';
      let collectedPattern = false;
      let consumedContextArgument = false;
      for (let optionIndex = 1; optionIndex < argument.length; optionIndex += 1) {
        const option = argument[optionIndex];
        if (option === 'A' || option === 'B' || option === 'C') {
          if (optionIndex + 1 === argument.length && index + 1 < args.length) {
            index += 1;
            consumedContextArgument = true;
          }
          break;
        }
        if (option !== 'e' && option !== 'f') {
          retained += option;
          continue;
        }
        let value = argument.slice(optionIndex + 1);
        if (value === '') {
          value = args[index + 1] ?? '';
          if (index + 1 >= args.length)
            throw new Error(`grep: option '-${option}' requires an argument`);
          index += 1;
        }
        if (option === 'e') patterns.push(value);
        else patterns.push(...readPatternLines(await readPatternFile(value)));
        hasPatternOption = true;
        collectedPattern = true;
        break;
      }
      if (collectedPattern && retained) cleanArgs.push(`-${retained}`);
      if (!collectedPattern) {
        cleanArgs.push(argument);
        if (consumedContextArgument) cleanArgs.push(args[index]);
      }
      continue;
    }
    cleanArgs.push(argument);
  }
  return { args: cleanArgs, patterns, hasPatternOption };
}

function readPatternLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n');
  if (content.endsWith('\n')) lines.pop();
  return lines;
}

function parseContextCount(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value)) {
    throw new UnixCommandFailure(`grep: invalid context length argument: '${value}'`, 2);
  }
  return Number(value);
}

function formatDisplayPath(root: string, relativePath: string): string {
  if (root === '.') return `./${relativePath}`;
  if (root === '/') return `/${relativePath}`;
  return `${root.replace(/\/$/, '')}/${relativePath}`;
}

function formatLineOutput(lines: string[]): string {
  if (lines.length === 0) return '';
  return `${lines.join('\n')}\n`;
}

function escapeRegularExpression(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function convertBasicRegex(pattern: string): string {
  let converted = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\' && index + 1 < pattern.length) {
      const next = pattern[index + 1];
      if ('(){}+?|'.includes(next)) {
        converted += next;
        index += 1;
      } else {
        converted += `\\${next}`;
        index += 1;
      }
      continue;
    }
    if ('(){}+?|'.includes(character)) converted += `\\${character}`;
    else converted += character;
  }
  return converted;
}
