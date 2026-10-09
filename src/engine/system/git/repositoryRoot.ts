import type { FsApi } from '@/engine/core/fs/index';
import { getParentPath, normalizePath, resolvePath } from '@/engine/core/paths';

export async function findGitRepositoryRoot(cwd: string, fsClient: FsApi): Promise<string | null> {
  let directory = normalizePath(cwd);
  while (true) {
    try {
      await fsClient.stat(resolvePath(directory, '.git'));
      return directory;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    if (directory === '/') return null;
    directory = getParentPath(directory);
  }
}
