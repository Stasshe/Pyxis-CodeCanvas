// src/engine/cmd/global/gitOperations/add.ts
import git from 'isomorphic-git';
import { GitFileSystemHelper } from './fileSystemHelper';

export async function add(fs: any, dir: string, filepath: string): Promise<string> {
  try {
    // Ensure project dir exists
    // Note: caller should already ensure directory exists, but double-check .git presence not required for add

    // ファイルシステムの同期処理
    if ((fs as any).sync) {
      try {
        await (fs as any).sync();
      } catch (syncError) {
        console.warn('[git.add] FileSystem sync failed:', syncError);
      }
    }

    if (filepath === '.') {
      // すべてのファイルを追加（削除されたファイルも含む）
      return await addAll(fs, dir);
    }

    if (filepath === '*' || filepath.includes('*')) {
      const matchingFiles = await GitFileSystemHelper.getMatchingFiles(fs, dir, filepath);

      // 削除されたファイルも含めてステージング対象を取得
      const status = await git.statusMatrix({ fs, dir });
      const deletedFiles: string[] = [];

      // 削除されたファイルを特定
      for (let i = 0; i < status.length; i++) {
        const [file, head, workdir, stage] = status[i];
        if (head === 1 && workdir === 0 && stage === 1) {
          deletedFiles.push(file);
        }
      }

      if (matchingFiles.length === 0 && deletedFiles.length === 0) {
        return `No files matching pattern: ${filepath}`;
      }

      let addedCount = 0;
      let deletedCount = 0;
      const errors: string[] = [];

      // 通常のファイルを追加
      for (let i = 0; i < matchingFiles.length; i++) {
        const file = matchingFiles[i];
        try {
          await git.add({ fs, dir, filepath: file });
          addedCount++;
        } catch (error) {
          errors.push(`Failed to add ${file}: ${(error as Error).message}`);
        }
      }

      // 削除されたファイルをステージング
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
      return `Added ${addedCount} file(s), staged ${deletedCount} deletion(s) (${totalFiles} total)${errors.length > 0 ? ` (${errors.length} failed)` : ''}`;
    }

    // 単一ファイルまたはディレクトリ
    const normalizedPath = filepath.startsWith('/') ? filepath.slice(1) : filepath;

    // まずステータスマトリックスから該当ファイルの状態を確認
    const status = await git.statusMatrix({ fs, dir });
    const fileStatus = status.find(([path]) => path === normalizedPath);

    if (fileStatus) {
      const [path, HEAD, workdir, stage] = fileStatus;

      // 削除されたファイル (HEAD=1, workdir=0, stage=1) の場合
      if (HEAD === 1 && workdir === 0 && stage === 1) {
        console.log(`[git.add] Staging deleted file: ${path}`);
        await git.remove({ fs, dir, filepath: normalizedPath });
        return `Staged deletion of ${filepath}`;
      }
      // 新規・変更されたファイル (workdir=1 or workdir=2) の場合
      if (workdir === 1 || workdir === 2) {
        console.log(`[git.add] Processing new/modified file: ${path} (workdir=${workdir})`);
        await git.add({ fs, dir, filepath: normalizedPath });
        return `Added ${filepath} to staging area`;
      }
      // 既にステージング済み
      if (stage === 2 || stage === 3) {
        return `'${filepath}' is already staged`;
      }
    }

    // ステータスマトリックスにない場合は直接ファイルシステムで確認
    const fullPath = `${dir}/${normalizedPath}`;

    try {
      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) {
        // ディレクトリの場合、再帰的に追加
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

        return `Added ${addedCount} file(s) from directory${errors.length > 0 ? ` (${errors.length} failed)` : ''}`;
      }
      // 通常のファイル追加
      console.log(`[git.add] Adding file directly: ${normalizedPath}`);
      await git.add({ fs, dir, filepath: normalizedPath });
      return `Added ${filepath} to staging area`;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('ENOENT')) {
        // ファイルが存在しない場合は削除されたファイルの可能性があるので、
        // ステータスを再確認
        const status = await git.statusMatrix({ fs, dir });
        const fileStatus = status.find(([path]) => path === normalizedPath);

        if (fileStatus && fileStatus[1] === 1 && fileStatus[2] === 0) {
          // 削除されたファイル
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

export async function addAll(fs: any, dir: string): Promise<string> {
  try {
    console.log('[git.add] Processing all files in current directory');

    if ((fs as any).sync) {
      try {
        await (fs as any).sync();
      } catch (syncError) {
        console.warn('[git.add] FileSystem sync failed:', syncError);
      }
    }

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
        if (workdir === 0 && head === 1 && stage === 1) {
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
