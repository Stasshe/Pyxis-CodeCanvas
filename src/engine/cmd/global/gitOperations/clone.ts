import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { GitFs } from '@/engine/core/fs/git';
import { resolvePath } from '@/engine/core/pathUtils';

export interface CloneOptions {
  skipDotGit?: boolean;
  maxGitObjects?: number;
}

export interface CloneContext {
  fs: GitFs;
  dir: string;
}

export class GitCloneOperations {
  constructor(private context: CloneContext) {}

  async clone(url: string, targetDir?: string, options: CloneOptions = {}): Promise<string> {
    const { fs, dir } = this.context;
    const name = url
      .replace(/\/$/, '')
      .split('/')
      .pop()
      ?.replace(/\.git$/, '');
    if (!name) throw new Error('Unable to determine repository name');
    const target = resolvePath(dir, targetDir || name);
    try {
      const entries = await fs.promises.readdir(target);
      if (entries.length > 0) throw new Error(`Destination '${target}' is not empty`);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    await fs.promises.mkdir(target, { recursive: true });
    await git.clone({
      fs,
      http,
      dir: target,
      url,
      depth: options.maxGitObjects ?? 10,
      singleBranch: true,
      corsProxy: 'https://cors.isomorphic-git.org',
      onAuth: async () => {
        const credentials = await fs.credentials();
        if (credentials) return credentials;
        return {};
      },
    });
    if (options.skipDotGit) await this.removeDirectory(`${target}/.git`);
    return `Cloning into '${targetDir || name}'...\nClone completed successfully.`;
  }

  private async removeDirectory(path: string): Promise<void> {
    const fs = this.context.fs;
    const entries = await fs.promises.readdir(path);
    for (const entry of entries) {
      const child = `${path}/${entry}`;
      const stat = await fs.promises.stat(child);
      if (stat.isDirectory()) await this.removeDirectory(child);
      else await fs.promises.unlink(child);
    }
    await fs.promises.rmdir(path);
  }
}
