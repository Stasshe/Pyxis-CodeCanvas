import type { FsApi } from '@/engine/core/fs/types';

export interface NpmFile {
  path: string;
  content: string;
}

export class NpmFiles {
  constructor(private readonly fs: FsApi) {}

  async getFile(path: string): Promise<NpmFile | undefined> {
    try {
      return { path, content: await this.fs.readText(path) };
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'EISDIR')
      )
        return undefined;
      throw error;
    }
  }

  async write(path: string, content: string): Promise<void> {
    await this.fs.writeFile(path, content);
  }
}
