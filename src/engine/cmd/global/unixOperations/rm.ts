import { FSError, fsClient } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';
import { parseWithGetOpt } from '../../lib';
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
 *   - Paths are expanded by the shell before this command runs.
 *   - 再帰的削除対応
 *   - エラーが発生しても他のファイルの削除を継続
 *   - デフォルトで削除結果を表示（-v なしでも）
 */
export class RmCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const optstring = 'rRfi v h'.replace(/\s+/g, '');
    const longopts = ['recursive', 'force', 'interactive', 'verbose', 'help'];
    const { flags, positional, errors: parseErrors } = parseWithGetOpt(args, optstring, longopts);
    if (parseErrors.length) throw new Error(parseErrors.join('; '));
    const options = flags;

    if (options.has('--help') || options.has('-h')) {
      return 'Usage: rm [OPTION]... FILE...\n\nOptions:\n  -r, -R, --recursive\tremove directories and their contents recursively\n  -f, --force\t\tignore nonexistent files and arguments, never prompt\n  -i, --interactive\tprompt before every removal\n  -v, --verbose\t\texplain what is being done';
    }

    if (positional.length === 0) {
      throw new Error('rm: missing operand\nUsage: rm [OPTION]... FILE...');
    }

    const recursive = options.has('-r') || options.has('-R') || options.has('--recursive');
    const force = options.has('-f') || options.has('--force');
    const interactive = options.has('-i') || options.has('--interactive');
    const verbose = options.has('-v') || options.has('--verbose');

    const deletedPaths: string[] = [];
    const errors: string[] = [];

    const targetsToDelete: Array<{ path: string; file: ProjectFile }> = [];

    for (const arg of positional) {
      const path = this.resolvePath(arg);
      const file = await this.getFile(path);
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

    // 削除対象がない場合は早期リターン
    if (targetsToDelete.length === 0) {
      if (errors.length > 0) {
        if (!force) {
          throw new Error(errors.join('\n'));
        }
        return errors.join('\n');
      }
      return '';
    }

    // インタラクティブモードの確認（未実装）
    if (interactive) {
      // 実装する場合は、ユーザー入力を受け取る仕組みが必要
      // 今は警告のみ
      console.warn('[rm] Interactive mode (-i) is not yet implemented');
    }

    // 実際に削除を実行
    for (const target of targetsToDelete) {
      try {
        const isDir = target.file.type === 'folder';

        // Remove folders recursively through the FS client.
        await fsClient.rm(target.path, { recursive: isDir, force: force });

        // 削除成功を記録
        if (verbose) {
          deletedPaths.push(
            isDir ? `removed directory '${target.path}'` : `removed '${target.path}'`
          );
        } else {
          // -v なしでも削除したパスを記録（簡潔に）
          deletedPaths.push(target.path);
        }
      } catch (error) {
        if (!force || !(error instanceof FSError && error.code === 'ENOENT')) {
          errors.push(`rm: cannot remove '${target.path}': ${(error as Error).message}`);
        }
      }
    }

    // 結果を構築
    const output: string[] = [];

    // 削除成功のメッセージ
    if (deletedPaths.length > 0) {
      if (verbose) {
        // -v の場合は詳細メッセージ
        output.push(deletedPaths.join('\n'));
      } else {
        // デフォルトは簡潔に「削除しました: N個のファイル」
        output.push(`Deleted ${deletedPaths.length} item(s)`);
      }
    }

    // エラーメッセージ
    if (errors.length > 0) {
      output.push(errors.join('\n'));
    }

    // 完全失敗の場合のみ例外を投げる
    if (errors.length > 0 && deletedPaths.length === 0 && !force) {
      throw new Error(output.join('\n'));
    }

    return output.join('\n');
  }
}
