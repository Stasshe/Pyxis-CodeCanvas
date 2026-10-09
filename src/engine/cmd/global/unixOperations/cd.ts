import { parseWithGetOpt } from '../../lib';
import { UnixCommandBase } from './base';

/** Resolve the shell-expanded directory and update the current working directory. */
export class CdCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<{ newDir: string; message: string }> {
    const { positional } = parseWithGetOpt(args);

    let targetDir: string;

    if (positional.length === 0) {
      // The workspace root is the default home directory.
      targetDir = this.rootPath;
    } else {
      const dir = positional[0];
      targetDir = this.resolvePath(dir);
    }

    const exists = await this.exists(targetDir);
    if (!exists) {
      throw new Error(`cd: ${positional[0] || '~'}: No such file or directory`);
    }

    const isDir = await this.isDirectory(targetDir);
    if (!isDir) {
      throw new Error(`cd: ${positional[0]}: Not a directory`);
    }

    return {
      newDir: targetDir,
      message: '',
    };
  }
}
