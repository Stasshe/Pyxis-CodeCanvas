import { parseArgs } from '../../lib';
import { UnixCommandBase } from './base';

/**
 * du - ディスク使用量を表示（簡易）
 * Usage: du [options] [file...]
 * Options:
 *   -h, --human-readable
 *   -s    summary (only total per arg)
 */
export class DuCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    const { flags, positional } = parseArgs(args);

    if (flags.has('--help')) {
      return `Usage: du [options] [file...]\nOptions:\n  -h, --human-readable\n  -s\tshow only a total for each argument`;
    }

    const human = flags.has('-h') || flags.has('--human-readable');
    const summary = flags.has('-s');

    const targets = positional.length > 0 ? positional : ['.'];
    const lines: string[] = [];

    for (const t of targets) {
      const expanded = await this.expandPathPattern(t);
      if (expanded.length === 0) {
        throw new Error(`du: cannot access '${t}': No such file or directory`);
      }

      for (const p of expanded) {
        const normalized = this.normalizePath(this.resolvePath(p));
        const size = await this.sizeOfPath(normalized);
        if (summary) {
          lines.push(`${this.formatSize(size, human)}\t${normalized}`);
        } else {
          // For directories, show each entry under it
          const isDir = await this.isDirectory(normalized);
          if (!isDir) {
            lines.push(`${this.formatSize(size, human)}\t${normalized}`);
          } else {
            // list children and their sizes
            const rel = this.getRelativePathFromProject(normalized);
            const prefix = rel === '/' ? '' : `${rel}/`;
            const files = await this.cachedGetFilesByPrefix(prefix);
            const children = files.filter(f => {
              if (rel === '/') {
                return f.path.split('/').filter(p => p).length === 1;
              }
              const childRel = f.path.replace(prefix, '');
              return f.path.startsWith(prefix) && !childRel.includes('/');
            });

            for (const c of children) {
              const childFull = `${normalized}/${c.path.split('/').pop()}`;
              const childSize = await this.sizeOfPath(childFull);
              lines.push(`${this.formatSize(childSize, human)}\t${childFull}`);
            }
            // then the total
            lines.push(`${this.formatSize(size, human)}\t${normalized}`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  private async sizeOfPath(path: string): Promise<number> {
    const normalized = this.normalizePath(this.resolvePath(path));
    const relPath = this.getRelativePathFromProject(normalized);

    // if root
    if (relPath === '/' || relPath === '') {
      const all = await this.cachedGetFilesByPrefix('');
      return all.reduce((s, f) => s + (f.bufferContent?.byteLength || f.content?.length || 0), 0);
    }

    const file = await this.getFileFromDB(relPath);
    if (file && file.type === 'file') {
      return file.bufferContent ? file.bufferContent.byteLength : file.content?.length || 0;
    }

    // directory: sum of files under this prefix
    const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
    const files = await this.cachedGetFilesByPrefix(prefix);
    return files.reduce((s, f) => s + (f.bufferContent?.byteLength || f.content?.length || 0), 0);
  }

  private formatSize(bytes: number, human: boolean): string {
    if (!human) {
      // du shows size in 1K blocks usually; approximate by rounding up
      return Math.ceil(bytes / 1024).toString();
    }
    const units = ['K', 'M', 'G', 'T'];
    let size = bytes;
    let idx = -1;
    while (size >= 1024 && idx < units.length - 1) {
      size = size / 1024;
      idx++;
    }
    if (idx === -1) return `${bytes}B`;
    return `${size.toFixed(1)}${units[idx]}`;
  }
}
