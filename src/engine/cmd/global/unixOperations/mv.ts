import { fsClient, isPathWithin, posixPath } from '@/engine/core/fs';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

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
 *   - Paths are expanded by the shell before this command runs.
 */
export class MvCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const {
      flags: options,
      positional,
      errors,
    } = parseWithGetOpt(args, 'finv', ['force', 'interactive', 'no-clobber', 'verbose', 'help']);
    if (errors.length) throw new Error(errors.join('; '));

    if (options.has('--help') || options.has('-h')) {
      return 'Usage: mv [OPTION]... SOURCE DEST\n   or: mv [OPTION]... SOURCE... DIRECTORY\n\nOptions:\n  -f, --force\toverwrite existing files without prompting\n  -i, --interactive\tprompt before overwrite\n  -n, --no-clobber\tdo not overwrite an existing file\n  -v, --verbose\t\texplain what is being done';
    }

    if (positional.length < 2) {
      throw new Error(
        'mv: missing file operand\nUsage: mv [OPTION]... SOURCE DEST\n   or: mv [OPTION]... SOURCE... DIRECTORY'
      );
    }

    const interactive = options.has('-i') || options.has('--interactive');
    const noClobber = options.has('-n') || options.has('--no-clobber');
    const verbose = options.has('-v') || options.has('--verbose');

    const destArg = positional[positional.length - 1];
    const sourceArgs = positional.slice(0, -1);

    const sources = sourceArgs.map(source => this.resolvePath(source));

    // A trailing slash requires a directory destination.
    const destArgHasTrailingSlash = destArg.endsWith('/') && destArg !== '/';
    const dest = this.resolvePath(destArg);
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
      const sourceName = posixPath.basename(normalizedSource);

      // 最終的な移動先パス
      let finalDest = dest;
      if (destIsDir) {
        finalDest = posixPath.join(dest, sourceName);
      }

      // 自分自身への移動をチェック
      if (normalizedSource === finalDest) {
        if (verbose) {
          results.push(`'${normalizedSource}' and '${finalDest}' are the same file`);
        }
        continue;
      }
      if (sourceIsDir && isPathWithin(finalDest, normalizedSource)) {
        throw new Error(`mv: cannot move a directory '${source}' into itself '${finalDest}'`);
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
    const sourceFile = await this.getFile(source);

    if (!sourceFile) {
      throw new Error('Source file not found in database');
    }

    if (isDir !== (sourceFile.type === 'folder')) throw new Error('Source type changed');
    await fsClient.rename(source, dest);
  }
}
