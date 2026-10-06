import { fsClient, isPathWithin, posixPath } from '@/engine/core/fs';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

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
 *   - Paths are expanded by the shell before this command runs.
 *   - 再帰的コピー対応
 */
export class CpCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const optstring = 'rRfinvh';
    const longopts = ['recursive', 'force', 'interactive', 'no-clobber', 'verbose', 'help'];
    const { flags, positional, errors } = parseWithGetOpt(args, optstring, longopts);
    if (errors.length) throw new Error(errors.join('; '));
    const options = flags;

    if (options.has('--help') || options.has('-h')) {
      return 'Usage: cp [OPTION]... SOURCE DEST\n   or: cp [OPTION]... SOURCE... DIRECTORY\n\nOptions:\n  -r, -R, --recursive\tcopy directories recursively\n  -f, --force\toverwrite existing files without prompting\n  -i, --interactive\tprompt before overwrite\n  -n, --no-clobber\tdo not overwrite an existing file\n  -v, --verbose\t\texplain what is being done';
    }

    if (positional.length < 2) {
      throw new Error(
        'cp: missing file operand\nUsage: cp [OPTION]... SOURCE DEST\n   or: cp [OPTION]... SOURCE... DIRECTORY'
      );
    }

    const recursive = options.has('-r') || options.has('-R') || options.has('--recursive');
    const interactive = options.has('-i') || options.has('--interactive');
    const noClobber = options.has('-n') || options.has('--no-clobber');
    const verbose = options.has('-v') || options.has('--verbose');

    const destArg = positional[positional.length - 1];
    const sourceArgs = positional.slice(0, -1);

    const sources = sourceArgs.map(source => this.resolvePath(source));

    const destArgHasTrailingSlash = destArg.endsWith('/') && destArg !== '/';
    const dest = this.resolvePath(destArg);
    const destExists = await this.exists(dest);
    const destIsDir = destExists && (await this.isDirectory(dest));

    const results: string[] = [];

    // 複数ソースの場合、またはdestArgに末尾スラッシュがある場合（ディレクトリ指定）、
    // destはディレクトリでなければならない
    if ((sources.length > 1 || destArgHasTrailingSlash) && !destIsDir) {
      throw new Error(`cp: target '${destArg}' is not a directory`);
    }

    for (const source of sources) {
      const normalizedSource = source;

      const sourceExists = await this.exists(normalizedSource);
      if (!sourceExists) {
        throw new Error(`cp: cannot stat '${source}': No such file or directory`);
      }

      const sourceIsDir = await this.isDirectory(normalizedSource);

      // ディレクトリコピーには-rオプションが必要
      if (sourceIsDir && !recursive) {
        throw new Error(`cp: -r not specified; omitting directory '${source}'`);
      }

      const sourceName = posixPath.basename(normalizedSource);

      // 最終的なコピー先パス
      let finalDest = dest;
      if (destIsDir) {
        finalDest = posixPath.join(dest, sourceName);
      }

      if (normalizedSource === finalDest) {
        throw new Error(`cp: '${source}' and '${finalDest}' are the same file`);
      }
      if (sourceIsDir && isPathWithin(finalDest, normalizedSource)) {
        throw new Error(`cp: cannot copy a directory '${source}' into itself '${finalDest}'`);
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
    const sourceFile = await this.getFile(source);

    if (!sourceFile) {
      throw new Error('Source file not found in database');
    }

    if (isDir && recursive) {
      // ディレクトリの場合、中身も再帰的にコピー
      const childFiles = await fsClient.walk(source);

      // 新しい場所にディレクトリを作成
      await fsClient.mkdir(dest, { recursive: true });

      // 子ファイルをコピー
      for (const child of childFiles) {
        const relativePath = posixPath.relative(source, child.path);
        const newChildPath = posixPath.join(dest, relativePath);
        if (child.type === 'folder') await fsClient.mkdir(newChildPath, { recursive: true });
        else await fsClient.writeFile(newChildPath, await fsClient.readFile(child.path));
      }
    } else {
      // ファイルの場合
      if (sourceFile.type === 'folder') await fsClient.mkdir(dest, { recursive: true });
      else await fsClient.writeFile(dest, await fsClient.readFile(source));
    }
  }
}
