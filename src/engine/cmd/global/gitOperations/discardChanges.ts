import git from 'isomorphic-git';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';
import { GitFileSystemHelper } from './fileSystemHelper';

export async function discardChanges(fs: FS, dir: string, filepath: string): Promise<string> {
  const normalizedPath = repositoryPath(dir, filepath);
  const fullPath = `${dir}/${normalizedPath}`;
  let staged: { oid: string; mode: number } | undefined;
  await git.walk({
    fs,
    dir,
    trees: [git.STAGE()],
    map: async (path, [entry]) => {
      if (path === normalizedPath && entry) {
        const oid = await entry.oid();
        const mode = await entry.mode();
        if (oid && mode) staged = { oid, mode };
      }
    },
  });

  // Never traverse a worktree link while restoring another tracked path.
  let parentPath = dir;
  for (const part of normalizedPath.split('/').slice(0, -1)) {
    parentPath += `/${part}`;
    try {
      const stat = await fs.promises.lstat(parentPath);
      if (stat.isSymbolicLink())
        throw new Error(`Cannot discard through symlink directory: ${parentPath}`);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') break;
      throw error;
    }
  }

  let exists = false;
  let isLink = false;
  try {
    const stat = await fs.promises.lstat(fullPath);
    exists = true;
    isLink = stat.isSymbolicLink();
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }

  if (!staged) {
    if (!exists) return `File ${filepath} is already removed`;
    await fs.promises.unlink(fullPath);
    return `Removed untracked file ${filepath}`;
  }

  // Resolve the indexed object before altering the worktree. Missing objects must preserve files.
  const { blob } = await git.readBlob({ fs, dir, oid: staged.oid });
  let target: string | undefined;
  if (staged.mode === 0o120000) target = new TextDecoder('utf-8', { fatal: true }).decode(blob);
  const parent = fullPath.slice(0, fullPath.lastIndexOf('/'));
  await GitFileSystemHelper.ensureDirectory(fs, parent);
  if (exists && (isLink || target !== undefined)) await fs.promises.unlink(fullPath);
  if (target !== undefined) {
    await fs.promises.symlink(target, fullPath);
  } else {
    await fs.promises.writeFile(fullPath, blob);
  }
  if (!exists) return `Restored deleted file ${filepath}`;
  return `Discarded changes in ${filepath}`;
}
