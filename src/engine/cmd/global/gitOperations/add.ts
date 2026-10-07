import git from 'isomorphic-git';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';
import { GitFileSystemHelper } from './fileSystemHelper';

export async function add(fs: FS, dir: string, filepath: string): Promise<string> {
  try {
    if (filepath === '.') {
      return await addAll(fs, dir);
    }

    if (filepath === '*' || filepath.includes('*')) {
      const matchingFiles = await GitFileSystemHelper.getMatchingFiles(fs, dir, filepath);

      const status = await git.statusMatrix({ fs, dir });
      const deletedFiles: string[] = [];

      for (let i = 0; i < status.length; i++) {
        const [file, head, workdir] = status[i];
        if (head === 1 && workdir === 0) {
          deletedFiles.push(file);
        }
      }

      if (matchingFiles.length === 0 && deletedFiles.length === 0) {
        return `No files matching pattern: ${filepath}`;
      }

      let addedCount = 0;
      let deletedCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < matchingFiles.length; i++) {
        const file = matchingFiles[i];
        try {
          await git.add({ fs, dir, filepath: file });
          addedCount++;
        } catch (error) {
          errors.push(`Failed to add ${file}: ${(error as Error).message}`);
        }
      }

      for (let i = 0; i < deletedFiles.length; i++) {
        const file = deletedFiles[i];
        try {
          await git.remove({ fs, dir, filepath: file });
          deletedCount++;
        } catch (error) {
          errors.push(`Failed to stage deleted file ${file}: ${(error as Error).message}`);
        }
      }

      if (errors.length > 0) {
        console.warn(`[git add ${filepath}] Some files failed to add:`, errors);
      }

      const totalFiles = addedCount + deletedCount;
      let result = `Added ${addedCount} file(s), staged ${deletedCount} deletion(s) (${totalFiles} total)`;
      if (errors.length > 0) result += ` (${errors.length} failed)`;
      return result;
    }

    const normalizedPath = repositoryPath(dir, filepath);

    const status = await git.statusMatrix({ fs, dir });
    const fileStatus = status.find(([path]) => path === normalizedPath);

    if (fileStatus) {
      const [path, HEAD, workdir, stage] = fileStatus;

      if (HEAD === 1 && workdir === 0) {
        console.log(`[git.add] Staging deleted file: ${path}`);
        await git.remove({ fs, dir, filepath: normalizedPath });
        return `Staged deletion of ${filepath}`;
      }
      if (workdir === 1 || workdir === 2) {
        console.log(`[git.add] Processing new/modified file: ${path} (workdir=${workdir})`);
        await git.add({ fs, dir, filepath: normalizedPath });
        return `Added ${filepath} to staging area`;
      }
      if (stage === 2 || stage === 3) {
        return `'${filepath}' is already staged`;
      }
    }

    const fullPath = `${dir}/${normalizedPath}`;

    try {
      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) {
        const filesInDir = await GitFileSystemHelper.getAllFiles(fs, fullPath);
        let addedCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < filesInDir.length; i++) {
          const file = filesInDir[i];
          try {
            const relativePath = `${normalizedPath}/${file}`;
            await git.add({ fs, dir, filepath: relativePath });
            addedCount++;
          } catch (error) {
            errors.push(`Failed to add ${file}: ${(error as Error).message}`);
          }
        }

        if (errors.length > 0) {
          console.warn(`[git add ${filepath}] Some files failed to add:`, errors);
        }

        let result = `Added ${addedCount} file(s) from directory`;
        if (errors.length > 0) result += ` (${errors.length} failed)`;
        return result;
      }
      console.log(`[git.add] Adding file directly: ${normalizedPath}`);
      await git.add({ fs, dir, filepath: normalizedPath });
      return `Added ${filepath} to staging area`;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('ENOENT')) {
        const status = await git.statusMatrix({ fs, dir });
        const fileStatus = status.find(([path]) => path === normalizedPath);

        if (fileStatus && fileStatus[1] === 1 && fileStatus[2] === 0) {
          console.log(
            `[git.add] File not found but exists in git, staging deletion: ${normalizedPath}`
          );
          await git.remove({ fs, dir, filepath: normalizedPath });
          return `Staged deletion of ${filepath}`;
        }

        throw new Error(`pathspec '${filepath}' did not match any files`);
      }
      throw error;
    }
  } catch (error) {
    throw new Error(`git add failed: ${(error as Error).message}`);
  }
}

export async function addAll(fs: FS, dir: string): Promise<string> {
  try {
    console.log('[git.add] Processing all files in current directory');

    const statusMatrix = await git.statusMatrix({ fs, dir });
    console.log(`[git.add] Status matrix found ${statusMatrix.length} files`);
    console.log(`[git.add] Project directory: ${dir}`);

    for (let i = 0; i < statusMatrix.length; i++) {
      const [file, head, workdir, stage] = statusMatrix[i];
      console.log(`[git.add] File: ${file}, HEAD=${head}, workdir=${workdir}, stage=${stage}`);
    }

    let newCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;

    for (let i = 0; i < statusMatrix.length; i++) {
      const [file, head, workdir, stage] = statusMatrix[i];
      try {
        if (workdir === 0 && head === 1) {
          await git.remove({ fs, dir, filepath: file });
          deletedCount++;
        } else if (head === 0 && workdir > 0 && stage === 0) {
          await git.add({ fs, dir, filepath: file });
          newCount++;
        } else if (head === 1 && workdir === 2 && stage === 1) {
          await git.add({ fs, dir, filepath: file });
          modifiedCount++;
        }
      } catch (operationError) {
        console.warn(`[git.add] Failed to process ${file}:`, operationError);
      }
    }

    console.log(
      `[git.add] Completed: ${newCount} new, ${modifiedCount} modified, ${deletedCount} deleted`
    );
    return `Added: ${newCount} new, ${modifiedCount} modified, ${deletedCount} deleted files to staging area`;
  } catch (error) {
    console.error('[git.add] Failed:', error);
    throw new Error(`Failed to add all files: ${(error as Error).message}`);
  }
}
