import { UnixCommandBase } from './base';

import { fileRepository } from '@/engine/core/fileRepository';

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

    // ファイル一覧を一度だけ取得（パフォーマンス最適化）
    const files = await this.getAllFilesFromDB();

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
            const normalizedPath = this.normalizePath(path);
            const relativePath = this.getRelativePathFromProject(normalizedPath);
            const file = files.find(f => f.path === relativePath);
            if (!file) {
              if (!force) errors.push(`rm: cannot remove '${path}': No such file or directory`);
              continue;
            }
            const isDir = file.type === 'folder';

            // -rf, -fr, -r, -f の組み合わせを正しく判定
            if (isDir) {
              if (recursive || force) {
                // -r, -rf, -fr, -f いずれか指定でディレクトリ削除許可
                const result = await this.removeFileOrDirDeep(
                  file.id,
                  normalizedPath,
                  true,
                  force,
                  interactive,
                  verbose
                );
                if (result) results.push(result);
              } else {
                errors.push(`rm: cannot remove '${path}': Is a directory`);
              }
            } else {
              // ファイル
              if (recursive && !force) {
                // -rのみでファイル指定はエラー（UNIX準拠）
                errors.push(`rm: cannot remove '${path}': Not a directory`);
              } else {
                // -f, -rf, 何もなし: ファイル削除
                const result = await this.removeFileOrDirDeep(
                  file.id,
                  normalizedPath,
                  false,
                  force,
                  interactive,
                  verbose
                );
                if (result) results.push(result);
              }
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
   * ファイル/ディレクトリを削除（再帰削除も自動対応）
   * fileRepository.deleteFile()がフォルダの場合は自動的に配下も削除してくれる
   */
  private async removeFileOrDirDeep(
    fileId: string,
    normalizedPath: string,
    recursive: boolean,
    force: boolean,
    interactive: boolean,
    verbose: boolean
  ): Promise<string | null> {
    // インタラクティブモード（未実装）
    if (interactive) {
      // 実装する場合は、ユーザー入力を受け取る仕組みが必要
    }

    // 削除前にタイプを判定（verboseメッセージ用）
    const files = await this.getAllFilesFromDB();
    const file = files.find(f => f.id === fileId);
    const isDir = file?.type === 'folder';

    // deleteFile()は自動的に:
    // - フォルダの場合は配下も再帰的に削除
    // - gitignoreキャッシュをクリア
    // - GitFileSystemに同期
    // - イベントを発火
    await fileRepository.deleteFile(fileId);

    if (verbose) {
      return isDir ? `removed directory '${normalizedPath}'` : `removed '${normalizedPath}'`;
    }
    return null;
  }
}
