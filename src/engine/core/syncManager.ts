/**
 * SyncManager - FileRepositoryとGitFileSystemの差分同期を制御
 * 通常操作: IndexedDB → lightning-fs
 * git操作後: lightning-fs → IndexedDB
 */

import { fileRepository } from './fileRepository';
import { gitFileSystem } from './gitFileSystem';
import { ProjectFile } from '@/types';

export class SyncManager {
  private static instance: SyncManager | null = null;

  private constructor() {}

  /**
   * シングルトンインスタンス取得
   */
  static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  /**
   * IndexedDB → lightning-fs への同期
   * 通常のファイル操作後に呼び出される
   */
  async syncFromIndexedDBToFS(projectId: string, projectName: string): Promise<void> {
    console.log('[SyncManager] Syncing from IndexedDB to lightning-fs...');

    try {
      // IndexedDBから全ファイルを取得
      const dbFiles = await fileRepository.getProjectFiles(projectId);

      // lightning-fsのプロジェクトディレクトリを確保
      const projectDir = gitFileSystem.getProjectDir(projectName);
      await gitFileSystem.ensureDirectory(projectDir);

      // 既存のファイルをクリア（.gitディレクトリは保持）
      await gitFileSystem.clearProjectDirectory(projectName);

      // ディレクトリを先に作成
      const directories = dbFiles
        .filter(f => f.type === 'folder')
        .sort((a, b) => a.path.length - b.path.length);

      for (const dir of directories) {
        const fullPath = `${projectDir}${dir.path}`;
        await gitFileSystem.ensureDirectory(fullPath);
      }

      // ファイルを作成
      const files = dbFiles.filter(f => f.type === 'file');

      for (const file of files) {
        try {
          if (file.isBufferArray && file.bufferContent) {
            // バイナリファイル
            await gitFileSystem.writeFile(projectName, file.path, new Uint8Array(file.bufferContent));
          } else {
            // テキストファイル
            await gitFileSystem.writeFile(projectName, file.path, file.content || '');
          }
        } catch (error) {
          console.error(`[SyncManager] Failed to sync file ${file.path}:`, error);
        }
      }

      // キャッシュフラッシュ
      await gitFileSystem.flush();

      console.log('[SyncManager] Sync from IndexedDB to lightning-fs completed');
    } catch (error) {
      console.error('[SyncManager] Failed to sync from IndexedDB to lightning-fs:', error);
      throw error;
    }
  }

  /**
   * lightning-fs → IndexedDB への同期
   * git revert/checkout等の操作後に呼び出される
   */
  async syncFromFSToIndexedDB(projectId: string, projectName: string): Promise<void> {
    console.log('[SyncManager] Syncing from lightning-fs to IndexedDB...');

    try {
      // lightning-fsから全ファイルを取得
      const fsFiles = await gitFileSystem.getAllFiles(projectName);

      // IndexedDBから現在のファイル一覧を取得
      const dbFiles = await fileRepository.getProjectFiles(projectId);

      // 差分を計算
      const fsFilePaths = new Set(fsFiles.map(f => f.path));
      const dbFilePaths = new Set(dbFiles.map(f => f.path));

      // 削除されたファイルをIndexedDBから削除
      for (const dbFile of dbFiles) {
        if (!fsFilePaths.has(dbFile.path)) {
          console.log(`[SyncManager] Deleting file from IndexedDB: ${dbFile.path}`);
          await fileRepository.deleteFile(dbFile.id);
        }
      }

      // 新規/更新されたファイルをIndexedDBに保存
      for (const fsFile of fsFiles) {
        const existingFile = dbFiles.find(f => f.path === fsFile.path);

        if (existingFile) {
          // 既存ファイルの更新
          if (fsFile.type === 'file' && existingFile.content !== fsFile.content) {
            console.log(`[SyncManager] Updating file in IndexedDB: ${fsFile.path}`);
            existingFile.content = fsFile.content;
            existingFile.updatedAt = new Date();
            await fileRepository.saveFile(existingFile);
          }
        } else {
          // 新規ファイルの作成
          console.log(`[SyncManager] Creating file in IndexedDB: ${fsFile.path}`);
          await fileRepository.createFile(
            projectId,
            fsFile.path,
            fsFile.content,
            fsFile.type
          );
        }
      }

      console.log('[SyncManager] Sync from lightning-fs to IndexedDB completed');
    } catch (error) {
      console.error('[SyncManager] Failed to sync from lightning-fs to IndexedDB:', error);
      throw error;
    }
  }

  /**
   * 単一ファイルをIndexedDB → lightning-fsに同期
   */
  async syncSingleFileToFS(
    projectName: string,
    filePath: string,
    content: string | null,
    operation: 'create' | 'update' | 'delete',
    bufferContent?: ArrayBuffer
  ): Promise<void> {
    console.log(`[SyncManager] Syncing single file to lightning-fs: ${filePath} (${operation})`);

    try {
      if (operation === 'delete' || content === null) {
        // ファイル削除
        await gitFileSystem.deleteFile(projectName, filePath);
      } else {
        // ファイル作成・更新
        if (bufferContent) {
          await gitFileSystem.writeFile(projectName, filePath, new Uint8Array(bufferContent));
        } else {
          await gitFileSystem.writeFile(projectName, filePath, content);
        }
      }

      // キャッシュフラッシュ
      await gitFileSystem.flush();

      console.log(`[SyncManager] Single file sync completed: ${filePath}`);
    } catch (error) {
      console.error(`[SyncManager] Failed to sync single file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * プロジェクト全体を初期化（プロジェクト作成時）
   */
  async initializeProject(
    projectId: string,
    projectName: string,
    files: ProjectFile[]
  ): Promise<void> {
    console.log('[SyncManager] Initializing project...');

    try {
      // lightning-fsのプロジェクトディレクトリを作成
      const projectDir = gitFileSystem.getProjectDir(projectName);
      await gitFileSystem.ensureDirectory(projectDir);

      // ファイルを同期
      await this.syncFromIndexedDBToFS(projectId, projectName);

      console.log('[SyncManager] Project initialization completed');
    } catch (error) {
      console.error('[SyncManager] Failed to initialize project:', error);
      throw error;
    }
  }
}

// シングルトンインスタンスをエクスポート
export const syncManager = SyncManager.getInstance();
