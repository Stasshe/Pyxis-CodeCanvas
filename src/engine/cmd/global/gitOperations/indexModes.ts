import git from 'isomorphic-git';
import type { GitFs } from '@/engine/core/fs/git';

export async function preserveIndexedModes(fs: GitFs, dir: string): Promise<GitFs> {
  const executablePaths = new Set<string>();
  await git.walk({
    fs,
    dir,
    trees: [git.STAGE()],
    map: async (path, [entry]) => {
      if (entry && (await entry.mode()) === 0o100755) executablePaths.add(`${dir}/${path}`);
    },
  });
  return {
    ...fs,
    promises: {
      ...fs.promises,
      lstat: async path => {
        const stat = await fs.promises.lstat(path);
        if (stat.isFile() && executablePaths.has(path)) return { ...stat, mode: 0o100755 };
        return stat;
      },
    },
  };
}
