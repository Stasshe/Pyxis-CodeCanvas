import { posixPath } from '@/engine/core/fs';
import { parseWithGetOpt } from '../../lib';
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
    const optstring = 'hs';
    const longopts = ['human-readable', 'help'];
    const { flags, positional, errors } = parseWithGetOpt(args, optstring, longopts);
    if (errors.length) throw new Error(errors.join('; '));

    if (flags.has('--help')) {
      return 'Usage: du [options] [file...]\nOptions:\n  -h, --human-readable\n  -s\tshow only a total for each argument';
    }

    const human = flags.has('-h') || flags.has('--human-readable');
    const summary = flags.has('-s');

    const targets = positional.length > 0 ? positional : ['.'];
    const lines: string[] = [];

    for (const t of targets) {
      const normalized = this.resolvePath(t);
      const size = await this.sizeOfPath(normalized);
      if (summary) {
        lines.push(`${this.formatSize(size, human)}\t${normalized}`);
      } else {
        const isDir = await this.isDirectory(normalized);
        if (!isDir) {
          lines.push(`${this.formatSize(size, human)}\t${normalized}`);
        } else {
          const files = await this.getDescendants(normalized);
          const children = files.filter(f => posixPath.dirname(f.path) === normalized);

          for (const child of children) {
            const childPath = posixPath.join(normalized, posixPath.basename(child.path));
            const childSize = await this.sizeOfPath(childPath);
            lines.push(`${this.formatSize(childSize, human)}\t${childPath}`);
          }
          lines.push(`${this.formatSize(size, human)}\t${normalized}`);
        }
      }
    }

    return lines.join('\n');
  }

  private async sizeOfPath(path: string): Promise<number> {
    if (path === '/') {
      const all = await this.getDescendants('/');
      return all.reduce((s, f) => s + (f.type === 'file' ? f.size : 0), 0);
    }

    const file = await this.getFile(path);
    if (file && file.type === 'file') {
      return file.size;
    }

    // directory: sum of files under this prefix
    const files = await this.getDescendants(path);
    return files.reduce((s, f) => s + (f.type === 'file' ? f.size : 0), 0);
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
