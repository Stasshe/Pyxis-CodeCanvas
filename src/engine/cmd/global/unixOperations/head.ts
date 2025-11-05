import { UnixCommandBase } from './base';

export class HeadCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { positional } = this.parseOptions(args);
    if (positional.length === 0) {
      throw new Error('head: missing file operand');
    }
    const file = positional[0];
    const nArg = args.find(a => a.startsWith('-n')) || '-n10';
    const n = parseInt(nArg.replace('-n', '')) || 10;

    const path = this.normalizePath(this.resolvePath(file));
    const isDir = await this.isDirectory(path);
    if (isDir) throw new Error('Is a directory');

    try {
      const content = (await this.fs.promises.readFile(path, { encoding: 'utf8' })) as string;
      const lines = content.split(/\r?\n/);
      return lines.slice(0, n).join('\n');
    } catch (e) {
      throw new Error(`head: ${file}: No such file or directory`);
    }
  }
}
