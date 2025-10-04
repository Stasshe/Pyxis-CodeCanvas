import { fileRepository } from '@/engine/core/fileRepository';
import { UnixCommandBase } from './base';

/**
 * rm - ファイル/ディレクトリを削除
 * 
 * 使用法:
 *   rm [-r] [-R] [-f] [-i] [-v] file...
 * 
 * オプション:
 *   -r, -R, --recursive  ディレクトリを再帰的に削除
 *   -f, --force          確認なしで削除、存在しないファイルでもエラーなし
 *   -i, --interactive    削除前に確認
 *   -v, --verbose        詳細な情報を表示
 * 
 * 動作:
 *   - ワイルドカード対応（*, ?）
 *   - 再帰的削除対応
 */
export class RmCommand extends UnixCommandBase {

  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (positional.length === 0) {
      throw new Error('rm: missing operand\nUsage: rm [OPTION]... FILE...');
    }

    const recursive = options.has('-r') || options.has('-R') || options.has('--recursive');
    const force = options.has('-f') || options.has('--force');
    const interactive = options.has('-i') || options.has('--interactive');
    const verbose = options.has('-v') || options.has('--verbose');

    const results: string[] = [];
    const errors: string[] = [];

    for (const arg of positional) {
      try {
        const expanded = await this.expandPathPattern(arg);
        if (expanded.length === 0) {
          if (!force) {
            errors.push(`rm: cannot remove '${arg}': No such file or directory`);
          }
          continue;
        }
        for (const path of expanded) {
          try {
            const result = await this.removeFileOrDirDeep(path, recursive, force, interactive, verbose);
            if (result) {
              results.push(result);
            }
          } catch (error) {
            if (!force) {
              errors.push(`rm: cannot remove '${path}': ${(error as Error).message}`);
            }
          }
        }
      } catch (error) {
        if (!force) {
          errors.push(`rm: ${(error as Error).message}`);
        }
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
   * ディレクトリを再帰的に削除（rm -rf対応）
   */
  private async removeFileOrDirDeep(
    path: string,
    recursive: boolean,
    force: boolean,
    interactive: boolean,
    verbose: boolean
  ): Promise<string | null> {
    const normalizedPath = this.normalizePath(path);
    const relativePath = this.getRelativePathFromProject(normalizedPath);
    const files = await this.getAllFilesFromDB();
    const file = files.find(f => f.path === relativePath);

    if (!file) {
      if (force) return null;
      throw new Error('No such file or directory');
    }

    const isDir = file.type === 'folder';
    if (isDir && !recursive) {
      throw new Error('Is a directory');
    }

    // インタラクティブモード（未実装）
    if (interactive) {
      // 実装する場合は、ユーザー入力を受け取る仕組みが必要
    }

    // ディレクトリの場合、配下すべてを再帰的に削除
    if (isDir) {
      // 自分自身も含めて、relativePathで始まるもの全て
      const allFiles = files.filter(f => f.path === relativePath || f.path.startsWith(relativePath + '/'));
      for (const child of allFiles) {
        await fileRepository.deleteFile(child.id);
      }
      if (verbose) {
        return `removed directory '${normalizedPath}'`;
      }
      return null;
    } else {
      // ファイル
      await fileRepository.deleteFile(file.id);
      if (verbose) {
        return `removed '${normalizedPath}'`;
      }
      return null;
    }
  }
}
