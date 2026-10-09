import { UnixCommandBase } from './base';

export class DfCommand extends UnixCommandBase {
  async execute(args: string[] = []): Promise<string> {
    if (args.length > 0) throw new Error('df: options and operands are not supported');
    const totalBytes = 1024 * 1024 * 1024;
    const files = await this.getDescendants('/');
    const used = files.reduce((sum, file) => sum + (file.type === 'file' ? file.size : 0), 0);
    const available = Math.max(0, totalBytes - used);
    const toK = (bytes: number) =>
      Math.ceil(bytes / 1024)
        .toString()
        .padStart(10);
    return [
      'Filesystem     1K-blocks     Used Available Use% Mounted on',
      `pyxis:${toK(totalBytes)}${toK(used)}${toK(available)} ${(Math.round((used / totalBytes) * 100) || 0).toString().padStart(4)}% /`,
    ].join('\n');
  }
}
