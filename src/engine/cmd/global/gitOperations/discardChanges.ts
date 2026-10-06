import git from 'isomorphic-git';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';
import { GitFileSystemHelper } from './fileSystemHelper';

export async function discardChanges(fs: FS, dir: string, filepath: string): Promise<string> {
  try {
    const normalizedPath = repositoryPath(dir, filepath);

    const commits = await git.log({ fs, dir, depth: 1 });
    if (commits.length === 0) {
      throw new Error('No commits found. Cannot discard changes.');
    }

    const headCommit = commits[0];

    let fileExists = false;
    try {
      await fs.promises.stat(`${dir}/${normalizedPath}`);
      fileExists = true;
    } catch {
      fileExists = false;
    }

    try {
      const { blob } = await git.readBlob({
        fs,
        dir,
        oid: headCommit.oid,
        filepath: normalizedPath,
      });

      const parentDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
      if (parentDir) {
        const fullParentPath = `${dir}/${parentDir}`;
        await GitFileSystemHelper.ensureDirectory(fs, fullParentPath);
      }

      await fs.promises.writeFile(`${dir}/${normalizedPath}`, blob);

      if (!fileExists) {
        return `Restored deleted file ${filepath}`;
      }
      return `Discarded changes in ${filepath}`;
    } catch (readError) {
      const err = readError as Error;

      const notFoundInHead =
        err.message.includes('not found') ||
        err.message.includes('Could not find file') ||
        (headCommit &&
          err.message.includes(headCommit.oid) &&
          err.message.includes(`:${normalizedPath}`));

      if (notFoundInHead) {
        if (fileExists) {
          try {
            await fs.promises.unlink(`${dir}/${normalizedPath}`);

            return `Removed untracked file ${filepath}`;
          } catch (unlinkError) {
            throw new Error(`Failed to remove file: ${(unlinkError as Error).message}`);
          }
        } else {
          return `File ${filepath} is already removed`;
        }
      }

      throw readError;
    }
  } catch (error) {
    throw new Error(`Failed to discard changes: ${(error as Error).message}`);
  }
}
