import git from 'isomorphic-git';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';
import { GitFileSystemHelper } from './fileSystemHelper';
import { preserveIndexedModes } from './indexModes';

export async function add(fs: FS, dir: string, filepath: string): Promise<string> {
  try {
    if (filepath === '.') {
      return await addAll(fs, dir);
    }

    fs = await preserveIndexedModes(fs, dir);
    if (filepath.includes('*') || filepath.includes('?')) {
      const matchingFiles = await GitFileSystemHelper.getMatchingFiles(fs, dir, filepath);

      const status = await git.statusMatrix({ fs, dir });
      const deletedFiles: string[] = [];

      for (let i = 0; i < status.length; i++) {
        const [file, head, workdir] = status[i];
        if (head === 1 && workdir === 0 && GitFileSystemHelper.matchesPattern(file, filepath)) {
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
        throw new Error(errors.join('; '));
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

    if (!fileStatus && (await git.isIgnored({ fs, dir, filepath: normalizedPath }))) {
      throw new Error(`The path '${filepath}' is ignored by a .gitignore file`);
    }

    const fullPath = `${dir}/${normalizedPath}`;

    try {
      const stat = await fs.promises.lstat(fullPath);

      if (stat.isDirectory()) {
        const filesInDir = await GitFileSystemHelper.getAllFiles(fs, fullPath, dir, normalizedPath);
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
          throw new Error(errors.join('; '));
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
    fs = await preserveIndexedModes(fs, dir);
    const statusMatrix = await git.statusMatrix({ fs, dir });
    const candidatePaths = new Set(statusMatrix.map(([path]) => path));
    const changedPaths = new Set<string>();
    await git.walk({
      fs,
      dir,
      trees: [git.STAGE(), git.WORKDIR()],
      map: async (path, [stage, worktree]) => {
        if (!candidatePaths.has(path)) return;
        if (worktree && (await worktree.type()) === 'tree') return;
        if (!worktree) {
          if (stage && (await stage.type()) !== 'tree') changedPaths.add(path);
          return;
        }
        // OPFS can retain matching stat values for different bytes. Hash the content itself.
        const content = await worktree.content();
        if (content === undefined || content === null)
          throw new Error(`Worktree content unavailable: ${path}`);
        const { oid } = await git.hashBlob({ object: content });
        if (
          !stage ||
          (await stage.oid()) !== oid ||
          (await stage.mode()) !== (await worktree.mode())
        ) {
          changedPaths.add(path);
        }
      },
    });
    let newCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < statusMatrix.length; i++) {
      const [file, head, workdir] = statusMatrix[i];
      try {
        if (!changedPaths.has(file)) continue;
        if (workdir === 0) {
          await git.remove({ fs, dir, filepath: file });
          deletedCount++;
        } else {
          await git.add({ fs, dir, filepath: file });
          if (head === 0) newCount++;
          else modifiedCount++;
        }
      } catch (operationError) {
        let message = String(operationError);
        if (operationError instanceof Error) message = operationError.message;
        errors.push(`${file}: ${message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Failed to add files: ${errors.join('; ')}`);
    }
    return `Added: ${newCount} new, ${modifiedCount} modified, ${deletedCount} deleted files to staging area`;
  } catch (error) {
    console.error('[git.add] Failed:', error);
    throw new Error(`Failed to add all files: ${(error as Error).message}`);
  }
}
