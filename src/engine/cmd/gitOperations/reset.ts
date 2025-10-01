import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitFileSystemHelper } from './fileSystemHelper';

/**
 * Git reset操作を管理するクラス
 */
export class GitResetOperations {
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

  // Gitリポジトリが初期化されているかチェック
  private async ensureGitRepository(): Promise<void> {
    await this.ensureProjectDirectory();
    try {
      await this.fs.promises.stat(`${this.dir}/.git`);
    } catch {
      throw new Error('not a git repository (or any of the parent directories): .git');
    }
  }

  // 現在のブランチ名を取得
  private async getCurrentBranch(): Promise<string> {
    try {
      await this.ensureGitRepository();
      const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });
      return branch || 'main';
    } catch {
      return '(no git)';
    }
  }

  // すべてのファイルを取得（再帰的）
  private async getAllFiles(dirPath: string): Promise<string[]> {
    return await GitFileSystemHelper.getAllFiles(this.fs, dirPath);
  }

  // git reset - ファイルをアンステージング、またはハードリセット
  async reset(
    options: { filepath?: string; hard?: boolean; commit?: string } = {}
  ): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const { filepath, hard, commit } = options;

      if (hard && commit) {
        // git reset --hard <commit> - 指定されたコミットまでハードリセット
        return await this.resetHard(commit);
      } else if (filepath) {
        // 特定のファイルをアンステージング
        await git.resetIndex({ fs: this.fs, dir: this.dir, filepath });

        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        if (this.onFileOperation) {
          console.log('[git.reset] Triggering project refresh after unstaging file:', filepath);
          await this.onFileOperation('.', 'folder', undefined, false);
        }

        return `Unstaged ${filepath}`;
      } else {
        // 全ファイルをアンステージング - ステージングされたファイル（サブディレクトリ含む）を取得してそれぞれリセット
        const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
        let unstagedCount = 0;

        for (const [filepath, HEAD, workdir, stage] of status) {
          // ステージ済み（新規/変更）: stage===2,3
          if (stage === 2) {
            await git.resetIndex({ fs: this.fs, dir: this.dir, filepath });
            unstagedCount++;
          }
        }

        // onFileOperationコールバックを呼び出してプロジェクトの更新を通知
        this.onFileOperation?.('.', 'folder', undefined, false);

        return `Unstaged ${unstagedCount} file(s)`;
      }
    } catch (error) {
      throw new Error(`git reset failed: ${(error as Error).message}`);
    }
  }

  // git reset --hard の実装
  private async resetHard(commitHash: string): Promise<string> {
    try {
      // コミットハッシュの正規化（短縮形も対応）
      let fullCommitHash: string;
      try {
        const expandedOid = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commitHash });
        fullCommitHash = expandedOid;
      } catch {
        throw new Error(`bad revision '${commitHash}'`);
      }

      // 対象コミットの情報を取得
      const targetCommit = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: fullCommitHash,
      });

      // 現在のコミットを取得
      const currentBranch = await this.getCurrentBranch();
      let currentCommitHash: string;
      try {
        currentCommitHash = await git.resolveRef({
          fs: this.fs,
          dir: this.dir,
          ref: currentBranch,
        });
      } catch {
        throw new Error(`Cannot reset - no commits found on branch '${currentBranch}'`);
      }

      // すでに指定されたコミットにいる場合
      if (currentCommitHash === fullCommitHash) {
        return `HEAD is now at ${fullCommitHash.slice(0, 7)} ${targetCommit.commit.message.split('\n')[0]}`;
      }

      // 現在のワーキングディレクトリの全ファイルを削除
      const filesToDelete = await this.getAllFiles(this.dir);
      const deletedFiles: string[] = [];

      for (const filePath of filesToDelete) {
        try {
          const fullPath = `${this.dir}/${filePath}`;
          await this.fs.promises.unlink(fullPath);
          deletedFiles.push(filePath);

          // ファイル操作のコールバックを実行
          if (this.onFileOperation) {
            const projectRelativePath = filePath.startsWith('/') ? filePath : `/${filePath}`;
            await this.onFileOperation(projectRelativePath, 'delete', undefined, false);
          }
        } catch (error) {
          console.warn(`Failed to delete file ${filePath}:`, error);
        }
      }

      // 対象コミットのツリーを取得してファイルを復元
      const targetTree = await git.readTree({
        fs: this.fs,
        dir: this.dir,
        oid: targetCommit.commit.tree,
      });
      const restoredFiles: string[] = [];

      await this.restoreTreeFiles(targetTree, '', restoredFiles);

      // HEADを対象コミットに移動
      try {
        await git.writeRef({
          fs: this.fs,
          dir: this.dir,
          ref: `refs/heads/${currentBranch}`,
          value: fullCommitHash,
          force: true,
        });
      } catch (writeRefError) {
        // writeRefが失敗した場合は、checkoutを使用して強制的にリセット
        try {
          await git.checkout({
            fs: this.fs,
            dir: this.dir,
            ref: fullCommitHash,
            force: true,
          });
        } catch (checkoutError) {
          throw new Error(`Failed to reset HEAD: ${(writeRefError as Error).message}`);
        }
      }

      // インデックスをクリア
      try {
        const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
        for (const [filepath] of status) {
          try {
            await git.resetIndex({ fs: this.fs, dir: this.dir, filepath });
          } catch {
            // インデックスのリセットに失敗しても続行
          }
        }
      } catch {
        // ステータス取得に失敗しても続行
      }

      const shortHash = fullCommitHash.slice(0, 7);
      const commitMessage = targetCommit.commit.message.split('\n')[0];

      let result = `HEAD is now at ${shortHash} ${commitMessage}`;

      if (deletedFiles.length > 0 || restoredFiles.length > 0) {
        result += `\n\nFiles changed:`;
        if (deletedFiles.length > 0) {
          result += `\n  ${deletedFiles.length} file(s) deleted`;
        }
        if (restoredFiles.length > 0) {
          result += `\n  ${restoredFiles.length} file(s) restored`;
        }
      }

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes('bad revision')) {
        throw new Error(`fatal: bad revision '${commitHash}'`);
      } else if (errorMessage.includes('not a git repository')) {
        throw new Error('fatal: not a git repository (or any of the parent directories): .git');
      }

      throw new Error(`git reset --hard failed: ${errorMessage}`);
    }
  }

  // ツリーからファイルを復元する補助メソッド
  private async restoreTreeFiles(
    tree: any,
    basePath: string,
    restoredFiles: string[]
  ): Promise<void> {
    for (const entry of tree.tree) {
      const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path;
      const fsPath = `${this.dir}/${fullPath}`;

      if (entry.type === 'tree') {
        // ディレクトリの場合、再帰的に処理
        try {
          // ディレクトリが存在しない場合のみ作成
          try {
            await this.fs.promises.stat(fsPath);
          } catch {
            await this.fs.promises.mkdir(fsPath, { recursive: true } as any);
          }
          // ファイル操作のコールバックを実行
          if (this.onFileOperation) {
            const projectRelativePath = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
            await this.onFileOperation(projectRelativePath, 'folder', undefined, false);
          }
          // サブツリーを取得して再帰
          const subTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: entry.oid });
          await this.restoreTreeFiles(subTree, fullPath, restoredFiles);
        } catch (error) {
          console.warn(`Failed to create directory ${fullPath}:`, error);
        }
      } else if (entry.type === 'blob') {
        // ファイルの場合、内容を復元
        try {
          // 親ディレクトリを再帰的に作成
          const dirPath = fsPath.substring(0, fsPath.lastIndexOf('/'));
          if (dirPath && dirPath !== this.dir) {
            try {
              await this.fs.promises.stat(dirPath);
            } catch {
              await this.fs.promises.mkdir(dirPath, { recursive: true } as any);
            }
          }
          // ファイル内容を取得して書き込み
          const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: entry.oid });
          const content = new TextDecoder().decode(blob);
          await this.fs.promises.writeFile(fsPath, content, 'utf8');
          restoredFiles.push(fullPath);
          // ファイル操作のコールバックを実行
          if (this.onFileOperation) {
            const projectRelativePath = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
            await this.onFileOperation(projectRelativePath, 'file', content, false);
          }
        } catch (error) {
          console.warn(`Failed to restore file ${fullPath}:`, error);
        }
      }
    }
  }
}
