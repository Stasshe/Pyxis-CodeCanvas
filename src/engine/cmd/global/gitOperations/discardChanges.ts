import { fileRepository } from '@/engine/core/fileRepository';
// src/engine/cmd/global/gitOperations/discardChanges.ts
import git from 'isomorphic-git';
import { GitFileSystemHelper } from './fileSystemHelper';

export async function discardChanges(
  fs: any,
  dir: string,
  projectId: string,
  filepath: string
): Promise<string> {
  try {
    // プロジェクトがgitリポジトリであることを前提
    const normalizedPath = filepath.startsWith('/') ? filepath.slice(1) : filepath;

    // HEADから最新のコミットを取得
    const commits = await git.log({ fs, dir, depth: 1 });
    if (commits.length === 0) {
      throw new Error('No commits found. Cannot discard changes.');
    }

    const headCommit = commits[0];

    // ファイルが現在のワーキングディレクトリに存在するかチェック
    let fileExists = false;
    try {
      await fs.promises.stat(`${dir}/${normalizedPath}`);
      fileExists = true;
    } catch {
      fileExists = false;
    }

    // ファイルの内容をHEADから読み取る
    try {
      const { blob } = await git.readBlob({
        fs,
        dir,
        oid: headCommit.oid,
        filepath: normalizedPath,
      });

      // 親ディレクトリを確認し、存在しなければ作成
      const parentDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
      if (parentDir) {
        const fullParentPath = `${dir}/${parentDir}`;
        await GitFileSystemHelper.ensureDirectory(fullParentPath);
      }

      // ファイルをワーキングディレクトリに書き戻す
      await fs.promises.writeFile(`${dir}/${normalizedPath}`, blob);

      // IndexedDBにも同期（親フォルダも作成）- fileRepository.createFile を使用
      const content =
        typeof blob === 'string' ? blob : new TextDecoder().decode(blob as Uint8Array);

      const filePath = `/${normalizedPath}`;

      // createFile は自動的に親ディレクトリを作成し、既存ファイルの場合は更新する
      await fileRepository.createFile(projectId, filePath, content, 'file');

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
        // ファイルがHEADに存在しない場合（新規追加されたファイル）は削除
        if (fileExists) {
          try {
            await fs.promises.unlink(`${dir}/${normalizedPath}`);

            // IndexedDBからも削除
            const files = await fileRepository.getProjectFiles(projectId);
            const file = files.find(f => f.path === `/${normalizedPath}`);
            if (file) {
              await fileRepository.deleteFile(file.id);
            }

            return `Removed untracked file ${filepath}`;
          } catch (unlinkError) {
            throw new Error(`Failed to remove file: ${(unlinkError as Error).message}`);
          }
        } else {
          return `File ${filepath} is already removed`;
        }
      }

      // 上のいずれでもない場合は想定外のエラーなので再スロー
      throw readError;
    }
  } catch (error) {
    throw new Error(`Failed to discard changes: ${(error as Error).message}`);
  }
}
