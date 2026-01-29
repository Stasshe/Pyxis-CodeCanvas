import { UnixCommandBase } from './base';

import { fileRepository } from '@/engine/core/fileRepository';
import { fsPathToAppPath, resolvePath as pathResolve, toFSPath } from '@/engine/core/pathUtils';

/**
 * mv - ファイル/ディレクトリを移動またはリネーム
 *
 * 使用法:
 *   mv [-f] [-i] [-n] [-v] source dest
 *   mv [-f] [-i] [-n] [-v] source... directory
 *
 * オプション:
 *   -f, --force          既存のファイルを確認なしで上書き
 *   -i, --interactive    上書き前に確認
 *   -n, --no-clobber     既存のファイルを上書きしない
 *   -v, --verbose        詳細な情報を表示
 *
 * 動作:
 *   - source が1つでdestがディレクトリでない場合: リネーム
 *   - source が複数またはdestがディレクトリの場合: 移動
 *   - ワイルドカード対応（*, ?）
 */
export class MvCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (options.has('--help') || options.has('-h')) {
      return 'Usage: mv [OPTION]... SOURCE DEST\n   or: mv [OPTION]... SOURCE... DIRECTORY\n\nOptions:\n  -f, --force\toverwrite existing files without prompting\n  -i, --interactive\tprompt before overwrite\n  -n, --no-clobber\tdo not overwrite an existing file\n  -v, --verbose\t\texplain what is being done';
    }

    if (positional.length < 2) {
      throw new Error(
        'mv: missing file operand\nUsage: mv [OPTION]... SOURCE DEST\n   or: mv [OPTION]... SOURCE... DIRECTORY'
      );
    }

    const force = options.has('-f') || options.has('--force');
    const interactive = options.has('-i') || options.has('--interactive');
    const noClobber = options.has('-n') || options.has('--no-clobber');
    const verbose = options.has('-v') || options.has('--verbose');

    const destArg = positional[positional.length - 1];
    const sourceArgs = positional.slice(0, -1);

    // ワイルドカード展開（ソースのみ）
    const sources: string[] = [];
    for (const sourceArg of sourceArgs) {
      // ソースにワイルドカードがある場合のみ展開
      if (sourceArg.includes('*') || sourceArg.includes('?') || sourceArg.includes('[')) {
        const expanded = await this.expandPathPattern(sourceArg);
        if (expanded.length === 0) {
          throw new Error(`mv: cannot stat '${sourceArg}': No such file or directory`);
        }
        sources.push(...expanded);
      } else {
        // ワイルドカードなし→パス解決のみ
        // 末尾スラッシュを削除
        let cleanArg = sourceArg;
        if (cleanArg.endsWith('/') && cleanArg !== '/') {
          cleanArg = cleanArg.slice(0, -1);
        }
        const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
        const app = pathResolve(baseApp, cleanArg);
        const resolved = toFSPath(this.projectName, app);
        sources.push(resolved);
      }
    }

    // destは**絶対にグロブ展開しない**（..や.を含むパスを正しく解決）
    // 末尾スラッシュを削除
    let cleanDestArg = destArg;
    const destArgHasTrailingSlash = destArg.endsWith('/') && destArg !== '/';
    if (destArgHasTrailingSlash) {
      cleanDestArg = cleanDestArg.slice(0, -1);
    }
    const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
    const destApp = pathResolve(baseApp, cleanDestArg);
    const dest = toFSPath(this.projectName, destApp);
    const destExists = await this.exists(dest);
    const destIsDir = destExists && (await this.isDirectory(dest));

    const results: string[] = [];

    // 複数ソースの場合、またはdestArgに末尾スラッシュがある場合（ディレクトリ指定）、
    // destはディレクトリでなければならない
    if ((sources.length > 1 || destArgHasTrailingSlash) && !destIsDir) {
      throw new Error(`mv: target '${destArg}' is not a directory`);
    }

    for (const source of sources) {
      const normalizedSource = source;

      const sourceExists = await this.exists(normalizedSource);
      if (!sourceExists) {
        throw new Error(`mv: cannot stat '${source}': No such file or directory`);
      }

      const sourceIsDir = await this.isDirectory(normalizedSource);
      const sourceName = normalizedSource.split('/').pop() || '';

      // 最終的な移動先パス
      let finalDest = dest;
      if (destIsDir) {
        const finalDestApp = pathResolve(destApp, sourceName);
        finalDest = toFSPath(this.projectName, finalDestApp);
      }

      // 自分自身への移動をチェック
      if (normalizedSource === finalDest) {
        if (verbose) {
          results.push(`'${normalizedSource}' and '${finalDest}' are the same file`);
        }
        continue;
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

      // 移動実行
      try {
        await this.moveFileOrDir(normalizedSource, finalDest, sourceIsDir);

        if (verbose) {
          results.push(`'${normalizedSource}' -> '${finalDest}'`);
        }
      } catch (error) {
        throw new Error(`mv: cannot move '${source}' to '${destArg}': ${(error as Error).message}`);
      }
    }

    if (verbose) {
      return results.join('\n');
    }

    return '';
  }

  /**
   * ファイルまたはディレクトリを移動
   */
  private async moveFileOrDir(source: string, dest: string, isDir: boolean): Promise<void> {
    const sourceRelative = this.getRelativePathFromProject(source);
    const destRelative = this.getRelativePathFromProject(dest);
    const sourceFile = await this.cachedGetFile(sourceRelative);

    if (!sourceFile) {
      throw new Error('Source file not found in database');
    }

    if (isDir) {
      // ディレクトリの場合、中身も移動
      const prefix = sourceRelative === '/' ? '' : `${sourceRelative}/`;
      const childFiles = await this.cachedGetFilesByPrefix(prefix);

      // 新しい場所にディレクトリを作成
      await fileRepository.createFile(this.projectId, destRelative, '', 'folder');

      // 子ファイルを移動
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
        await fileRepository.deleteFile(child.id);
      }

      // 元のディレクトリを削除
      await fileRepository.deleteFile(sourceFile.id);

      // キャッシュを無効化
      try {
        const srcPrefix = sourceRelative === '/' ? '/' : sourceRelative;
        const dstPrefix = destRelative === '/' ? '/' : destRelative;
        this.invalidatePrefix(srcPrefix);
        this.invalidatePrefix(dstPrefix);
        this.deleteCacheFile(sourceRelative);
        this.deleteCacheFile(destRelative);
      } catch (e) {
        console.warn('[mv] cache invalidate error:', e);
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
      await fileRepository.deleteFile(sourceFile.id);

      // キャッシュを更新/削除
      try {
        this.deleteCacheFile(sourceRelative);
        this.deleteCacheFile(destRelative);
        const srcParent = sourceRelative.endsWith('/')
          ? sourceRelative
          : sourceRelative.replace(/\/[^/]*$/, '');
        const dstParent = destRelative.endsWith('/')
          ? destRelative
          : destRelative.replace(/\/[^/]*$/, '');
        this.invalidatePrefix(srcParent || '/');
        this.invalidatePrefix(dstParent || '/');
      } catch (e) {
        console.warn('[mv] cache update error:', e);
      }
    }
  }
}
