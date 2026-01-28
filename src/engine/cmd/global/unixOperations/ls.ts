import { fnmatch, parseArgs } from '../../lib';
import { UnixCommandBase } from './base';
import { fsPathToAppPath, resolvePath as pathResolve, toFSPath } from '@/engine/core/pathUtils';

import type { ProjectFile } from '@/types';

/**
 * ls - ディレクトリの内容を表示 (POSIX/GNU準拠)
 *
 * 使用法:
 *   ls [options] [file...]
 *
 * オプション:
 *   -a, --all           .で始まるファイルも表示
 *   -A, --almost-all    . と .. 以外の隠しファイルを表示
 *   -l                  詳細情報を表示
 *   -h, --human-readable  サイズを人間が読みやすい形式で表示
 *   -R, --recursive     サブディレクトリも再帰的に表示
 *   -t                  更新時刻でソート
 *   -S                  サイズでソート
 *   -r, --reverse       逆順でソート
 *   -1                  1行1ファイル
 *   -d, --directory     ディレクトリ自体を表示
 *   -F, --classify      タイプ識別子を付加 (/, *, @)
 *   -p                  ディレクトリに / を付加
 *   --color             カラー出力（無視）
 *   -i, --inode         inode番号を表示（ダミー）
 *   -s, --size          ブロックサイズを表示
 */
export class LsCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { flags, positional } = parseArgs(args);

    // --help (do not override -h which is human-readable)
    if (flags.has('--help')) {
      return 'Usage: ls [options] [file...]\n\nOptions:\n  -a, --all\t\tshow hidden files\n  -l\t\tshow long listing format\n  -h, --human-readable\tprint sizes in human readable format\n  -R, --recursive\tlist subdirectories recursively\n  -r, --reverse\treverse order while sorting';
    }

    const showAll = flags.has('-a') || flags.has('--all');
    const almostAll = flags.has('-A') || flags.has('--almost-all');
    const longFormat = flags.has('-l');
    const humanReadable = flags.has('-h') || flags.has('--human-readable');
    const recursive = flags.has('-R') || flags.has('--recursive');
    const sortByTime = flags.has('-t');
    const sortBySize = flags.has('-S');
    const reverseSort = flags.has('-r') || flags.has('--reverse');
    const onePerLine = flags.has('-1');
    const dirOnly = flags.has('-d') || flags.has('--directory');
    const classify = flags.has('-F') || flags.has('--classify');
    const slashDir = flags.has('-p');
    const showInode = flags.has('-i') || flags.has('--inode');
    const showBlocks = flags.has('-s') || flags.has('--size');

    const targets = positional.length > 0 ? positional : ['.'];
    const results: string[] = [];

    for (const target of targets) {
      const expanded = await this.expandPathPattern(target);

      if (expanded.length === 0) {
        throw new Error(`ls: cannot access '${target}': No such file or directory`);
      }

      for (const path of expanded) {
        try {
          const result = await this.listPath(path, {
            showAll: showAll || almostAll,
            longFormat,
            humanReadable,
            recursive,
            sortByTime,
            sortBySize,
            reverseSort,
            onePerLine,
            dirOnly,
            classify,
            slashDir,
            showInode,
            showBlocks,
            showHeader: targets.length > 1 || expanded.length > 1 || recursive,
          });
          results.push(result);
        } catch (error) {
          throw new Error(`ls: cannot access '${path}': ${(error as Error).message}`);
        }
      }
    }

    return results.join('\n\n');
  }

  /**
   * パスの内容をリスト
   */
  private async listPath(
    path: string,
    opts: {
      showAll: boolean;
      longFormat: boolean;
      humanReadable: boolean;
      recursive: boolean;
      sortByTime: boolean;
      sortBySize: boolean;
      reverseSort: boolean;
      onePerLine: boolean;
      dirOnly: boolean;
      classify: boolean;
      slashDir: boolean;
      showInode: boolean;
      showBlocks: boolean;
      showHeader: boolean;
    }
  ): Promise<string> {
    const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
    const appPath = pathResolve(baseApp, path);
    const normalizedPath = toFSPath(this.projectName, appPath);
    const isDir = await this.isDirectory(normalizedPath);

    // -d: ディレクトリ自体を表示
    if (opts.dirOnly || !isDir) {
      if (opts.longFormat) {
        return await this.formatLongEntry(normalizedPath, opts);
      }
      const name = normalizedPath.split('/').pop() || normalizedPath;
      return this.formatName(name, isDir, opts);
    }

    // ディレクトリの場合
    const relativePath = appPath;
    const prefix = relativePath === '/' ? '' : `${relativePath}/`;
    const files: ProjectFile[] = await this.cachedGetFilesByPrefix(prefix);

    // ディレクトリ直下のファイル/フォルダを取得
    let entries = files.filter((f: ProjectFile) => {
      if (relativePath === '/') {
        return f.path.split('/').filter((p: string) => p).length === 1;
      }
      const childPath = f.path.replace(prefix, '');
      return f.path.startsWith(prefix) && !childPath.includes('/');
    });

    // 隠しファイルフィルタ
    if (!opts.showAll) {
      entries = entries.filter(f => {
        const name = f.path.split('/').pop() || '';
        return !name.startsWith('.');
      });
    }

    // ソート
    entries = this.sortEntries(entries, opts);

    let result = '';

    if (opts.showHeader) {
      result += `${normalizedPath}:\n`;
    }

    if (opts.longFormat) {
      const totalBlocks = entries.reduce((sum, e) => {
        const size = e.bufferContent?.byteLength || e.content?.length || 0;
        return sum + Math.ceil(size / 512);
      }, 0);
      result += `total ${totalBlocks}\n`;

      for (const entry of entries) {
        const fullPath = `${normalizedPath}/${entry.path.split('/').pop()}`;
        result += `${await this.formatLongEntry(fullPath, opts)}\n`;
      }
    } else {
      const names = entries.map(e => {
        const name = e.path.split('/').pop() || '';
        return this.formatName(name, e.type === 'folder', opts);
      });

      if (opts.onePerLine || names.some(n => n.length > 20)) {
        result += names.join('\n');
      } else {
        // 複数列表示
        result += this.formatColumns(names);
      }
    }

    // 再帰的表示
    if (opts.recursive) {
      for (const entry of entries) {
        if (entry.type === 'folder') {
          const fullPath = `${normalizedPath}/${entry.path.split('/').pop()}`;
          result += '\n\n';
          result += await this.listPath(fullPath, { ...opts, showHeader: true });
        }
      }
    }

    return result.trimEnd();
  }

  /**
   * エントリをソート
   */
  private sortEntries(
    entries: ProjectFile[],
    opts: {
      sortByTime: boolean;
      sortBySize: boolean;
      reverseSort: boolean;
    }
  ): ProjectFile[] {
    const sorted = [...entries];

    if (opts.sortByTime) {
      sorted.sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });
    } else if (opts.sortBySize) {
      sorted.sort((a, b) => {
        const sizeA = a.bufferContent?.byteLength || a.content?.length || 0;
        const sizeB = b.bufferContent?.byteLength || b.content?.length || 0;
        return sizeB - sizeA;
      });
    } else {
      sorted.sort((a, b) => {
        const nameA = a.path.split('/').pop() || '';
        const nameB = b.path.split('/').pop() || '';
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return nameA.localeCompare(nameB);
      });
    }

    if (opts.reverseSort) {
      sorted.reverse();
    }

    return sorted;
  }

  /**
   * 名前をフォーマット
   */
  private formatName(
    name: string,
    isDir: boolean,
    opts: {
      classify: boolean;
      slashDir: boolean;
    }
  ): string {
    let result = name;
    if (isDir && (opts.classify || opts.slashDir)) {
      result += '/';
    } else if (opts.classify) {
      // 実行可能ファイルには * を付ける（ここではスキップ）
    }
    return result;
  }

  /**
   * 複数列フォーマット
   */
  private formatColumns(names: string[]): string {
    if (names.length === 0) return '';
    const maxLen = Math.max(...names.map(n => n.length)) + 2;
    const cols = Math.max(1, Math.floor(80 / maxLen));
    const rows: string[] = [];

    for (let i = 0; i < names.length; i += cols) {
      const row = names
        .slice(i, i + cols)
        .map(n => n.padEnd(maxLen))
        .join('');
      rows.push(row.trimEnd());
    }

    return rows.join('\n');
  }

  /**
   * 詳細形式のエントリをフォーマット
   */
  private async formatLongEntry(
    path: string,
    opts: { humanReadable: boolean; showInode: boolean; showBlocks: boolean }
  ): Promise<string> {
    const relativePath = this.getRelativePathFromProject(path);
    const file = await this.getFileFromDB(relativePath);

    if (!file) {
      // ファイルがDBにない場合（存在確認済みの場合はディレクトリとして扱う）
      const name = path.split('/').pop() || '';
      return `drwxr-xr-x 1 user user        0 ${this.formatDate(new Date())} ${name}/`;
    }

    const type = file.type === 'folder' ? 'd' : '-';
    const perms = file.type === 'folder' ? 'rwxr-xr-x' : 'rw-r--r--';
    const size = file.bufferContent?.byteLength || file.content?.length || 0;
    const sizeStr = opts.humanReadable ? this.formatSize(size) : size.toString().padStart(8);
    const date = file.updatedAt ? new Date(file.updatedAt) : new Date();
    const name = file.path.split('/').pop() || '';

    let prefix = '';
    if (opts.showInode) {
      prefix += `${(Math.random() * 1000000).toFixed(0).padStart(8)} `;
    }
    if (opts.showBlocks) {
      prefix += `${Math.ceil(size / 512)
        .toString()
        .padStart(4)} `;
    }

    return `${prefix}${type}${perms} 1 user user ${sizeStr} ${this.formatDate(date)} ${name}${file.type === 'folder' ? '/' : ''}`;
  }

  /**
   * 日付をフォーマット
   */
  private formatDate(date: Date): string {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const now = new Date();
    const month = months[date.getMonth()];
    const day = date.getDate().toString().padStart(2);

    // 6ヶ月以内なら時刻、それ以外は年を表示
    if (now.getTime() - date.getTime() < 180 * 24 * 60 * 60 * 1000) {
      const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      return `${month} ${day} ${time}`;
    }
    return `${month} ${day}  ${date.getFullYear()}`;
  }

  /**
   * サイズを人間が読みやすい形式にフォーマット
   */
  private formatSize(bytes: number): string {
    const units = ['', 'K', 'M', 'G', 'T'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    if (unitIndex === 0) {
      return bytes.toString().padStart(8);
    }
    return `${size.toFixed(1)}${units[unitIndex]}`.padStart(8);
  }
}
