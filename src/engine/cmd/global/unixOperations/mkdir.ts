import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

/**
 * mkdir - ディレクトリを作成
 *
 * 使用法:
 *   mkdir [-p] [-v] directory...
 *
 * オプション:
 *   -p, --parents   必要に応じて親ディレクトリも作成、既存の場合もエラーなし
 *   -v, --verbose   詳細な情報を表示
 *
 * 動作:
 *   - 複数のディレクトリを一度に作成可能
 *   - -pオプションで親ディレクトリも自動作成
 */
export class MkdirCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const {
      flags: options,
      positional,
      errors: parseErrors,
    } = parseWithGetOpt(args, 'pvm', ['parents', 'verbose', 'mode=', 'help']);
    if (parseErrors.length) throw new Error(parseErrors.join('; '));

    if (options.has('--help') || options.has('-h')) {
      return 'Usage: mkdir [OPTION]... DIRECTORY...\n\nOptions:\n  -p, --parents\tcreate parent directories as needed\n  -m, --mode\tset file mode (not fully supported)';
    }

    if (options.has('-m') || options.has('--mode')) {
      throw new Error('mkdir: setting directory modes is not supported');
    }

    if (positional.length === 0) {
      throw new Error('mkdir: missing operand\nUsage: mkdir [OPTION]... DIRECTORY...');
    }

    const parents = options.has('-p') || options.has('--parents');
    const verbose = options.has('-v') || options.has('--verbose');

    const results: string[] = [];
    const errors: string[] = [];

    for (const dir of positional) {
      try {
        const result = await this.createDirectory(dir, parents, verbose);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        errors.push(`mkdir: cannot create directory '${dir}': ${(error as Error).message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    if (verbose && results.length > 0) {
      return results.join('\n');
    }

    return '';
  }

  /**
   * ディレクトリを作成
   */
  private async createDirectory(
    dir: string,
    parents: boolean,
    verbose: boolean
  ): Promise<string | null> {
    const normalizedPath = this.resolvePath(dir);

    // 既に存在するかチェック
    const exists = await this.exists(normalizedPath);

    if (exists) {
      if (parents) {
        // -pオプションがある場合は既存でもエラーなし
        return null;
      }
      throw new Error('File exists');
    }

    if (!parents) {
      const parentPath = normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) || '/';
      if (!(await this.exists(parentPath))) throw new Error('No such file or directory');
    }
    await this.fs.mkdir(normalizedPath, { recursive: parents });

    if (verbose) {
      return `mkdir: created directory '${normalizedPath}'`;
    }

    return null;
  }
}
