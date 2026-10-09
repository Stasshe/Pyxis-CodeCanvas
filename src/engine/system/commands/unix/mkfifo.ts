import { fsClient, getFifoApi } from '@/engine/core/fs/index';
import { UnixCommandBase } from './base';

export class MkfifoCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    if (args.length === 0) throw new Error('mkfifo: missing operand\nUsage: mkfifo NAME...');

    const fifoApi = getFifoApi(fsClient);
    if (!fifoApi) throw new Error('mkfifo: FIFO support is unavailable');

    const errors: string[] = [];
    for (const name of args) {
      try {
        await fifoApi.mkfifo(this.resolvePath(name));
      } catch (error) {
        errors.push(`mkfifo: cannot create fifo '${name}': ${String(error)}`);
      }
    }
    if (errors.length > 0) throw new Error(errors.join('\n'));
    return '';
  }
}
