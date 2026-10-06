import type { GitFs } from '@/engine/core/fs/git';

export class GitFileSystemHelper {
  static async getAllFiles(fs: GitFs, dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const traverse = async (path: string, prefix: string): Promise<void> => {
      const entries = await fs.promises.readdir(path);
      for (const entry of entries) {
        if (entry === '.git') continue;
        const relative = prefix + entry;
        const stat = await fs.promises.stat(`${path}/${entry}`);
        if (stat.isDirectory()) {
          await traverse(`${path}/${entry}`, `${relative}/`);
        } else {
          files.push(relative);
        }
      }
    };
    await traverse(dirPath, '');
    return files;
  }

  static async getMatchingFiles(fs: GitFs, dirPath: string, pattern: string): Promise<string[]> {
    const files = await GitFileSystemHelper.getAllFiles(fs, dirPath);
    if (pattern === '*') return files;
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    return files.filter(file => regex.test(file));
  }

  static async ensureDirectory(fs: GitFs, path: string): Promise<void> {
    await fs.promises.mkdir(path, { recursive: true });
  }
}
