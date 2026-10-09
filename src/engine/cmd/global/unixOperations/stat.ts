import { FSError } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';
import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase, UnixCommandFailure } from './base';

export class StatCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { flags, positional, errors: parseErrors } = parseWithGetOpt(args, '', ['help']);
    if (parseErrors.length) throw new Error(parseErrors.join('; '));
    if (flags.has('--help') || flags.has('-h')) {
      return 'Usage: stat FILE\n\nDisplay file or file system status for each FILE.';
    }
    if (positional.length === 0) throw new Error('stat: missing file operand');

    const results: string[] = [];
    const errors: string[] = [];
    for (const fileArg of positional) {
      const file = await this.getLinkAwareFile(this.resolvePath(fileArg));
      if (!file) {
        errors.push(`stat: cannot stat '${fileArg}': No such file or directory`);
        continue;
      }
      const modified = new Date(file.mtime).toISOString();
      let type: string = file.type;
      let size: string | number = file.size;
      if (file.type === 'folder') {
        type = 'directory';
        size = '-';
      }
      results.push(`  File: ${fileArg}\n  Size: ${size}\n  Modified: ${modified}\n  Type: ${type}`);
    }
    if (errors.length > 0) {
      throw new UnixCommandFailure(errors.join('\n'), 1, results.join('\n\n'));
    }
    return results.join('\n\n');
  }

  private async getLinkAwareFile(path: string): Promise<ProjectFile | undefined> {
    try {
      return await this.fs.lstat(path);
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
}
