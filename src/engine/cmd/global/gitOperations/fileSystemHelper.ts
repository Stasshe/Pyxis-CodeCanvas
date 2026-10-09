import git from 'isomorphic-git';
import type { GitFs } from '@/engine/core/fs/git';

export class GitFileSystemHelper {
  static async getAllFiles(
    fs: GitFs,
    dirPath: string,
    repositoryDir = dirPath,
    repositoryPath = ''
  ): Promise<string[]> {
    const files: string[] = [];
    const traverse = async (path: string, prefix: string, gitPath: string): Promise<void> => {
      const entries = await fs.promises.readdir(path);
      for (const entry of entries) {
        if (entry === '.git') continue;
        const relative = prefix + entry;
        const childGitPath = gitPath ? `${gitPath}/${entry}` : entry;
        const stat = await fs.promises.lstat(`${path}/${entry}`);
        let ignorePath = childGitPath;
        if (stat.isDirectory()) ignorePath += '/';
        if (await git.isIgnored({ fs, dir: repositoryDir, filepath: ignorePath })) continue;
        if (stat.isDirectory()) {
          await traverse(`${path}/${entry}`, `${relative}/`, childGitPath);
        } else {
          files.push(relative);
        }
      }
    };
    await traverse(dirPath, '', repositoryPath);
    return files;
  }

  static async getMatchingFiles(fs: GitFs, dirPath: string, pattern: string): Promise<string[]> {
    const files = await GitFileSystemHelper.getAllFiles(fs, dirPath);
    return files.filter(file => GitFileSystemHelper.matchesPattern(file, pattern));
  }

  static matchesPattern(filepath: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const expression = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${expression}$`).test(filepath);
  }

  static async ensureDirectory(fs: GitFs, path: string): Promise<void> {
    await fs.promises.mkdir(path, { recursive: true });
  }
}
