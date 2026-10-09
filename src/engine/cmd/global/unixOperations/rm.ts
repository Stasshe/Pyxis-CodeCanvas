import { FSError } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase, UnixCommandFailure } from './base';

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
 *   - Paths are expanded by the shell before this command runs.
 *   - 再帰的削除対応
 *   - エラーが発生しても他のファイルの削除を継続
 *   - -v を指定した場合のみ削除結果を表示
 */
export class RmCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const optstring = 'rRifvh';
    const longopts = ['recursive', 'force', 'interactive', 'verbose', 'help'];
    const { flags, positional, errors: parseErrors } = parseWithGetOpt(args, optstring, longopts);
    if (parseErrors.length) throw new Error(parseErrors.join('; '));
    const options = flags;

    if (options.has('--help') || options.has('-h')) {
      return 'Usage: rm [OPTION]... FILE...\n\nOptions:\n  -r, -R, --recursive\tremove directories and their contents recursively\n  -f, --force\t\tignore nonexistent files and arguments, never prompt\n  -i, --interactive\tunsupported; fails before removing\n  -v, --verbose\t\texplain what is being done';
    }

    if (options.has('-i') || options.has('--interactive')) {
      throw new UnixCommandFailure('rm: interactive confirmation is not supported', 1);
    }

    if (positional.length === 0) {
      throw new Error('rm: missing operand\nUsage: rm [OPTION]... FILE...');
    }

    const recursive = options.has('-r') || options.has('-R') || options.has('--recursive');
    const force = options.has('-f') || options.has('--force');
    const verbose = options.has('-v') || options.has('--verbose');

    const deletedPaths: string[] = [];
    const errors: string[] = [];

    const targetsToDelete: Array<{ path: string; file: ProjectFile }> = [];

    for (const arg of positional) {
      const path = this.resolvePath(arg);
      const file = await this.getLinkAwareFile(path);
      if (!file) {
        if (!force) errors.push(`rm: cannot remove '${arg}': No such file or directory`);
        continue;
      }

      const isDir = file.type === 'folder';
      if (isDir && !recursive) {
        errors.push(`rm: cannot remove '${arg}': Is a directory`);
        continue;
      }
      targetsToDelete.push({ path, file });
    }

    // 実際に削除を実行
    for (const target of targetsToDelete) {
      try {
        const isDir = target.file.type === 'folder';

        // Remove folders recursively through the FS client.
        await this.fs.rm(target.path, { recursive: isDir, force: force });

        if (verbose) {
          deletedPaths.push(
            isDir ? `removed directory '${target.path}'` : `removed '${target.path}'`
          );
        }
      } catch (error) {
        if (!force || !(error instanceof FSError && error.code === 'ENOENT')) {
          errors.push(`rm: cannot remove '${target.path}': ${(error as Error).message}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new UnixCommandFailure(errors.join('\n'), 1, verbose ? deletedPaths.join('\n') : '');
    }

    return verbose ? deletedPaths.join('\n') : '';
  }

  private async getLinkAwareFile(path: string): Promise<ProjectFile | undefined> {
    try {
      return await this.fs.lstat(path);
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
}
