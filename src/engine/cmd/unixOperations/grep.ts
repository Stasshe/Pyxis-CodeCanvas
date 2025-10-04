import { UnixCommandBase } from './base';

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
 *   - lightning-fsから読み取り
 */
export class GrepCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (positional.length === 0) {
      throw new Error('grep: no pattern specified\nUsage: grep [OPTION]... PATTERN [FILE]...');
    }

    const pattern = positional[0];
    const files = positional.slice(1);

    const ignoreCase = options.has('-i') || options.has('--ignore-case');
    const invertMatch = options.has('-v') || options.has('--invert-match');
    const showLineNumber = options.has('-n') || options.has('--line-number');
    const recursive = options.has('-r') || options.has('-R') || options.has('--recursive');
    const filesWithMatches = options.has('-l') || options.has('--files-with-matches');
    const countOnly = options.has('-c') || options.has('--count');

    const regex = new RegExp(pattern, ignoreCase ? 'i' : '');

    if (files.length === 0) {
      throw new Error('grep: no files specified');
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
      const content = await this.fs.promises.readFile(path, { encoding: 'utf8' }) as string;
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
    const files = await this.getAllFilesFromDB();
    const results: string[] = [];

    for (const file of files) {
      if (file.type !== 'file') continue;

      const isInDir = relativePath === '/' 
        ? true 
        : file.path.startsWith(relativePath + '/');

      if (!isInDir) continue;

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
