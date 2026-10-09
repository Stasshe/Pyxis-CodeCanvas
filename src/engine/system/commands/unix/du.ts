import { posixPath } from '@/engine/core/fs/index';
import type { ProjectFile } from '@/types/index';
import { parseWithGetOpt } from '../../shell/lib/index';
import { UnixCommandBase } from './base';
import { displayPathForOperand } from './displayPath';

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
      const displayPath = displayPathForOperand(t, normalized, normalized);
      const metadata = await this.fs.lstat(normalized);
      const size = await this.sizeOfPath(normalized);
      if (summary) {
        lines.push(`${this.formatSize(size, human)}\t${displayPath}`);
      } else {
        const isDir = metadata.type === 'folder';
        if (!isDir) {
          lines.push(`${this.formatSize(size, human)}\t${displayPath}`);
        } else {
          const files = await this.getDescendants(normalized);
          const children = files.filter(f => posixPath.dirname(f.path) === normalized);

          for (const child of children) {
            const childPath = posixPath.join(normalized, posixPath.basename(child.path));
            const childDisplayPath = displayPathForOperand(t, normalized, childPath);
            const childSize = await this.sizeOfPath(childPath);
            lines.push(`${this.formatSize(childSize, human)}\t${childDisplayPath}`);
          }
          lines.push(`${this.formatSize(size, human)}\t${displayPath}`);
        }
      }
    }

    return lines.join('\n');
  }

  private async sizeOfPath(path: string): Promise<number> {
    if (path === '/') {
      const all = await this.getDescendants('/');
      return all.reduce((sum, file) => sum + this.entrySize(file), 0);
    }

    const file = await this.fs.lstat(path);
    if (file.type !== 'folder') return this.entrySize(file);

    // directory: sum of files under this prefix
    const files = await this.getDescendants(path);
    return files.reduce((sum, entry) => sum + this.entrySize(entry), 0);
  }

  private entrySize(file: ProjectFile): number {
    if (file.type === 'file') return file.size;
    return 0;
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
