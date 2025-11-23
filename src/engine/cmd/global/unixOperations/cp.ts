import { UnixCommandBase } from './base';

import { fileRepository } from '@/engine/core/fileRepository';

/**
 * cp - ファイル/ディレクトリをコピー
 *
 * 使用法:
 *   cp [-r] [-R] [-f] [-i] [-n] [-v] source dest
 *   cp [-r] [-R] [-f] [-i] [-n] [-v] source... directory
 *
 * オプション:
 *   -r, -R, --recursive  ディレクトリを再帰的にコピー
 *   -f, --force          既存のファイルを確認なしで上書き
 *   -i, --interactive    上書き前に確認
 *   -n, --no-clobber     既存のファイルを上書きしない
 *   -v, --verbose        詳細な情報を表示
 *
 * 動作:
 *   - ワイルドカード対応（*, ?）
 *   - 再帰的コピー対応
 */
export class CpCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (positional.length < 2) {
      throw new Error(
        'cp: missing file operand\nUsage: cp [OPTION]... SOURCE DEST\n   or: cp [OPTION]... SOURCE... DIRECTORY'
      );
    }

    const recursive = options.has('-r') || options.has('-R') || options.has('--recursive');
    const force = options.has('-f') || options.has('--force');
    const interactive = options.has('-i') || options.has('--interactive');
    const noClobber = options.has('-n') || options.has('--no-clobber');
    const verbose = options.has('-v') || options.has('--verbose');

    const destArg = positional[positional.length - 1];
    const sourceArgs = positional.slice(0, -1);

    // ワイルドカード展開（ソースのみ）
    // destは常にパス解決のみ（グロブ展開しない）
    const sources: string[] = [];
    for (const sourceArg of sourceArgs) {
      // ソースにワイルドカードがある場合のみ展開
      if (sourceArg.includes('*') || sourceArg.includes('?') || sourceArg.includes('[')) {
        const expanded = await this.expandPathPattern(sourceArg);
        if (expanded.length === 0) {
          throw new Error(`cp: cannot stat '${sourceArg}': No such file or directory`);
        }
        sources.push(...expanded);
      } else {
        // ワイルドカードなし→パス解決のみ
        // 末尾スラッシュを削除
        let cleanArg = sourceArg;
        if (cleanArg.endsWith('/') && cleanArg !== '/') {
          cleanArg = cleanArg.slice(0, -1);
        }
        const resolved = this.normalizePath(this.resolvePath(cleanArg));
        sources.push(resolved);
      }
    }

    // destは**絶対にグロブ展開しない**（..や.を含むパスを正しく解決）
    // 末尾スラッシュを削除
    let cleanDestArg = destArg;
    if (cleanDestArg.endsWith('/') && cleanDestArg !== '/') {
      cleanDestArg = cleanDestArg.slice(0, -1);
    }
    const dest = this.normalizePath(this.resolvePath(cleanDestArg));
    const destExists = await this.exists(dest);
    const destIsDir = destExists && (await this.isDirectory(dest));

    const results: string[] = [];

    // 複数ソースの場合、destはディレクトリでなければならない
    if (sources.length > 1 && !destIsDir) {
      throw new Error(`cp: target '${destArg}' is not a directory`);
    }

    for (const source of sources) {
      const normalizedSource = this.normalizePath(source);

      const sourceExists = await this.exists(normalizedSource);
      if (!sourceExists) {
        throw new Error(`cp: cannot stat '${source}': No such file or directory`);
      }

      const sourceIsDir = await this.isDirectory(normalizedSource);

      // ディレクトリコピーには-rオプションが必要
      if (sourceIsDir && !recursive) {
        throw new Error(`cp: -r not specified; omitting directory '${source}'`);
      }

      const sourceName = normalizedSource.split('/').pop() || '';

      // 最終的なコピー先パス
      let finalDest = dest;
      if (destIsDir) {
        finalDest = `${dest}/${sourceName}`;
        finalDest = this.normalizePath(finalDest);
      }

      // 上書きチェック
      const finalDestExists = await this.exists(finalDest);
      if (finalDestExists) {
        if (noClobber) {
          continue; // スキップ
        }
        if (interactive) {
          // インタラクティブモードは未実装（常に上書き）
        }
      }

      // コピー実行
      try {
        await this.copyFileOrDir(normalizedSource, finalDest, sourceIsDir, recursive);

        if (verbose) {
          results.push(`'${normalizedSource}' -> '${finalDest}'`);
        }
      } catch (error) {
        throw new Error(`cp: cannot copy '${source}' to '${destArg}': ${(error as Error).message}`);
      }
    }

    if (verbose) {
      return results.join('\n');
    }

    return '';
  }

  /**
   * ファイルまたはディレクトリをコピー
   */
  private async copyFileOrDir(
    source: string,
    dest: string,
    isDir: boolean,
    recursive: boolean
  ): Promise<void> {
    const sourceRelative = this.getRelativePathFromProject(source);
    const destRelative = this.getRelativePathFromProject(dest);
    const sourceFile = await this.cachedGetFile(sourceRelative);

    if (!sourceFile) {
      throw new Error('Source file not found in database');
    }

    if (isDir && recursive) {
      // ディレクトリの場合、中身も再帰的にコピー
      const prefix = sourceRelative === '/' ? '' : `${sourceRelative}/`;
      const childFiles = await this.cachedGetFilesByPrefix(prefix);

      // 新しい場所にディレクトリを作成
      await fileRepository.createFile(this.projectId, destRelative, '', 'folder');

      // 子ファイルをコピー
      for (const child of childFiles) {
        const newChildPath = child.path.replace(sourceRelative, destRelative);
        await fileRepository.createFile(
          this.projectId,
          newChildPath,
          child.content || '',
          child.type,
          child.isBufferArray,
          child.bufferContent
        );
      }
    } else {
      // ファイルの場合
      await fileRepository.createFile(
        this.projectId,
        destRelative,
        sourceFile.content || '',
        sourceFile.type,
        sourceFile.isBufferArray,
        sourceFile.bufferContent
      );
    }
  }
}
