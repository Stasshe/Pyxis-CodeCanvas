import { FSError, isPathWithin, posixPath } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase, UnixCommandFailure } from './base';

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
      return 'Usage: cp [OPTION]... SOURCE DEST\n   or: cp [OPTION]... SOURCE... DIRECTORY\n\nOptions:\n  -r, -R, --recursive\tcopy directories recursively\n  -f, --force\toverwrite existing files without prompting\n  -i, --interactive\tunsupported; fails before copying\n  -n, --no-clobber\tdo not overwrite an existing file\n  -v, --verbose\t\texplain what is being done';
    }

    if (options.has('-i') || options.has('--interactive')) {
      throw new UnixCommandFailure('cp: interactive confirmation is not supported', 1);
    }

    if (positional.length < 2) {
      throw new Error(
        'cp: missing file operand\nUsage: cp [OPTION]... SOURCE DEST\n   or: cp [OPTION]... SOURCE... DIRECTORY'
      );
    }

    const recursive = options.has('-r') || options.has('-R') || options.has('--recursive');
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

    const failures: string[] = [];

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = sources[sourceIndex];
      const sourceArg = sourceArgs[sourceIndex];
      const normalizedSource = source;

      const sourceFile = await this.getLinkAwareFile(normalizedSource);
      if (!sourceFile) {
        failures.push(`cp: cannot stat '${sourceArg}': No such file or directory`);
        continue;
      }

      const isSymlink = sourceFile.type === 'symlink';
      const preserveSymlink = isSymlink && recursive;
      const sourceTargetExists = await this.exists(normalizedSource);
      if (isSymlink && !recursive && !sourceTargetExists) {
        failures.push(`cp: cannot stat '${sourceArg}': No such file or directory`);
        continue;
      }
      let sourceIsDir = sourceFile.type === 'folder';
      if (isSymlink && !recursive) {
        sourceIsDir = await this.isDirectory(normalizedSource);
      }

      // ディレクトリコピーには-rオプションが必要
      if (sourceIsDir && !recursive) {
        failures.push(`cp: -r not specified; omitting directory '${sourceArg}'`);
        continue;
      }

      const sourceName = posixPath.basename(normalizedSource);

      // 最終的なコピー先パス
      let finalDest = dest;
      if (destIsDir) {
        finalDest = posixPath.join(dest, sourceName);
      }

      if (normalizedSource === finalDest) {
        failures.push(`cp: '${sourceArg}' and '${destArg}' are the same file`);
        continue;
      }
      if (sourceIsDir && isPathWithin(finalDest, normalizedSource)) {
        failures.push(`cp: cannot copy a directory '${sourceArg}' into itself '${destArg}'`);
        continue;
      }

      // 上書きチェック
      const finalDestFile = await this.getLinkAwareFile(finalDest);
      const finalDestExists = finalDestFile !== undefined;
      if (finalDestExists) {
        const sourceCopiesDirectory = sourceIsDir && !preserveSymlink;
        if (sourceCopiesDirectory !== (finalDestFile.type === 'folder')) {
          if (sourceIsDir) {
            failures.push(
              `cp: cannot overwrite non-directory '${destArg}' with directory '${sourceArg}'`
            );
          } else {
            failures.push(`cp: cannot overwrite directory '${destArg}' with non-directory`);
          }
          continue;
        }
        if (noClobber) {
          continue; // スキップ
        }
      }

      // コピー実行
      try {
        await this.copyFileOrDir(
          normalizedSource,
          finalDest,
          sourceIsDir,
          recursive,
          preserveSymlink
        );

        if (verbose) {
          results.push(`'${normalizedSource}' -> '${finalDest}'`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`cp: cannot copy '${sourceArg}' to '${destArg}': ${message}`);
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
   * ファイルまたはディレクトリをコピー
   */
  private async copyFileOrDir(
    source: string,
    dest: string,
    isDir: boolean,
    recursive: boolean,
    preserveSymlink: boolean
  ): Promise<void> {
    if (preserveSymlink) {
      const target = await this.fs.readlink(source);
      await this.fs.rm(dest, { recursive: true, force: true });
      await this.fs.symlink(target, dest);
      return;
    }

    const sourceFile = await this.getFile(source);

    if (!sourceFile) {
      throw new Error('Source file not found in database');
    }

    if (isDir && recursive) {
      // ディレクトリの場合、中身も再帰的にコピー
      const childFiles = await this.fs.walk(source);

      // 新しい場所にディレクトリを作成
      await this.fs.mkdir(dest, { recursive: true });

      // 子ファイルをコピー
      for (const child of childFiles) {
        const relativePath = posixPath.relative(source, child.path);
        const newChildPath = posixPath.join(dest, relativePath);
        if (child.type === 'folder') await this.fs.mkdir(newChildPath, { recursive: true });
        else if (child.type === 'symlink') {
          const existing = await this.getLinkAwareFile(newChildPath);
          if (existing?.type === 'folder') {
            throw new Error(`cannot overwrite directory '${newChildPath}' with non-directory`);
          }
          if (existing) await this.fs.rm(newChildPath, { force: true });
          await this.fs.symlink(await this.fs.readlink(child.path), newChildPath);
        } else {
          await this.fs.writeFile(newChildPath, await this.fs.readFile(child.path));
        }
      }
    } else {
      // ファイルの場合
      if (sourceFile.type === 'folder') await this.fs.mkdir(dest, { recursive: true });
      else await this.fs.writeFile(dest, await this.fs.readFile(source));
    }
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
