import { UnixCommandBase } from './base';

import { fileRepository } from '@/engine/core/fileRepository';

/**
 * mkdir - ディレクトリを作成
 *
 * 使用法:
 *   mkdir [-p] [-v] directory...
 *
 * オプション:
 *   -p, --parents   必要に応じて親ディレクトリも作成、既存の場合もエラーなし
 *   -v, --verbose   詳細な情報を表示
 *
 * 動作:
 *   - 複数のディレクトリを一度に作成可能
 *   - -pオプションで親ディレクトリも自動作成
 */
export class MkdirCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (options.has('--help') || options.has('-h')) {
      return `Usage: mkdir [OPTION]... DIRECTORY...\n\nOptions:\n  -p, --parents\tcreate parent directories as needed\n  -m, --mode\tset file mode (not fully supported)`;
    }

    if (positional.length === 0) {
      throw new Error('mkdir: missing operand\nUsage: mkdir [OPTION]... DIRECTORY...');
    }

    const parents = options.has('-p') || options.has('--parents');
    const verbose = options.has('-v') || options.has('--verbose');

    const results: string[] = [];
    const errors: string[] = [];

    for (const dir of positional) {
      try {
        const result = await this.createDirectory(dir, parents, verbose);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        errors.push(`mkdir: cannot create directory '${dir}': ${(error as Error).message}`);
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
   * ディレクトリを作成
   */
  private async createDirectory(
    dir: string,
    parents: boolean,
    verbose: boolean
  ): Promise<string | null> {
    const normalizedPath = this.normalizePath(this.resolvePath(dir));
    const relativePath = this.getRelativePathFromProject(normalizedPath);

    // 既に存在するかチェック
    const exists = await this.exists(normalizedPath);

    if (exists) {
      if (parents) {
        // -pオプションがある場合は既存でもエラーなし
        return null;
      }
      throw new Error('File exists');
    }

    if (parents) {
      // 親ディレクトリも作成
      const parts = relativePath.split('/').filter(p => p);
      let currentPath = '';

      for (const part of parts) {
        currentPath += `/${part}`;
        const exists = await this.exists(
          this.normalizePath(`${this.getProjectRoot()}${currentPath}`)
        );

        if (!exists) {
          await fileRepository.createFile(this.projectId, currentPath, '', 'folder');
        }
      }
    } else {
      // 親ディレクトリの存在チェック
      const parentPath = relativePath.substring(0, relativePath.lastIndexOf('/')) || '/';
      if (parentPath !== '/') {
        const parentFullPath = this.normalizePath(`${this.getProjectRoot()}${parentPath}`);
        const parentExists = await this.exists(parentFullPath);

        if (!parentExists) {
          throw new Error('No such file or directory');
        }
      }

      await fileRepository.createFile(this.projectId, relativePath, '', 'folder');
    }

    if (verbose) {
      return `mkdir: created directory '${normalizedPath}'`;
    }

    return null;
  }
}
