import { FNM_CASEFOLD, fnmatch, parseArgs } from '../../lib';
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
 *   -I pattern      パターンに一致するファイルを除外（パイプ区切り可）
 *   -P pattern      パターンに一致するファイルのみ表示
 *   -f              フルパスを表示
 *   --noreport      ファイル/ディレクトリ数を表示しない
 *
 * 動作:
 *   - IndexedDBから情報取得
 *   - デフォルトはカレントディレクトリ
 */
export class TreeCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    // オプションパース
    const { flags, values, positional } = parseArgs(args, ['-L', '-I', '-P']);

    // --help サポート
    if (flags.has('--help')) {
      return `Usage: tree [options] [directory]\n\nOptions:\n  -a\t\tshow all files including those starting with .\n  -d\t\tdirectories only\n  -L level\tmax display depth\n  -I pattern\texclude pattern (pipe-separated)\n  -P pattern\tinclude only files matching pattern\n  -f\t\tprint full path\n  --noreport\tdo not display file/directory count`;
    }

    const showAll = flags.has('-a');
    const dirsOnly = flags.has('-d');
    const fullPath = flags.has('-f');
    const noReport = flags.has('--noreport');

    const maxDepth = values.has('-L') ? Number.parseInt(values.get('-L')!, 10) || 999 : 999;

    // -I: 除外パターン（パイプ区切り対応）
    const ignorePatterns: string[] = [];
    if (values.has('-I')) {
      const pattern = values.get('-I')!;
      ignorePatterns.push(...pattern.split('|'));
    }

    // -P: 表示パターン
    let includePattern: string | null = null;
    if (values.has('-P')) {
      includePattern = values.get('-P')!;
    }

    const targetDir = positional.length > 0 ? positional[0] : '.';
    const resolvedPath = this.resolvePath(targetDir);
    const normalizedPath = this.normalizePath(resolvedPath);

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

    const buildTree = async (dirPath: string, prefix = '', depth = 0): Promise<string> => {
      if (depth > maxDepth) return '';

      const relativePath = this.getRelativePathFromProject(dirPath);
      const dirPrefix = relativePath === '/' ? '' : `${relativePath}/`;
      const files: ProjectFile[] = await this.cachedGetFilesByPrefix(dirPrefix);

      // ディレクトリ直下のファイル/フォルダを取得
      let entries = files.filter((f: ProjectFile) => {
        if (relativePath === '/') {
          return f.path.split('/').filter((p: string) => p).length === 1;
        }
        const childPath = f.path.replace(dirPrefix, '');
        return f.path.startsWith(dirPrefix) && !childPath.includes('/');
      });

      // フィルタリング: 隠しファイル
      if (!showAll) {
        entries = entries.filter(f => {
          const name = f.path.split('/').pop() || '';
          return !name.startsWith('.') && name !== '.git';
        });
      }

      // フィルタリング: ディレクトリのみ
      if (dirsOnly) {
        entries = entries.filter(f => f.type === 'folder');
      }

      // フィルタリング: -I 除外パターン（fnmatch使用）
      if (ignorePatterns.length > 0) {
        entries = entries.filter(f => {
          const name = f.path.split('/').pop() || '';
          return !ignorePatterns.some(pat => fnmatch(pat, name) === 0);
        });
      }

      // フィルタリング: -P 表示パターン
      if (includePattern) {
        entries = entries.filter(f => {
          const name = f.path.split('/').pop() || '';
          // ディレクトリは常に表示（中身を見るため）
          if (f.type === 'folder') return true;
          return fnmatch(includePattern!, name) === 0;
        });
      }

      // ソート: ディレクトリ優先、名前順
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

        const displayName = fullPath ? `${dirPath}/${name}` : name;
        result += `${prefix}${connector}${displayName}${entry.type === 'folder' ? '/' : ''}\n`;

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

    let result = `${fullPath ? normalizedPath : targetDir}\n`;
    result += await buildTree(normalizedPath);

    if (!noReport) {
      result += `\n${dirCount} ${dirsOnly ? 'directories' : `directories, ${fileCount} files`}`;
    }

    return result;
  }
}
