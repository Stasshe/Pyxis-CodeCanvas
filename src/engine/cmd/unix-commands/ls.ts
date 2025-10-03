import { UnixCommandBase } from './base';

/**
 * ls - ディレクトリの内容を表示
 * 
 * 使用法:
 *   ls [options] [file...]
 * 
 * オプション:
 *   -a, --all        .で始まるファイルも表示
 *   -l               詳細情報を表示
 *   -h, --human-readable  サイズを人間が読みやすい形式で表示（-lと併用）
 *   -R, --recursive  サブディレクトリも再帰的に表示
 *   -t               更新時刻でソート
 *   -r, --reverse    逆順でソート
 * 
 * 動作:
 *   - デフォルトはカレントディレクトリ
 *   - ワイルドカード対応
 *   - IndexedDBから情報取得、存在確認はlightning-fs
 */
export class LsCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { options, positional } = this.parseOptions(args);

    const showAll = options.has('-a') || options.has('--all');
    const longFormat = options.has('-l');
    const humanReadable = options.has('-h') || options.has('--human-readable');
    const recursive = options.has('-R') || options.has('--recursive');
    const sortByTime = options.has('-t');
    const reverseSort = options.has('-r') || options.has('--reverse');

    const targets = positional.length > 0 ? positional : [this.currentDir];
    const results: string[] = [];

    for (const target of targets) {
      const expanded = await this.expandPathPattern(target);
      
      if (expanded.length === 0) {
        throw new Error(`ls: cannot access '${target}': No such file or directory`);
      }

      for (const path of expanded) {
        try {
          const result = await this.listPath(
            path,
            showAll,
            longFormat,
            humanReadable,
            recursive,
            sortByTime,
            reverseSort,
            targets.length > 1 || expanded.length > 1
          );
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
    showAll: boolean,
    longFormat: boolean,
    humanReadable: boolean,
    recursive: boolean,
    sortByTime: boolean,
    reverseSort: boolean,
    showHeader: boolean
  ): Promise<string> {
    const normalizedPath = this.normalizePath(path);
    const isDir = await this.isDirectory(normalizedPath);

    if (!isDir) {
      // ファイルの場合
      if (longFormat) {
        return await this.formatLongEntry(normalizedPath, humanReadable);
      }
      return normalizedPath;
    }

    // ディレクトリの場合
    const relativePath = this.getRelativePathFromProject(normalizedPath);
    const files = await this.getAllFilesFromDB();
    
    // ディレクトリ直下のファイル/フォルダを取得
    let entries = files.filter(f => {
      if (relativePath === '/') {
        return f.path.split('/').filter(p => p).length === 1;
      } else {
        const childPath = f.path.replace(relativePath + '/', '');
        return f.path.startsWith(relativePath + '/') && !childPath.includes('/');
      }
    });

    // .git等のフィルタリング
    if (!showAll) {
      entries = entries.filter(f => {
        const name = f.path.split('/').pop() || '';
        return !name.startsWith('.') && name !== '.git';
      });
    }

    // ソート
    if (sortByTime) {
      entries.sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });
    } else {
      entries.sort((a, b) => {
        const nameA = a.path.split('/').pop() || '';
        const nameB = b.path.split('/').pop() || '';
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return nameA.localeCompare(nameB);
      });
    }

    if (reverseSort) {
      entries.reverse();
    }

    let result = '';
    
    if (showHeader) {
      result += `${normalizedPath}:\n`;
    }

    if (longFormat) {
      result += `total ${entries.length}\n`;
      for (const entry of entries) {
        const fullPath = `${normalizedPath}/${entry.path.split('/').pop()}`;
        result += await this.formatLongEntry(fullPath, humanReadable) + '\n';
      }
    } else {
      result += entries
        .map(e => {
          const name = e.path.split('/').pop() || '';
          return e.type === 'folder' ? `${name}/` : name;
        })
        .join('\n');
    }

    // 再帰的表示
    if (recursive) {
      for (const entry of entries) {
        if (entry.type === 'folder') {
          const fullPath = `${normalizedPath}/${entry.path.split('/').pop()}`;
          result += '\n\n';
          result += await this.listPath(
            fullPath,
            showAll,
            longFormat,
            humanReadable,
            recursive,
            sortByTime,
            reverseSort,
            true
          );
        }
      }
    }

    return result;
  }

  /**
   * 詳細形式のエントリをフォーマット
   */
  private async formatLongEntry(path: string, humanReadable: boolean): Promise<string> {
    const relativePath = this.getRelativePathFromProject(path);
    const file = await this.getFileFromDB(relativePath);
    
    if (!file) {
      return '';
    }

    const type = file.type === 'folder' ? 'd' : '-';
    const perms = 'rw-r--r--';
    const size = file.bufferContent ? file.bufferContent.byteLength : (file.content?.length || 0);
    const sizeStr = humanReadable ? this.formatSize(size) : size.toString().padStart(8);
    const date = file.updatedAt ? new Date(file.updatedAt) : new Date();
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const name = file.path.split('/').pop() || '';

    return `${type}${perms} 1 user user ${sizeStr} ${dateStr} ${timeStr} ${name}${file.type === 'folder' ? '/' : ''}`;
  }

  /**
   * サイズを人間が読みやすい形式にフォーマット
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'K', 'M', 'G', 'T'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)}${units[unitIndex]}`.padStart(8);
  }
}
