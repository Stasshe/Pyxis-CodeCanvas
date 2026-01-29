import { parseArgs } from '../../lib';
import { UnixCommandBase } from './base';

export class SortCommand extends UnixCommandBase {
  private stdinContent: string | null = null;

  setStdin(content: string): void {
    this.stdinContent = content;
  }

  async execute(args: string[] = []): Promise<string> {
    const { flags, positional } = parseArgs(args);

    if (flags.has('--help')) {
      return `Usage: sort [options] [file...]
Options:
  -r	reverse
  -n	numeric
  -u	unique`;
    }

    const reverse = flags.has('-r');
    const numeric = flags.has('-n');
    const unique = flags.has('-u');

    let lines: string[] = [];

    if (positional.length === 0) {
      if (this.stdinContent !== null) {
        lines = this.stdinContent.split(/\r?\n/);
      } else {
        return '';
      }
    } else {
      for (const p of positional) {
        const resolved = this.normalizePath(this.resolvePath(p));
        const rel = this.getRelativePathFromProject(resolved);
        const file = await this.getFileFromDB(rel);
        if (!file) throw new Error(`sort: ${p}: No such file or directory`);
        if (file.type === 'folder') throw new Error(`sort: ${p}: Is a directory`);
        const content = file.content || '';
        lines = lines.concat(content.split(/\r?\n/));
      }
    }

    // Remove the possible trailing empty line caused by split
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const cmp = (a: string, b: string) => {
      if (numeric) {
        const na = Number.parseFloat(a) || 0;
        const nb = Number.parseFloat(b) || 0;
        return na - nb;
      }
      return a.localeCompare(b);
    };

    lines.sort(cmp);
    if (reverse) lines.reverse();
    if (unique) lines = Array.from(new Set(lines));

    return lines.join('\n');
  }
}
