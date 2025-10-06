import { UnixCommandBase } from './base';

/**
 * cat - ファイルの内容を表示
 *
 * 使用法:
 *   cat [file...]
 *
 * オプション:
 *   -n, --number  行番号を表示
 *
 * 動作:
 *   - 複数のファイルを連結して表示
 *   - ファイル名が指定されない場合は標準入力から読み込み（未実装）
 *   - ワイルドカード対応
 */
export class CatCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (positional.length === 0) {
      throw new Error('cat: no files specified\nUsage: cat [OPTION]... [FILE]...');
    }

    const showLineNumbers = options.has('-n') || options.has('--number');

    const results: string[] = [];

    // 各引数に対してワイルドカード展開
    for (const arg of positional) {
      const expanded = await this.expandPathPattern(arg);

      if (expanded.length === 0) {
        throw new Error(`cat: ${arg}: No such file or directory`);
      }

      for (const path of expanded) {
        try {
          const content = await this.readFile(path, showLineNumbers);
          results.push(content);
        } catch (error) {
          throw new Error(`cat: ${path}: ${(error as Error).message}`);
        }
      }
    }

    return results.join('');
  }

  /**
   * ファイルの内容を読み取る（lightning-fsから直接読み取り）
   */
  private async readFile(path: string, showLineNumbers: boolean): Promise<string> {
    const normalizedPath = this.normalizePath(path);

    // ディレクトリではないことを確認
    const isDir = await this.isDirectory(normalizedPath);
    if (isDir) {
      throw new Error('Is a directory');
    }

    try {
      // lightning-fsから直接読み取り（Git用ワークスペース）
      const content = await this.fs.promises.readFile(normalizedPath, { encoding: 'utf8' });

      if (showLineNumbers) {
        const lines = (content as string).split('\n');
        return lines
          .map((line, index) => `${(index + 1).toString().padStart(6)} ${line}`)
          .join('\n');
      }

      return content as string;
    } catch (error) {
      throw new Error('No such file or directory');
    }
  }
}
