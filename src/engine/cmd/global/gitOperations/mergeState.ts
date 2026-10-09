import type { GitFs } from '@/engine/core/fs/git';

export async function readMergeHead(fs: GitFs, dir: string): Promise<string | null> {
  try {
    return (await fs.promises.readFile(`${dir}/.git/MERGE_HEAD`, 'utf8')).trim();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function assertNoMergeInProgress(fs: GitFs, dir: string): Promise<void> {
  if (await readMergeHead(fs, dir)) {
    throw new Error('You have not concluded your merge (MERGE_HEAD exists).');
  }
}

export async function clearMergeState(fs: GitFs, dir: string): Promise<void> {
  for (const name of ['MERGE_MSG', 'MERGE_HEAD']) {
    try {
      await fs.promises.unlink(`${dir}/.git/${name}`);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
}
