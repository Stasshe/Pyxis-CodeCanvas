import { resolvePath } from '@/engine/core/fs';
import type { FsApi } from '@/engine/core/fs/types';

export interface NpmFile {
  path: string;
  content: string;
}

export class NpmFiles {
  constructor(private readonly fs: FsApi) {}

  async getFile(path: string): Promise<NpmFile | undefined> {
    const absolute = path;
    try {
      const stat = await this.fs.stat(absolute);
      if (stat.type === 'folder') return undefined;
      return { path, content: await this.fs.readText(absolute) };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async getPackageFiles(path: string): Promise<NpmFile[]> {
    const entries = await this.fs.walk(path);
    const files: NpmFile[] = [];
    for (const entry of entries) {
      if (entry.type !== 'file' || !entry.path.endsWith('/package.json')) continue;
      files.push({
        path: entry.path,
        content: await this.fs.readText(entry.path),
      });
    }
    return files;
  }

  async write(path: string, content: string, type: 'file' | 'folder' = 'file'): Promise<void> {
    if (type === 'folder') await this.fs.mkdir(path, { recursive: true });
    else await this.fs.writeFile(path, content);
  }

  async remove(path: string): Promise<void> {
    await this.fs.rm(path, { recursive: true, force: true });
  }
}
