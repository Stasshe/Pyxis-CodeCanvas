import { UnixCommandBase } from './base';

import type { ProjectFile } from '@/types';

/**
 * tree - ディレクトリ構造をツリー形式で表示
 *
 * 使用法:
 *   tree [options] [directory]
 *
 * オプション:
 *   -a              .で始まるファイルも表示
 *   -d              ディレクトリのみ表示
 *   -L level        表示する深さを指定
 *   -I pattern      パターンに一致するファイルを除外
 *
 * 動作:
 *   - IndexedDBから情報取得
 *   - デフォルトはカレントディレクトリ
 */
export class TreeCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    const showAll = options.has('-a');
    const dirsOnly = options.has('-d');

    let maxDepth = 999;
    if (options.has('-L')) {
      const levelIndex = args.indexOf('-L');
      if (levelIndex >= 0 && levelIndex + 1 < args.length) {
        maxDepth = parseInt(args[levelIndex + 1], 10) || 999;
      }
    }

    let ignorePattern: RegExp | null = null;
    if (options.has('-I')) {
      const patternIndex = args.indexOf('-I');
      if (patternIndex >= 0 && patternIndex + 1 < args.length) {
        const pattern = args[patternIndex + 1];
        ignorePattern = new RegExp(pattern.replace(/\*/g, '.*'));
      }
    }

    const targetDir = positional.length > 0 ? positional[0] : '.';
    const resolvedPath = this.resolvePath(targetDir);
    const normalizedPath = this.normalizePath(resolvedPath);

    // ディレクトリの存在確認（IndexedDBベース）
    const exists = await this.exists(normalizedPath);
    if (!exists) {
      throw new Error(`tree: ${targetDir}: No such file or directory`);
    }

    const isDir = await this.isDirectory(normalizedPath);
    if (!isDir) {
      return normalizedPath;
    }

    let dirCount = 0;
    let fileCount = 0;

    const buildTree = async (
      dirPath: string,
      prefix: string = '',
      depth: number = 0
    ): Promise<string> => {
      if (depth > maxDepth) return '';

      const relativePath = this.getRelativePathFromProject(dirPath);
      const dirPrefix = relativePath === '/' ? '' : `${relativePath}/`;
      const files: ProjectFile[] = await this.cachedGetFilesByPrefix(dirPrefix);

      // ディレクトリ直下のファイル/フォルダを取得
      let entries = files.filter((f: ProjectFile) => {
        if (relativePath === '/') {
          return f.path.split('/').filter((p: string) => p).length === 1;
        } else {
          const childPath = f.path.replace(dirPrefix, '');
          return f.path.startsWith(dirPrefix) && !childPath.includes('/');
        }
      });

      // フィルタリング
      if (!showAll) {
        entries = entries.filter(f => {
          const name = f.path.split('/').pop() || '';
          return !name.startsWith('.') && name !== '.git';
        });
      }

      if (dirsOnly) {
        entries = entries.filter(f => f.type === 'folder');
      }

      if (ignorePattern) {
        entries = entries.filter(f => {
          const name = f.path.split('/').pop() || '';
          return !ignorePattern!.test(name);
        });
      }

      // ソート
      entries.sort((a, b) => {
        const nameA = a.path.split('/').pop() || '';
        const nameB = b.path.split('/').pop() || '';
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return nameA.localeCompare(nameB);
      });

      let result = '';
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        const name = entry.path.split('/').pop() || '';

        result += `${prefix}${connector}${name}${entry.type === 'folder' ? '/' : ''}\n`;

        if (entry.type === 'folder') {
          dirCount++;
          const childPath = `${dirPath}/${name}`;
          result += await buildTree(childPath, newPrefix, depth + 1);
        } else {
          fileCount++;
        }
      }

      return result;
    };

    let result = `${normalizedPath}\n`;
    result += await buildTree(normalizedPath);
    result += `\n${dirCount} ${dirsOnly ? 'directories' : `directories, ${fileCount} files`}`;

    return result;
  }
}
