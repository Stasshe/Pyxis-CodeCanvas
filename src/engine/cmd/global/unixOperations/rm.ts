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
 *   - エラーが発生しても他のファイルの削除を継続
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
        
        // 各展開されたパスを個別に処理（エラーがあっても継続）
        for (const path of expanded) {
          try {
            const normalizedPath = this.normalizePath(path);
            const relativePath = this.getRelativePathFromProject(normalizedPath);
            const file = files.find(f => f.path === relativePath);

            // ファイルエントリが見つからない場合の扱い
            if (!file) {
              const isDirByExist = await this.isDirectory(normalizedPath);
              if (isDirByExist) {
                if (recursive) {
                  const prefix = relativePath === '/' ? '' : relativePath;
                  await fileRepository.deleteFilesByPrefix(this.projectId, prefix);
                  if (verbose) results.push(`removed directory '${normalizedPath}'`);
                } else {
                  // -r なしでディレクトリ → エラーだが継続
                  errors.push(`rm: cannot remove '${path}': Is a directory`);
                }
              } else {
                if (!force) {
                  errors.push(`rm: cannot remove '${path}': No such file or directory`);
                }
              }
              continue;
            }

            const isDir = file.type === 'folder';

            // ディレクトリの処理
            if (isDir) {
              if (recursive) {
                // -r 指定ありなら削除
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
                // -r なしでディレクトリ → エラーだが継続
                errors.push(`rm: cannot remove '${path}': Is a directory`);
              }
            } else {
              // 通常のファイル削除（-r の有無に関わらず削除可能）
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
          } catch (error) {
            // 個別ファイルのエラーは記録して継続
            if (!force) {
              errors.push(`rm: cannot remove '${path}': ${(error as Error).message}`);
            }
          }
        }
      } catch (error) {
        // ワイルドカード展開エラーは記録して継続
        if (!force) {
          errors.push(`rm: ${(error as Error).message}`);
        }
      }
    }

    // エラーがあっても、成功した削除がある場合は出力
    const output: string[] = [];
    
    if (verbose && results.length > 0) {
      output.push(results.join('\n'));
    }
    
    // エラーメッセージは最後にまとめて出力
    if (errors.length > 0) {
      output.push(errors.join('\n'));
    }

    // エラーがあっても処理は続行されたので、出力を返す
    // 全てのファイルが失敗した場合のみ例外を投げる
    if (errors.length > 0 && results.length === 0 && !force) {
      throw new Error(output.join('\n'));
    }

    return output.join('\n');
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