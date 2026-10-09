import { posixPath } from '@/engine/core/pathUtils';
import { UnixCommandBase } from './base';

export class DirnameCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    if (args.length === 0) throw new Error('dirname: missing operand');
    if (args[0] === '--help' || args[0] === '-h') {
      return 'Usage: dirname NAME...\n\nOutput each NAME with its last non-slash component and trailing slashes removed.';
    }

    const names = args[0] === '--' ? args.slice(1) : args;
    if (names.length === 0) throw new Error('dirname: missing operand');
    return `${names.map(name => posixPath.dirname(name)).join('\n')}\n`;
  }
}
