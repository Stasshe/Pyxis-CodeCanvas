import { UnixCommandBase } from './base';
import { fileRepository } from '@/engine/core/fileRepository';
import type { ProjectFile } from '@/types';

/**
 * find - ファイルを検索
 *
 * 使用法:
 *   find [path...] [expression]
 *
 * オプション/式:
 *   -name pattern   ファイル名がパターンに一致
 *   -type f|d       ファイルタイプ（f=ファイル、d=ディレクトリ）
 *   -maxdepth N     最大検索深度
 *   -mindepth N     最小検索深度
 *
 * 動作:
 *   - IndexedDBから検索
 *   - デフォルトはカレントディレクトリ
 */
export class FindCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { positional } = this.parseOptions(args);

    // パスと式を分離
    const paths: string[] = [];
    let expressionStart = 0;

    for (let i = 0; i < positional.length; i++) {
      if (positional[i].startsWith('-')) {
        expressionStart = i;
        break;
      }
      paths.push(positional[i]);
    }

    if (paths.length === 0) {
      paths.push(this.currentDir);
    }

    const expressions = positional.slice(expressionStart);

    // 式を解析
    let namePattern: RegExp | null = null;
    let typeFilter: 'file' | 'folder' | null = null;
    let maxDepth = 999;
    let minDepth = 0;

    for (let i = 0; i < expressions.length; i++) {
      const expr = expressions[i];

      if (expr === '-name' && i + 1 < expressions.length) {
        const pattern = expressions[i + 1]
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        namePattern = new RegExp(`^${pattern}$`);
        i++;
      } else if (expr === '-type' && i + 1 < expressions.length) {
        const type = expressions[i + 1];
        if (type === 'f') {
          typeFilter = 'file';
        } else if (type === 'd') {
          typeFilter = 'folder';
        }
        i++;
      } else if (expr === '-maxdepth' && i + 1 < expressions.length) {
        maxDepth = parseInt(expressions[i + 1], 10) || 999;
        i++;
      } else if (expr === '-mindepth' && i + 1 < expressions.length) {
        minDepth = parseInt(expressions[i + 1], 10) || 0;
        i++;
      }
    }

    const results: string[] = [];

    for (const path of paths) {
      const normalizedPath = this.normalizePath(this.resolvePath(path));
      const found = await this.findFiles(
        normalizedPath,
        namePattern,
        typeFilter,
        maxDepth,
        minDepth
      );
      results.push(...found);
    }

    return results.join('\n');
  }

  /**
   * ファイルを検索
   */
  private async findFiles(
    startPath: string,
    namePattern: RegExp | null,
    typeFilter: 'file' | 'folder' | null,
    maxDepth: number,
    minDepth: number
  ): Promise<string[]> {
    const relativePath = this.getRelativePathFromProject(startPath);
    const results: string[] = [];

    // startPath自体が条件に一致するかチェック
    const startFile = await fileRepository.getFileByPath(this.projectId, relativePath);
    if (startFile) {
      const depth = 0;
      if (depth >= minDepth && depth <= maxDepth) {
        if (this.matchesFilter(startFile, namePattern, typeFilter)) {
          results.push(startPath);
        }
      }
    }

    // 子ファイルを検索（prefix で絞る）
    const prefix = relativePath === '/' ? '' : `${relativePath}/`;
    const files: ProjectFile[] = await fileRepository.getFilesByPrefix(this.projectId, prefix);

    for (const file of files) {
      // 深度計算
      const relativeToStart = file.path.replace(prefix, '');
      const depth = relativeToStart.split('/').filter(p => p).length;

      if (depth < minDepth || depth > maxDepth) continue;

      if (this.matchesFilter(file, namePattern, typeFilter)) {
        const normalizedStart = startPath.endsWith('/') ? startPath.slice(0, -1) : startPath;
        const fullPath = relativeToStart === '' ? normalizedStart : `${normalizedStart}/${relativeToStart}`;
        results.push(fullPath);
      }
    }

    return results;
  }

  /**
   * フィルタに一致するかチェック
   */
  private matchesFilter(
    file: any,
    namePattern: RegExp | null,
    typeFilter: 'file' | 'folder' | null
  ): boolean {
    if (typeFilter && file.type !== typeFilter) {
      return false;
    }

    if (namePattern) {
      const name = file.path.split('/').pop() || '';
      if (!namePattern.test(name)) {
        return false;
      }
    }

    return true;
  }
}
