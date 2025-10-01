import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

/**
 * Git revert操作を管理するクラス
 */
export class GitRevertOperations {
  private fs: FS;
  private dir: string;
  private onFileOperation?: (
    path: string,
    type: 'file' | 'folder' | 'delete',
    content?: string,
    isNodeRuntime?: boolean
  ) => Promise<void>;

  constructor(
    fs: FS,
    dir: string,
    onFileOperation?: (
      path: string,
      type: 'file' | 'folder' | 'delete',
      content?: string,
      isNodeRuntime?: boolean
    ) => Promise<void>
  ) {
    this.fs = fs;
    this.dir = dir;
    this.onFileOperation = onFileOperation;
  }

  // git revert - コミットを取り消し
  async revert(commitHash: string): Promise<string> {
    try {
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // コミットハッシュの正規化（短縮形も対応）
      let fullCommitHash: string;
      try {
        // コミットが存在するかチェックし、完全なハッシュを取得
        const expandedOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commitHash });
        fullCommitHash = expandedOid;
      } catch {
        throw new Error(`bad revision '${commitHash}'`);
      }

      // 対象コミットの情報を取得
      const commitToRevert = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: fullCommitHash,
      });

      // 親コミットが存在するかチェック
      if (commitToRevert.commit.parent.length === 0) {
        throw new Error(`cannot revert initial commit ${commitHash.slice(0, 7)}`);
      }

      // マージコミットの場合はエラー
      if (commitToRevert.commit.parent.length > 1) {
        throw new Error(`commit ${commitHash.slice(0, 7)} is a merge commit`);
      }

      const parentHash = commitToRevert.commit.parent[0];

      // 親コミットの状態を取得
      const parentCommit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: parentHash });

      // 対象コミットと親コミットのファイル差分を取得
      const changedFiles = new Set<string>();

      // 対象コミットで変更されたファイルを特定
      const currentTree = await git.readTree({
        fs: this.fs,
        dir: this.dir,
        oid: commitToRevert.commit.tree,
      });
      const parentTree = await git.readTree({
        fs: this.fs,
        dir: this.dir,
        oid: parentCommit.commit.tree,
      });

      // 変更されたファイルパスを収集
      const getAllFilePaths = async (tree: any, basePath = ''): Promise<string[]> => {
        const paths: string[] = [];
        for (const entry of tree.tree) {
          const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path;
          if (entry.type === 'tree') {
            // サブディレクトリを再帰的に処理
            try {
              const subTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: entry.oid });
              const subPaths = await getAllFilePaths(subTree, fullPath);
              paths.push(...subPaths);
            } catch (error) {
              console.warn(`Failed to read subtree ${fullPath}:`, error);
            }
          } else {
            paths.push(fullPath);
          }
        }
        return paths;
      };

      const currentFiles = new Set(await getAllFilePaths(currentTree));
      const parentFiles = new Set(await getAllFilePaths(parentTree));

      // 追加、削除、変更されたファイルを特定
      const addedFiles = [...currentFiles].filter(f => !parentFiles.has(f));
      const deletedFiles = [...parentFiles].filter(f => !currentFiles.has(f));
      const commonFiles = [...currentFiles].filter(f => parentFiles.has(f));

      // 変更されたファイルを特定（内容比較）
      const modifiedFiles: string[] = [];
      for (const filePath of commonFiles) {
        try {
          const currentEntry = currentTree.tree.find((e: any) => e.path === filePath);
          const parentEntry = parentTree.tree.find((e: any) => e.path === filePath);

          if (currentEntry && parentEntry && currentEntry.oid !== parentEntry.oid) {
            modifiedFiles.push(filePath as string);
          }
        } catch {
          // ファイル比較エラーは無視
        }
      }

      let revertedFileCount = 0;
      const revertResults: string[] = [];

      // 追加されたファイルを削除
      for (const filePath of addedFiles) {
        try {
          const fullPath = `${this.dir}/${filePath}`;
          await this.fs.promises.unlink(fullPath);
          changedFiles.add(filePath as string);
          revertResults.push(`deleted:    ${filePath}`);
          revertedFileCount++;
        } catch (error) {
          console.warn(`Failed to delete file ${filePath}:`, error);
        }
      }

      // 削除されたファイルを復元
      for (const filePath of deletedFiles) {
        try {
          const parentEntry = parentTree.tree.find((e: any) => e.path === filePath);
          if (parentEntry) {
            const blob = await git.readBlob({ fs: this.fs, dir: this.dir, oid: parentEntry.oid });
            const fullPath = `${this.dir}/${filePath}`;
            // 親ディレクトリを作成（存在しなければ作成）
            const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
            if (parentDir && parentDir !== this.dir) {
              try {
                await this.fs.promises.stat(parentDir);
              } catch {
                await this.fs.promises.mkdir(parentDir, { recursive: true } as any);
              }
            }
            await this.fs.promises.writeFile(fullPath, blob.blob);
            changedFiles.add(filePath as string);
            revertResults.push(`restored:   ${filePath}`);
            revertedFileCount++;
          }
        } catch (error) {
          console.warn(`Failed to restore file ${filePath}:`, error);
        }
      }

      // 変更されたファイルを親コミットの状態に戻す
      for (const filePath of modifiedFiles) {
        try {
          const parentEntry = parentTree.tree.find((e: any) => e.path === filePath);
          if (parentEntry) {
            const blob = await git.readBlob({ fs: this.fs, dir: this.dir, oid: parentEntry.oid });
            const fullPath = `${this.dir}/${filePath}`;
            // 親ディレクトリを作成（存在しなければ作成）
            const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
            if (parentDir && parentDir !== this.dir) {
              try {
                await this.fs.promises.stat(parentDir);
              } catch {
                await this.fs.promises.mkdir(parentDir, { recursive: true } as any);
              }
            }
            await this.fs.promises.writeFile(fullPath, blob.blob);
            changedFiles.add(filePath);
            revertResults.push(`reverted:   ${filePath}`);
            revertedFileCount++;
          }
        } catch (error) {
          console.warn(`Failed to revert file ${filePath}:`, error);
        }
      }

      // 変更をステージング
      for (const filePath of changedFiles) {
        try {
          const fullPath = `${this.dir}/${filePath}`;
          // ファイルが存在するかチェック
          try {
            await this.fs.promises.stat(fullPath);
            await git.add({ fs: this.fs, dir: this.dir, filepath: filePath });
          } catch {
            // ファイルが削除された場合
            await git.remove({ fs: this.fs, dir: this.dir, filepath: filePath });
          }
        } catch (error) {
          console.warn(`Failed to stage file ${filePath}:`, error);
        }
      }

      // リバートコミットを作成
      const revertMessage = `Revert "${commitToRevert.commit.message.split('\n')[0]}"\n\nThis reverts commit ${fullCommitHash}.`;
      const author = { name: 'User', email: 'user@pyxis.dev' };

      const revertCommitHash = await git.commit({
        fs: this.fs,
        dir: this.dir,
        message: revertMessage,
        author,
        committer: author,
      });

      // プロジェクトディレクトリからの相対パスを取得
      const getRelativePathFromProject = (fullPath: string): string => {
        return fullPath.replace(this.dir, '') || '/';
      };

      // ファイル操作のコールバックを実行（テキストエディターに反映）
      if (this.onFileOperation) {
        for (const filePath of changedFiles) {
          try {
            const relativePath = getRelativePathFromProject(`${this.dir}/${filePath}`);
            const fullPath = `${this.dir}/${filePath}`;

            // ファイルが存在するかチェック
            try {
              const content = await this.fs.promises.readFile(fullPath, { encoding: 'utf8' });
              await this.onFileOperation(relativePath, 'file', content as string, false);
            } catch {
              // ファイルが削除された場合
              await this.onFileOperation(relativePath, 'delete', undefined, false);
            }
          } catch (error) {
            console.warn(`Failed to sync file operation for ${filePath}:`, error);
          }
        }
      }

      // 結果メッセージを生成
      let result = `Revert commit ${revertCommitHash.slice(0, 7)} created\n`;
      result += `Reverted commit: ${fullCommitHash.slice(0, 7)} - ${commitToRevert.commit.message.split('\n')[0]}\n`;

      if (revertResults.length > 0) {
        result += `\nFiles changed:\n${revertResults.join('\n')}`;
      }

      result += `\n\nTotal ${revertedFileCount} file(s) reverted`;

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;

      // エラーメッセージを適切にフォーマット
      if (errorMessage.includes('bad revision')) {
        throw new Error(`fatal: bad revision '${commitHash}'`);
      } else if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      } else if (errorMessage.includes('cannot revert initial commit')) {
        throw new Error(`error: ${errorMessage}`);
      } else if (errorMessage.includes('is a merge commit')) {
        throw new Error(
          `error: ${errorMessage}\nhint: Try 'git revert -m 1 <commit>' to revert a merge commit`
        );
      }

      throw new Error(`git revert failed: ${errorMessage}`);
    }
  }
}
