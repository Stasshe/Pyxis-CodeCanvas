/**
 * SyncManager - FileRepositoryとGitFileSystemの差分同期を制御
 * 通常操作: IndexedDB → lightning-fs
 * git操作後: lightning-fs → IndexedDB
 */

import { fileRepository } from './fileRepository';
import { gitFileSystem } from './gitFileSystem';
import { parseGitignore, isPathIgnored, GitIgnoreRule } from './gitignore';

import { coreInfo, coreWarn, coreError } from '@/engine/core/coreLogger';
import { ProjectFile } from '@/types';

export class SyncManager {
  private static instance: SyncManager | null = null;

  // simple event listeners map
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

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

  // event emitter helpers
  on(event: string, cb: (...args: any[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string, cb: (...args: any[]) => void) {
    this.listeners.get(event)?.delete(cb);
  }

  private emit(event: string, ...args: any[]) {
    const s = this.listeners.get(event);
    if (!s) return;
    for (const cb of Array.from(s)) {
      try {
        cb(...args);
      } catch (e) {
        coreWarn('[SyncManager] listener error', e);
      }
    }
  }

  /**
   * Get and parse .gitignore rules for a project
   */
  private async getGitignoreRules(projectId: string): Promise<GitIgnoreRule[]> {
    try {
      const gitignoreFile = await fileRepository.getFileByPath(projectId, '/.gitignore');
      if (!gitignoreFile || !gitignoreFile.content) {
        return [];
      }
      return parseGitignore(gitignoreFile.content);
    } catch (error) {
      // No .gitignore file or error reading it
      return [];
    }
  }

  /**
   * Check if a path should be ignored based on .gitignore rules
   * @param rules Parsed gitignore rules
   * @param path File path (will be normalized by removing leading slashes)
   * @returns true if path should be ignored
   */
  private shouldIgnorePath(rules: GitIgnoreRule[], path: string): boolean {
    if (rules.length === 0) return false;

    // Normalize path (remove leading slash for consistent matching)
    const normalizedPath = path.replace(/^\/+/, '');

    // Check if path is ignored (false = not a directory for type-specific rules)
    const ignored = isPathIgnored(rules, normalizedPath, false);

    if (ignored) {
      coreInfo(`[SyncManager] Path "${path}" is ignored by .gitignore`);
    }

    return ignored;
  }

  /**
   * IndexedDB → lightning-fs への同期
   * 通常のファイル操作後に呼び出される
   * .gitignore ルールを適用してフィルタリング
   */
  async syncFromIndexedDBToFS(projectId: string, projectName: string): Promise<void> {
    // notify listeners that a sync is starting
    this.emit('sync:start', { projectId, projectName, direction: 'db->fs' });
    try {
      const dbFiles = await fileRepository.getFilesByPrefix(projectId, '/');
      const projectDir = gitFileSystem.getProjectDir(projectName);
      await gitFileSystem.ensureDirectory(projectDir);

      // Get .gitignore rules
      const gitignoreRules = await this.getGitignoreRules(projectId);
      coreInfo(`[SyncManager] Loaded ${gitignoreRules.length} .gitignore rules`);

      // Filter out ignored files
      const filteredDbFiles = dbFiles.filter(file => {
        // Always include .gitignore itself (using consistent path format)
        if (file.path === '/.gitignore') return true;

        // Check if file should be ignored
        return !this.shouldIgnorePath(gitignoreRules, file.path);
      });

      coreInfo(
        `[SyncManager] Filtered files: ${dbFiles.length} -> ${filteredDbFiles.length} (${dbFiles.length - filteredDbFiles.length} ignored)`
      );

      // get FS snapshot (ignore errors — treat as empty)
      let existingFsFiles: Array<{ path: string; content: string; type: 'file' | 'folder' }> = [];
      try {
        existingFsFiles = await gitFileSystem.getAllFiles(projectName);
      } catch (e) {
        coreWarn('[SyncManager] Failed to list GitFS files, proceeding with empty FS snapshot:', e);
      }

      const existingFsMap = new Map(existingFsFiles.map(f => [f.path, f] as const));
      const dbFilePaths = new Set(filteredDbFiles.map(f => f.path));

      // create directories first (shortest path first)
      const dirs = filteredDbFiles
        .filter(f => f.type === 'folder')
        .sort((a, b) => a.path.length - b.path.length);
      await Promise.all(
        dirs.map(d =>
          gitFileSystem
            .ensureDirectory(`${projectDir}${d.path}`)
            .catch(err => coreWarn(`[SyncManager] mkdir ${d.path} failed:`, err))
        )
      );

      // write files (batch to avoid too many concurrent ops)
      const files = filteredDbFiles.filter(f => f.type === 'file');
      coreInfo(`[SyncManager] Syncing ${files.length} files (diff)`);
      const BATCH = 10;
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async file => {
            try {
              const fsEntry = existingFsMap.get(file.path);

              // skip identical text files
              if (
                !file.isBufferArray &&
                fsEntry &&
                fsEntry.type === 'file' &&
                fsEntry.content === (file.content || '')
              ) {
                coreInfo(`[SyncManager] Skip unchanged: ${file.path}`);
                return;
              }

              if (file.isBufferArray && file.bufferContent) {
                await gitFileSystem.writeFile(
                  projectName,
                  file.path,
                  new Uint8Array(file.bufferContent)
                );
              } else {
                await gitFileSystem.writeFile(projectName, file.path, file.content || '');
              }
            } catch (err) {
              coreError(`[SyncManager] Failed to write ${file.path}:`, err);
            }
          })
        );
      }

      // remove FS-only files (final snapshot)
      try {
        const finalFs = await gitFileSystem.getAllFiles(projectName);
        for (const f of finalFs) {
          if (!dbFilePaths.has(f.path)) {
            try {
              coreInfo(`[SyncManager] Deleting FS-only: ${f.path}`);
              await gitFileSystem.deleteFile(projectName, f.path);
            } catch (err) {
              coreWarn(`[SyncManager] Failed to delete FS-only ${f.path}:`, err);
            }
          }
        }
      } catch (err) {
        coreWarn('[SyncManager] Failed to cleanup FS-only files:', err);
      }

      await gitFileSystem.flush();
      coreInfo('[SyncManager] Sync from IndexedDB to lightning-fs completed');
      // notify listeners that sync finished successfully
      this.emit('sync:stop', { projectId, projectName, direction: 'db->fs', success: true });
    } catch (error) {
      coreError('[SyncManager] Failed to sync from IndexedDB to lightning-fs:', error);
      // notify listeners that sync stopped with error
      this.emit('sync:stop', {
        projectId,
        projectName,
        direction: 'db->fs',
        success: false,
        error,
      });
      throw error;
    }
  }

  /**
   * lightning-fs → IndexedDB への同期
   * git revert/checkout等の操作後に呼び出される
   */
  async syncFromFSToIndexedDB(projectId: string, projectName: string): Promise<void> {
    // internal: syncing from lightning-fs to IndexedDB

    // notify listeners that a sync is starting
    this.emit('sync:start', { projectId, projectName, direction: 'fs->db' });

    try {
      // lightning-fsから全ファイルを取得
      const fsFiles = await gitFileSystem.getAllFiles(projectName);

      // IndexedDBから現在のファイル一覧を取得
      const dbFiles = await fileRepository.getFilesByPrefix(projectId, '/');

      // 差分を計算
      const fsFilePaths = new Set(fsFiles.map(f => f.path));
      const dbFilePaths = new Set(dbFiles.map(f => f.path));

      // 削除されたファイルをIndexedDBから削除
      for (const dbFile of dbFiles) {
        if (!fsFilePaths.has(dbFile.path)) {
          coreInfo(`[SyncManager] Deleting file from IndexedDB: ${dbFile.path}`);
          await fileRepository.deleteFile(dbFile.id);
        }
      }

      // 新規/更新されたファイルをIndexedDBに保存
      for (const fsFile of fsFiles) {
        const existingFile = dbFiles.find(f => f.path === fsFile.path);

        if (existingFile) {
          // 既存ファイルの更新
          if (fsFile.type === 'file' && existingFile.content !== fsFile.content) {
            coreInfo(`[SyncManager] Updating file in IndexedDB: ${fsFile.path}`);
            existingFile.content = fsFile.content;
            existingFile.updatedAt = new Date();
            await fileRepository.saveFile(existingFile);
          }
        } else {
          // 新規ファイルの作成
          coreInfo(`[SyncManager] Creating file in IndexedDB: ${fsFile.path}`);
          await fileRepository.createFile(projectId, fsFile.path, fsFile.content, fsFile.type);
        }
      }

      coreInfo('[SyncManager] Sync from lightning-fs to IndexedDB completed');
      this.emit('sync:stop', { projectId, projectName, direction: 'fs->db', success: true });
    } catch (error) {
      coreError('[SyncManager] Failed to sync from lightning-fs to IndexedDB:', error);
      this.emit('sync:stop', {
        projectId,
        projectName,
        direction: 'fs->db',
        success: false,
        error,
      });
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
    coreInfo(`[SyncManager] Syncing single file to lightning-fs: ${filePath} (${operation})`);
    // emit start for single-file sync
    this.emit('sync:start', { projectName, filePath, operation, direction: 'single:db->fs' });

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
      coreInfo(`[SyncManager] Single file sync completed: ${filePath}`);
      this.emit('sync:stop', {
        projectName,
        filePath,
        operation,
        direction: 'single:db->fs',
        success: true,
      });
    } catch (error) {
      coreError(`[SyncManager] Failed to sync single file ${filePath}:`, error);
      this.emit('sync:stop', {
        projectName,
        filePath,
        operation,
        direction: 'single:db->fs',
        success: false,
        error,
      });
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
    coreInfo('[SyncManager] Initializing project...');
    // emit start for project initialization
    this.emit('sync:start', { projectId, projectName, direction: 'init' });

    try {
      // lightning-fsのプロジェクトディレクトリを作成
      const projectDir = gitFileSystem.getProjectDir(projectName);
      await gitFileSystem.ensureDirectory(projectDir);

      // ファイルを同期
      await this.syncFromIndexedDBToFS(projectId, projectName);

      coreInfo('[SyncManager] Project initialization completed');
      this.emit('sync:stop', { projectId, projectName, direction: 'init', success: true });
    } catch (error) {
      coreError('[SyncManager] Failed to initialize project:', error);
      this.emit('sync:stop', { projectId, projectName, direction: 'init', success: false, error });
      throw error;
    }
  }
}

export const syncManager = SyncManager.getInstance();
