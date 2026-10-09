import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { GitFs } from '@/engine/core/fs/git';
import { resolvePath } from '@/engine/core/paths';
import { rejectGitAuthentication, validateRemoteUrl } from './transport';

export interface CloneOptions {
  maxGitObjects?: number;
}

export interface CloneContext {
  fs: GitFs;
  dir: string;
}

export class GitCloneOperations {
  constructor(private context: CloneContext) {}

  private async removeContents(path: string): Promise<void> {
    const entries = await this.context.fs.promises.readdir(path);
    for (const entry of entries) {
      const child = resolvePath(path, entry);
      const stat = await this.context.fs.promises.lstat(child);
      if (stat.isDirectory()) {
        await this.removeContents(child);
        await this.context.fs.promises.rmdir(child);
      } else {
        await this.context.fs.promises.unlink(child);
      }
    }
  }

  async clone(url: string, targetDir?: string, options: CloneOptions = {}): Promise<string> {
    const { fs, dir } = this.context;
    validateRemoteUrl(url);
    const parsedUrl = new URL(url);
    const name = parsedUrl.pathname
      .replace(/\/$/, '')
      .split('/')
      .pop()
      ?.replace(/\.git$/, '');
    if (!name) throw new Error('Unable to determine repository name');
    const target = resolvePath(dir, targetDir || name);
    let targetExists = true;
    try {
      const entries = await fs.promises.readdir(target);
      if (entries.length > 0) throw new Error(`Destination '${target}' is not empty`);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        targetExists = false;
      } else {
        throw error;
      }
    }
    if (!targetExists) await fs.promises.mkdir(target, { recursive: true });
    try {
      await git.clone({
        fs,
        http,
        dir: target,
        url,
        depth: options.maxGitObjects ?? 10,
        singleBranch: true,
        corsProxy: 'https://cors.isomorphic-git.org',
        onAuth: rejectGitAuthentication,
      });
    } catch (error) {
      try {
        await this.removeContents(target);
        if (!targetExists) await fs.promises.rmdir(target);
      } catch {
        // Preserve the original clone error; cleanup is best-effort.
      }
      throw error;
    }
    return `Cloning into '${targetDir || name}'...\nClone completed successfully.`;
  }
}
