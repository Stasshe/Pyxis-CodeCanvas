import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitFileSystemHelper } from './fileSystemHelper';

/**
 * Git checkout操作を管理するクラス
 */
export class GitCheckoutOperations {
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

  // プロジェクトディレクトリの存在を確認し、なければ作成
  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
  }

  // 現在のブランチを取得
  private async getCurrentBranch(): Promise<string> {
    try {
      return (await git.currentBranch({ fs: this.fs, dir: this.dir, fullname: false })) || 'HEAD';
    } catch {
      return 'HEAD';
    }
  }

  // ディレクトリ内の全ファイルを再帰的に取得
  private async getAllFiles(dirPath: string): Promise<string[]> {
    return await GitFileSystemHelper.getAllFiles(this.fs, dirPath);
  }

  // git checkout - ブランチ切り替え/作成
  async checkout(branchName: string, createNew = false): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      // 現在のブランチを取得
      const currentBranch = await this.getCurrentBranch();

      // 同じブランチの場合はスキップ
      if (currentBranch === branchName && !createNew) {
        return `Already on '${branchName}'`;
      }

      let targetCommitHash: string;
      let isNewBranch = createNew;

      if (createNew) {
        // 新しいブランチを作成する場合、現在のHEADを基準にする
        try {
          targetCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
        } catch {
          throw new Error('Cannot create new branch - no commits found in current branch');
        }

        // ブランチを作成
        await git.branch({ fs: this.fs, dir: this.dir, ref: branchName });
      } else {
        // 既存のブランチまたはコミットハッシュをチェックアウト
        try {
          // ブランチまたはコミットハッシュを解決
          try {
            // まずブランチとして試行
            targetCommitHash = await git.resolveRef({
              fs: this.fs,
              dir: this.dir,
              ref: `refs/heads/${branchName}`,
            });
          } catch {
            // ブランチが存在しない場合、コミットハッシュとして試行
            try {
              const expandedOid = await git.expandOid({
                fs: this.fs,
                dir: this.dir,
                oid: branchName,
              });
              targetCommitHash = expandedOid;

              // コミットハッシュの場合はdetached HEADになる
              isNewBranch = false;
            } catch {
              // 利用可能なブランチ一覧を取得してエラーメッセージに含める
              try {
                const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
                throw new Error(
                  `pathspec '${branchName}' did not match any file(s) known to git\nAvailable branches: ${branches.join(', ')}`
                );
              } catch {
                throw new Error(`pathspec '${branchName}' did not match any file(s) known to git`);
              }
            }
          }
        } catch (error) {
          throw error;
        }
      }

      // 現在のワーキングディレクトリの状態をバックアップ
      const currentFiles = new Map<string, string>();
      const existingFiles = await this.getAllFiles(this.dir);

      for (const filePath of existingFiles) {
        try {
          const content = await this.fs.promises.readFile(`${this.dir}/${filePath}`, {
            encoding: 'utf8',
          });
          currentFiles.set(filePath, content as string);
        } catch {
          // ファイル読み取りエラーは無視
        }
      }

      // チェックアウト実行
      console.log('=== Git checkout: Executing checkout ===');
      console.log('Branch name:', branchName);
      console.log('Current files count:', currentFiles.size);
      await git.checkout({ fs: this.fs, dir: this.dir, ref: branchName });
      console.log('Checkout completed successfully');

      // ターゲットコミットの情報を取得
      const targetCommit = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: targetCommitHash,
      });
      const targetTree = await git.readTree({
        fs: this.fs,
        dir: this.dir,
        oid: targetCommit.commit.tree,
      });

      // チェックアウト後のファイル状態を取得
      const newFiles = new Map<string, string>();
      const newFilesList = await this.getAllFiles(this.dir);
      console.log('New files count after checkout:', newFilesList.length);

      for (const filePath of newFilesList) {
        try {
          const content = await this.fs.promises.readFile(`${this.dir}/${filePath}`, {
            encoding: 'utf8',
          });
          newFiles.set(filePath, content as string);
        } catch {
          // ファイル読み取りエラーは無視
        }
      }
      console.log('New files map size:', newFiles.size);

      // 変更されたファイルを特定
      console.log('=== Git checkout: Detecting file changes ===');
      const changedFiles = new Set<string>();
      const addedFiles: string[] = [];
      const deletedFiles: string[] = [];
      const modifiedFiles: string[] = [];
      const restoredFiles: string[] = []; // 復元されたファイル（以前削除されていたが、新しいブランチに存在）

      // 削除されたファイル（現在のブランチにあったが、新しいブランチにはない）
      for (const [filePath, _] of currentFiles) {
        if (!newFiles.has(filePath)) {
          console.log('=== DELETED FILE DETECTED ===');
          console.log('Deleted file:', filePath);
          console.log('File was in currentFiles but not in newFiles');
          deletedFiles.push(filePath);
          changedFiles.add(filePath);
        }
      }

      // 追加・変更・復元されたファイル
      for (const [filePath, newContent] of newFiles) {
        if (!currentFiles.has(filePath)) {
          console.log('=== ADDED/RESTORED FILE DETECTED ===');
          console.log('Added/Restored file:', filePath);
          console.log('File was not in currentFiles but exists in newFiles');
          addedFiles.push(filePath);
          restoredFiles.push(filePath); // 復元されたファイルとしても記録
          changedFiles.add(filePath);
        } else if (currentFiles.get(filePath) !== newContent) {
          console.log('Modified file:', filePath);
          modifiedFiles.push(filePath);
          changedFiles.add(filePath);
        }
      }

      console.log('Total changed files:', changedFiles.size);
      console.log(
        'Added:',
        addedFiles.length,
        'Modified:',
        modifiedFiles.length,
        'Deleted:',
        deletedFiles.length,
        'Restored:',
        restoredFiles.length
      );

      // ファイル操作のコールバックを実行（テキストエディターに反映）
      if (this.onFileOperation) {
        console.log('=== Git checkout: Starting file operations ===');
        console.log('Changed files count:', changedFiles.size);
        console.log('onFileOperation callback available:', !!this.onFileOperation);

        for (const filePath of changedFiles) {
          try {
            const relativePath = GitFileSystemHelper.getRelativePathFromProject(
              `${this.dir}/${filePath}`,
              this.dir
            );
            console.log('Processing file:', filePath, '-> relativePath:', relativePath);

            if (newFiles.has(filePath)) {
              // ファイルが存在する場合（追加または変更）
              const content = newFiles.get(filePath)!;
              const isRestored = restoredFiles.includes(filePath);
              const actionType = isRestored ? 'restored' : 'created/modified';

              console.log(
                `Calling onFileOperation for ${actionType} file:`,
                relativePath,
                'content length:',
                content.length
              );
              if (isRestored) {
                console.log('=== RESTORING PREVIOUSLY DELETED FILE ===');
                console.log('File path:', filePath);
                console.log('Relative path:', relativePath);
                console.log(
                  'Content preview:',
                  content.substring(0, 100) + (content.length > 100 ? '...' : '')
                );
              }

              await this.onFileOperation(relativePath, 'file', content, false);
              console.log(
                `Successfully called onFileOperation for ${actionType} file:`,
                relativePath
              );
            } else {
              // ファイルが削除された場合
              console.log('=== PROCESSING DELETED FILE ===');
              console.log('Calling onFileOperation for delete:', relativePath);
              console.log('Original filePath:', filePath);
              console.log('File exists in currentFiles:', currentFiles.has(filePath));
              console.log('File exists in newFiles:', newFiles.has(filePath));
              await this.onFileOperation(relativePath, 'delete', undefined, false);
              console.log('Successfully called onFileOperation for delete:', relativePath);
            }
          } catch (error) {
            console.warn(`Failed to sync file operation for ${filePath}:`, error);
          }
        }

        console.log('=== Git checkout: File operations completed ===');
      } else {
        console.warn('=== Git checkout: onFileOperation callback not available ===');
      }

      // 結果メッセージを生成
      let result = '';
      if (createNew) {
        result = `Switched to a new branch '${branchName}'`;
      } else if (
        branchName.length >= 7 &&
        branchName === targetCommitHash.slice(0, branchName.length)
      ) {
        // コミットハッシュでチェックアウトした場合（detached HEAD）
        const shortHash = targetCommitHash.slice(0, 7);
        const commitMessage = targetCommit.commit.message.split('\n')[0];
        result = `Note: switching to '${branchName}'.\n\nYou are in 'detached HEAD' state.\nHEAD is now at ${shortHash} ${commitMessage}`;
      } else {
        result = `Switched to branch '${branchName}'`;
      }

      // 変更されたファイルの数を追加
      if (changedFiles.size > 0) {
        const changes: string[] = [];
        if (addedFiles.length > 0) changes.push(`${addedFiles.length} added`);
        if (modifiedFiles.length > 0) changes.push(`${modifiedFiles.length} modified`);
        if (deletedFiles.length > 0) changes.push(`${deletedFiles.length} deleted`);
        if (restoredFiles.length > 0) changes.push(`${restoredFiles.length} restored`);

        if (changes.length > 0) {
          result += `\n\nFiles changed: ${changes.join(', ')}`;
        }
      }

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;

      // 特定のエラーメッセージを適切にフォーマット
      if (errorMessage.includes('pathspec')) {
        throw new Error(errorMessage);
      } else if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      } else if (errorMessage.includes('Cannot create new branch')) {
        throw new Error(`fatal: ${errorMessage}`);
      }

      throw new Error(`git checkout failed: ${errorMessage}`);
    }
  }
}
