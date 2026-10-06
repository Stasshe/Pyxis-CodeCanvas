import { getTestFs } from './testFs';

export interface TestFsFile {
  path: string;
  content: string;
}

function absolutePath(rootPath: string, path: string): string {
  if (rootPath === '/') return path;
  return `${rootPath}${path}`;
}

export const testFsFiles = {
  async createFile(rootPath: string, path: string, content: string, type: 'file' | 'folder') {
    const repo = getTestFs();
    const absolute = absolutePath(rootPath, path);
    if (type === 'folder') {
      await repo.mkdir(absolute, { recursive: true });
      return;
    }
    const parent = absolute.slice(0, absolute.lastIndexOf('/')) || '/';
    await repo.mkdir(parent, { recursive: true });
    await repo.writeFile(absolute, content);
  },

  async getFileByPath(rootPath: string, path: string): Promise<TestFsFile | null> {
    const repo = getTestFs();
    const absolute = absolutePath(rootPath, path);
    if (!(await repo.exists(absolute))) return null;
    const stat = await repo.stat(absolute);
    if (stat.type === 'folder') return { path, content: '' };
    return { path, content: await repo.readText(absolute) };
  },

  async getFilesByPrefix(rootPath: string, path: string): Promise<TestFsFile[]> {
    const repo = getTestFs();
    const absolute = absolutePath(rootPath, path);
    const entries = await repo.walk(absolute).catch(() => []);
    const files: TestFsFile[] = [];
    for (const entry of entries) {
      let relative = entry.path.slice(rootPath.length);
      if (!relative.startsWith('/')) relative = `/${relative}`;
      let content = '';
      if (entry.type === 'file') content = await repo.readText(entry.path);
      files.push({ path: relative, content });
    }
    return files;
  },
};
