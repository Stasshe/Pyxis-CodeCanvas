import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

export class StatCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { flags, positional, errors } = parseWithGetOpt(args, '', ['help']);
    if (errors.length) throw new Error(errors.join('; '));
    if (flags.has('--help') || flags.has('-h')) {
      return 'Usage: stat FILE\n\nDisplay file or file system status for each FILE.';
    }
    if (positional.length === 0) throw new Error('stat: missing file operand');

    const fileArg = positional[0];
    const path = this.resolvePath(fileArg);
    const file = await this.getFile(path);
    if (!file) throw new Error(`stat: cannot stat '${fileArg}': No such file or directory`);
    const modified = new Date(file.mtime).toISOString();
    const type = file.type === 'folder' ? 'directory' : 'file';
    const size = file.type === 'folder' ? '-' : file.size;
    return `  File: ${fileArg}\n  Size: ${size}\n  Modified: ${modified}\n  Type: ${type}`;
  }
}
