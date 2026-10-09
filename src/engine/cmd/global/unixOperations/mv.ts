import { FSError, isPathWithin, posixPath } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase, UnixCommandFailure } from './base';

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
      return 'Usage: mv [OPTION]... SOURCE DEST\n   or: mv [OPTION]... SOURCE... DIRECTORY\n\nOptions:\n  -f, --force\toverwrite existing files without prompting\n  -i, --interactive\tunsupported; fails before moving\n  -n, --no-clobber\tdo not overwrite an existing file\n  -v, --verbose\t\texplain what is being done';
    }

    if (options.has('-i') || options.has('--interactive')) {
      throw new UnixCommandFailure('mv: interactive confirmation is not supported', 1);
    }

    if (positional.length < 2) {
      throw new Error(
        'mv: missing file operand\nUsage: mv [OPTION]... SOURCE DEST\n   or: mv [OPTION]... SOURCE... DIRECTORY'
      );
    }

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

    const failures: string[] = [];

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = sources[sourceIndex];
      const sourceArg = sourceArgs[sourceIndex];
      const normalizedSource = source;

      const sourceFile = await this.getLinkAwareFile(normalizedSource);
      if (!sourceFile) {
        failures.push(`mv: cannot stat '${sourceArg}': No such file or directory`);
        continue;
      }

      const sourceIsDir = sourceFile.type === 'folder';
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
        failures.push(`mv: cannot move a directory '${sourceArg}' into itself '${destArg}'`);
        continue;
      }

      // 上書きチェック
      const finalDestFile = await this.getLinkAwareFile(finalDest);
      const finalDestExists = finalDestFile !== undefined;
      if (finalDestExists) {
        if (sourceIsDir !== (finalDestFile.type === 'folder')) {
          if (sourceIsDir) {
            failures.push(
              `mv: cannot overwrite non-directory '${destArg}' with directory '${sourceArg}'`
            );
          } else {
            failures.push(`mv: cannot overwrite directory '${destArg}' with non-directory`);
          }
          continue;
        }
        if (noClobber) {
          continue; // スキップ
        }
      }

      // 移動実行
      try {
        await this.moveFileOrDir(normalizedSource, finalDest, sourceIsDir);

        if (verbose) {
          results.push(`'${normalizedSource}' -> '${finalDest}'`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`mv: cannot move '${sourceArg}' to '${destArg}': ${message}`);
      }
    }

    if (failures.length > 0) {
      throw new UnixCommandFailure(failures.join('\n'), 1, verbose ? results.join('\n') : '');
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
    const sourceFile = await this.getLinkAwareFile(source);

    if (!sourceFile) {
      throw new Error('Source file not found in database');
    }

    if (isDir !== (sourceFile.type === 'folder')) throw new Error('Source type changed');
    await this.fs.rename(source, dest);
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
