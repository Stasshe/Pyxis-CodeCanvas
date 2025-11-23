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
 *   - デフォルトで削除結果を表示（-v なしでも）
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

    const deletedPaths: string[] = [];
    const errors: string[] = [];

    // ワイルドカード展開
    // シェル経由なら既に展開済み（ワイルドカードがないので即座にリターン）
    // 直接API呼び出しなら内部で展開
    const targetsToDelete: Array<{ path: string; file: any }> = [];

    for (const arg of positional) {
      try {
        const expanded = await this.expandPathPattern(arg);

        if (expanded.length === 0) {
          if (!force) {
            errors.push(`rm: cannot remove '${arg}': No such file or directory`);
          }
          continue;
        }

        // 展開された各パスを処理
        for (const expandedPath of expanded) {
          const normalizedPath = this.normalizePath(expandedPath);
          const relativePath = this.getRelativePathFromProject(normalizedPath);

          try {
            const file = await this.cachedGetFile(relativePath);

            if (!file) {
              // ファイルが見つからない場合
              if (!force) {
                errors.push(`rm: cannot remove '${expandedPath}': No such file or directory`);
              }
              continue;
            }

            const isDir = file.type === 'folder';

            // ディレクトリだが -r なしの場合
            if (isDir && !recursive) {
              errors.push(`rm: cannot remove '${expandedPath}': Is a directory`);
              continue;
            }

            // 削除対象としてリストに追加
            targetsToDelete.push({
              path: normalizedPath,
              file: file,
            });
          } catch (error) {
            if (!force) {
              errors.push(`rm: cannot remove '${expandedPath}': ${(error as Error).message}`);
            }
          }
        }
      } catch (error) {
        // ワイルドカード展開エラー
        if (!force) {
          errors.push(`rm: ${(error as Error).message}`);
        }
      }
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

        // 削除実行（fileRepository.deleteFile は自動的に子ファイルも削除）
        await fileRepository.deleteFile(target.file.id);

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
        // 削除失敗
        if (!force) {
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
