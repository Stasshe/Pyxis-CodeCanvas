import { UnixCommandBase } from './base';

import { fileRepository } from '@/engine/core/fileRepository';

/**
 * touch - ファイルのタイムスタンプを更新、または空ファイルを作成
 *
 * 使用法:
 *   touch [-c] file...
 *
 * オプション:
 *   -c, --no-create  ファイルが存在しない場合は作成しない
 *
 * 動作:
 *   - 複数のファイルを一度に作成/更新可能
 *   - ファイルが存在しない場合は空ファイルを作成
 *   - ファイルが存在する場合はタイムスタンプを更新
 */
export class TouchCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    if (positional.length === 0) {
      throw new Error('touch: missing file operand\nUsage: touch [OPTION]... FILE...');
    }

    const noCreate = options.has('-c') || options.has('--no-create');

    const errors: string[] = [];

    for (const file of positional) {
      try {
        await this.touchFile(file, noCreate);
      } catch (error) {
        errors.push(`touch: cannot touch '${file}': ${(error as Error).message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    return '';
  }

  /**
   * ファイルを作成または更新
   */
  private async touchFile(file: string, noCreate: boolean): Promise<void> {
    const normalizedPath = this.normalizePath(this.resolvePath(file));
    const relativePath = this.getRelativePathFromProject(normalizedPath);

    const existingFile = await this.getFileFromDB(relativePath);

    if (existingFile) {
      // ファイルが存在する場合はタイムスタンプを更新
      await fileRepository.saveFile({
        ...existingFile,
        updatedAt: new Date(),
      });
    } else {
      // ファイルが存在しない場合
      if (noCreate) {
        // -cオプションがある場合は作成しない
        return;
      }

      // 親ディレクトリの存在チェック
      const parentPath = relativePath.substring(0, relativePath.lastIndexOf('/')) || '/';
      if (parentPath !== '/') {
        const parentFullPath = this.normalizePath(`${this.getProjectRoot()}${parentPath}`);
        const parentExists = await this.exists(parentFullPath);

        if (!parentExists) {
          throw new Error('No such file or directory');
        }
      }

      // 空ファイルを作成
      await fileRepository.createFile(this.projectId, relativePath, '', 'file');
    }
  }
}
