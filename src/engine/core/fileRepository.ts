/**
 * FileRepository - IndexedDBを管理する統一的なファイル操作API
 * 全てのファイル操作はこのクラスを経由する
 * 変更は自動的にGitFileSystemに非同期同期される
 *
 * パス形式: AppPath（先頭スラッシュ付き）
 * 例: "/src/hello.ts", "/", "/folder"
 * パス変換は pathResolver モジュールを使用
 */

import { gitFileSystem } from './gitFileSystem';
import { parseGitignore, isPathIgnored, GitIgnoreRule } from './gitignore';
import {
  toAppPath,
  toGitPath as pathToGitPath,
  fromGitPath as pathFromGitPath,
  getParentPath as pathGetParentPath,
} from './pathResolver';

import { LOCALSTORAGE_KEY } from '@/context/config';
import { coreInfo, coreWarn, coreError } from '@/engine/core/coreLogger';
import { initialFileContents } from '@/engine/initialFileContents';
import { Project, ProjectFile, ChatSpace, ChatSpaceMessage } from '@/types';

// ユニークID生成関数
const generateUniqueId = (prefix: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 12);
  const counter = Math.floor(Math.random() * 10000);
  return `${prefix}_${timestamp}_${random}_${counter}`;
};

// ファイル変更イベント型
export type FileChangeEvent = {
  type: 'create' | 'update' | 'delete';
  projectId: string;
  file: ProjectFile | { id: string; path: string }; // deleteの場合は最小限の情報
};

// イベントリスナー型
type FileChangeListener = (event: FileChangeEvent) => void;

/**
 * パスを正規化する（先頭スラッシュ付き、末尾スラッシュなし）
 * pathResolver の toAppPath を使用
 * @deprecated 直接 pathResolver の toAppPath を使用してください
 */
const normalizePath = toAppPath;

/**
 * 親パスを取得（正規化済み）
 * pathResolver の getParentPath を使用
 * @deprecated 直接 pathResolver の getParentPath を使用してください
 */
const getParentPath = pathGetParentPath;

export class FileRepository {
  private dbName = 'PyxisProjects';
  private version = 4;
  private db: IDBDatabase | null = null;
  private static instance: FileRepository | null = null;
  private projectNameCache: Map<string, string> = new Map(); // projectId -> projectName

  // .gitignore ルールのキャッシュ: projectId -> { rules(parsed), timestamp }
  private gitignoreCache: Map<string, { rules: GitIgnoreRule[]; ts: number }> = new Map();

  // キャッシュの TTL（ミリ秒） - 5分
  private readonly GITIGNORE_CACHE_TTL_MS = 5 * 60 * 1000;

  // イベントリスナー管理
  private listeners: Set<FileChangeListener> = new Set();

  private constructor() { }

  /**
   * シングルトンインスタンス取得
   */
  static getInstance(): FileRepository {
    if (!FileRepository.instance) {
      FileRepository.instance = new FileRepository();
    }
    return FileRepository.instance;
  }

  /**
   * ファイル変更イベントリスナーを追加
   */
  addChangeListener(listener: FileChangeListener): () => void {
    this.listeners.add(listener);
    // アンサブスクライブ関数を返す
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * ファイル変更イベントを発火
   */
  private emitChange(event: FileChangeEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        coreWarn('[FileRepository] Listener error:', error);
      }
    });
  }

  /**
   * データベース初期化
   */
  async init(): Promise<void> {
    if (this.db) return; // 既に初期化済み

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        coreError('[FileRepository] Database initialization failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        coreInfo('[FileRepository] Database initialized successfully');
        resolve();
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // プロジェクトストア
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          // 名前での一意制約を追加して、同名プロジェクトの重複作成を防ぐ
          projectStore.createIndex('name', 'name', { unique: true });
        } else {
          // 既存ストアに name インデックスが無ければ追加（DB バージョンアップ時）
          const projectStore = (event.target as IDBOpenDBRequest).transaction!.objectStore(
            'projects'
          );
          if (!projectStore.indexNames.contains('name')) {
            projectStore.createIndex('name', 'name', { unique: true });
          }
        }

        // ファイルストア
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('projectId', 'projectId', { unique: false });
          // compound index for efficient lookup by projectId + path
          // keyPath as array allows querying with [projectId, path]
          try {
            fileStore.createIndex('projectId_path', ['projectId', 'path'], { unique: false });
          } catch (e) {
            // ignore if not supported
          }
        } else {
          const fileStore = (event.target as IDBOpenDBRequest).transaction!.objectStore('files');
          if (!fileStore.indexNames.contains('projectId')) {
            fileStore.createIndex('projectId', 'projectId', { unique: false });
          }
          if (!fileStore.indexNames.contains('projectId_path')) {
            try {
              fileStore.createIndex('projectId_path', ['projectId', 'path'], { unique: false });
            } catch (e) {
              // ignore if not supported
            }
          }
        }

        // チャットスペースストア
        if (!db.objectStoreNames.contains('chatSpaces')) {
          const chatStore = db.createObjectStore('chatSpaces', { keyPath: 'id' });
          chatStore.createIndex('projectId', 'projectId', { unique: false });
        } else {
          const chatStore = (event.target as IDBOpenDBRequest).transaction!.objectStore(
            'chatSpaces'
          );
          if (!chatStore.indexNames.contains('projectId')) {
            chatStore.createIndex('projectId', 'projectId', { unique: false });
          }
        }
      };
    });
  }

  // ==================== プロジェクト操作 ====================

  /**
   * プロジェクト作成
   */
  async createProject(name: string, description?: string): Promise<Project> {
    await this.init();

    // プロジェクト名の重複チェック
    // まず既存プロジェクトがないか名前で確認
    const existingProjects = await this.getProjects();
    const existing = existingProjects.find(p => p.name === name);
    if (existing) {
      return existing;
    }

    const project: Project = {
      id: generateUniqueId('project'),
      name,
      description,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await this.saveProject(project);
    } catch (err: any) {
      // 名前重複などの制約エラーで保存に失敗した場合、既に作成されたプロジェクトを返す
      coreWarn(
        '[FileRepository] saveProject failed, attempting to recover by finding existing project:',
        err
      );
      const refreshed = await this.getProjects();
      const found = refreshed.find(p => p.name === name);
      if (found) {
        return found;
      }
      throw err; // 再スロー
    }

    // 初期ファイル・フォルダを再帰登録
    try {
      await this.registerInitialFiles(project.id, initialFileContents, '');
    } catch (e) {
      coreWarn('[FileRepository] registerInitialFiles failed (non-critical):', e);
    }

    // 初期チャットスペースを作成
    try {
      await this.createChatSpace(project.id, `${project.name} - 初期チャット`);
    } catch (error) {
      console.warn('[FileRepository] Failed to create initial chat space:', error);
    }

    return project;
  }

  /**
   * 空のプロジェクト作成（clone専用、デフォルトファイル無し）
   * GitFileSystemに.gitディレクトリを含めて作成される
   */
  async createEmptyProject(name: string, description?: string): Promise<Project> {
    await this.init();

    // プロジェクト名の重複チェック
    const existingProjects = await this.getProjects();
    if (existingProjects.some(project => project.name === name)) {
      throw new Error(`プロジェクト名 "${name}" は既に存在します。別の名前を使用してください。`);
    }

    const project: Project = {
      id: generateUniqueId('project'),
      name,
      description,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.saveProject(project);

    // 初期チャットスペースのみ作成（ファイルは作成しない）
    try {
      await this.createChatSpace(project.id, `${project.name} - 初期チャット`);
    } catch (error) {
      console.warn('[FileRepository] Failed to create initial chat space:', error);
    }

    return project;
  }

  /**
   * 初期ファイルを再帰的に登録
   */
  private async registerInitialFiles(
    projectId: string,
    obj: any,
    parentPath: string
  ): Promise<void> {
    for (const [name, value] of Object.entries(obj)) {
      // children, content, type などのプロパティ名はスキップ
      if (['children', 'content', 'type'].includes(name)) continue;
      const path = parentPath === '' ? `/${name}` : `${parentPath}/${name}`;
      if (typeof value === 'string') {
        // ファイル
        await this.createFile(projectId, path, value, 'file');
      } else if (typeof value === 'object' && value !== null) {
        const v: any = value;
        if (v.type === 'folder' || v.children) {
          await this.createFile(projectId, path, '', 'folder');
          if (v.children && typeof v.children === 'object') {
            await this.registerInitialFiles(projectId, v.children, path);
          }
        } else if (v.type === 'file' && typeof v.content === 'string') {
          await this.createFile(projectId, path, v.content, 'file');
        } else {
          // それ以外は従来通り再帰
          await this.createFile(projectId, path, '', 'folder');
          await this.registerInitialFiles(projectId, value, path);
        }
      }
    }
  }

  /**
   * プロジェクト保存
   */
  async saveProject(project: Project): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['projects'], 'readwrite');
      const store = transaction.objectStore('projects');
      const request = store.put({ ...project, updatedAt: new Date() });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * プロジェクト更新
   */
  async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const projects = await this.getProjects();
    const project = projects.find(p => p.id === projectId);

    if (!project) {
      throw new Error(`Project with id ${projectId} not found`);
    }

    const updatedProject = { ...project, ...updates, updatedAt: new Date() };
    await this.saveProject(updatedProject);
  }

  /**
   * 全プロジェクト取得
   */
  async getProjects(): Promise<Project[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['projects'], 'readonly');
      const store = transaction.objectStore('projects');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const projects = request.result.map((p: any) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        }));
        resolve(projects);
      };
    });
  }

  /**
   * プロジェクト削除
   */
  async deleteProject(projectId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // プロジェクト名取得
    const projects = await this.getProjects();
    const project = projects.find(p => p.id === projectId);
    const projectName = project?.name || '';

    return new Promise(async (resolve, reject) => {
      const transaction = this.db!.transaction(['projects', 'files', 'chatSpaces'], 'readwrite');

      // プロジェクトを削除
      const projectStore = transaction.objectStore('projects');
      projectStore.delete(projectId);

      // 関連ファイルを削除
      const fileStore = transaction.objectStore('files');
      const fileIndex = fileStore.index('projectId');
      const fileRequest = fileIndex.openCursor(IDBKeyRange.only(projectId));

      fileRequest.onsuccess = event => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      // 関連チャットスペースを削除
      const chatStore = transaction.objectStore('chatSpaces');
      const chatIndex = chatStore.index('projectId');
      const chatRequest = chatIndex.openCursor(IDBKeyRange.only(projectId));

      chatRequest.onsuccess = event => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = async () => {
        coreInfo(`[FileRepository] Project deleted from IndexedDB: ${projectName}`);

        // LocalStorageから最近使用したプロジェクトを削除（バックグラウンド）
        this.cleanupLocalStorage(projectId).catch(err => {
          coreWarn('[FileRepository] Failed to cleanup localStorage:', err);
        });

        // GitFileSystemからプロジェクトを削除（バックグラウンド）
        if (projectName) {
          this.deleteProjectFromGitFS(projectName).catch(err => {
            coreWarn('[FileRepository] Failed to delete project from GitFileSystem:', err);
          });
        }

        resolve();
      };
    });
  }

  /**
   * LocalStorageからプロジェクト関連データを削除
   */
  private async cleanupLocalStorage(projectId: string): Promise<void> {
    try {
      // 最近使用したプロジェクトから削除
      const recentProjectsStr = localStorage.getItem(LOCALSTORAGE_KEY.RECENT_PROJECTS);
      if (recentProjectsStr) {
        const recentProjects = JSON.parse(recentProjectsStr);
        const updatedProjects = recentProjects.filter((id: string) => id !== projectId);
        localStorage.setItem(LOCALSTORAGE_KEY.RECENT_PROJECTS, JSON.stringify(updatedProjects));
        coreInfo(`[FileRepository] Removed project ${projectId} from recent projects`);
      }
      // エディターレイアウトやターミナル履歴など、プロジェクト固有のlocalStorageキーを削除
      const keysToRemove = [
        `${LOCALSTORAGE_KEY.TERMINAL_HISTORY}${projectId}`,
        `${LOCALSTORAGE_KEY.EDITOR_LAYOUT}${projectId}`,
        LOCALSTORAGE_KEY.LAST_EXECUTE_FILE,
      ];
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      coreError('[FileRepository] Failed to cleanup localStorage:', error);
    }
  }

  /**
   * GitFileSystemからプロジェクトを削除（バックグラウンド）
   */
  private async deleteProjectFromGitFS(projectName: string): Promise<void> {
    try {
      await gitFileSystem.deleteProject(projectName);
      coreInfo(`[FileRepository] Deleted project from GitFileSystem: ${projectName}`);
    } catch (error) {
      coreError(`[FileRepository] Failed to delete project from GitFileSystem:`, error);
      throw error;
    }
  }

  // ==================== ファイル操作 ====================

  /**
   * ファイル作成（既存の場合は更新）
   * 自動的にGitFileSystemに非同期同期される
   * 親ディレクトリが存在しない場合は自動的に作成される
   */
  async createFile(
    projectId: string,
    path: string,
    content: string,
    type: 'file' | 'folder',
    isBufferArray?: boolean,
    bufferContent?: ArrayBuffer
  ): Promise<ProjectFile> {
    await this.init();

    // 既存ファイルをチェック
    const existingFiles = await this.getProjectFiles(projectId);
    const existingFile = existingFiles.find(f => f.path === path);

    if (existingFile) {
      // 既存ファイルを更新
      if (isBufferArray) {
        existingFile.content = '';
        existingFile.isBufferArray = true;
        existingFile.bufferContent = bufferContent;
      } else {
        existingFile.content = content;
        existingFile.isBufferArray = false;
        existingFile.bufferContent = undefined;
      }
      existingFile.updatedAt = new Date();
      await this.saveFile(existingFile); // saveFileが自動同期を実行
      return existingFile;
    }

    // 親ディレクトリの自動作成（再帰的）
    await this.ensureParentDirectories(projectId, path, existingFiles);

    // 新規ファイル作成
    const file: ProjectFile = {
      id: generateUniqueId('file'),
      projectId,
      path,
      name: path.split('/').pop() || '',
      content: isBufferArray ? '' : content,
      type,
      parentPath: path.substring(0, path.lastIndexOf('/')) || '/',
      createdAt: new Date(),
      updatedAt: new Date(),
      isBufferArray: !!isBufferArray,
      bufferContent: isBufferArray ? bufferContent : undefined,
    };

    await this.saveFile(file); // saveFileが自動同期を実行

    // ファイル作成イベントを発火
    this.emitChange({
      type: 'create',
      projectId,
      file,
    });

    return file;
  }

  /**
   * 親ディレクトリが存在しない場合は再帰的に作成
   */
  private async ensureParentDirectories(
    projectId: string,
    path: string,
    existingFiles: ProjectFile[]
  ): Promise<void> {
    // ルートパスの場合は何もしない
    if (path === '/' || !path.includes('/')) {
      return;
    }

    // 親パスを取得
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';

    // ルートの場合は終了
    if (parentPath === '/' || parentPath === '') {
      return;
    }

    // 親ディレクトリが既に存在するかチェック
    const parentExists = existingFiles.some(f => f.path === parentPath && f.type === 'folder');

    if (!parentExists) {
      coreInfo(`[FileRepository] Creating parent directory: ${parentPath}`);

      // 親の親を再帰的に作成
      await this.ensureParentDirectories(projectId, parentPath, existingFiles);

      // 親ディレクトリを作成（saveFileを直接呼び出して再帰を避ける）
      const parentFile: ProjectFile = {
        id: generateUniqueId('file'),
        projectId,
        path: parentPath,
        name: parentPath.split('/').pop() || '',
        content: '',
        type: 'folder',
        parentPath: parentPath.substring(0, parentPath.lastIndexOf('/')) || '/',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
        bufferContent: undefined,
      };

      await this.saveFile(parentFile);

      // existingFilesにも追加して、後続の処理で使えるようにする
      existingFiles.push(parentFile);

      // ファイル作成イベントを発火
      this.emitChange({
        type: 'create',
        projectId,
        file: parentFile,
      });
    }
  }

  /**
   * ファイル保存（自動的にGitFileSystemに非同期同期）
   */
  async saveFile(file: ProjectFile): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const updatedFile = { ...file, updatedAt: new Date() };
      const request = store.put(updatedFile);

      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        coreInfo(`[FileRepository] File saved: ${updatedFile.path} (${updatedFile.type})`);
        // .gitignore の変更ならキャッシュを更新/削除
        try {
          if (updatedFile.path === '/.gitignore') {
            // content が空の場合は削除とみなす
            if (!updatedFile.content || updatedFile.content.trim() === '') {
              this.clearGitignoreCache(updatedFile.projectId);
            } else {
              this.updateGitignoreCache(updatedFile.projectId, updatedFile.content);
            }
          }
        } catch (e) {
          coreWarn('[FileRepository] Failed to update gitignore cache after save:', e);
        }
        // GitFileSystemへの自動同期（非同期・バックグラウンド実行）
        this.syncToGitFileSystem(
          updatedFile.projectId,
          updatedFile.path,
          updatedFile.isBufferArray ? '' : updatedFile.content || '',
          'update',
          updatedFile.bufferContent,
          updatedFile.type
        ).catch(error => {
          coreWarn(
            '[FileRepository] Background sync to GitFileSystem failed (non-critical):',
            error
          );
        });

        // ファイル更新イベントを発火
        this.emitChange({
          type: 'update',
          projectId: updatedFile.projectId,
          file: updatedFile,
        });

        resolve();
      };
    });
  }

  /**
   * .gitignoreルールに基づいてパスを無視すべきかチェック
   */
  private async shouldIgnorePathForGit(projectId: string, path: string): Promise<boolean> {
    try {
      // プロジェクト名を取得
      let projectName = this.projectNameCache.get(projectId);
      if (!projectName) {
        const projects = await this.getProjects();
        const project = projects.find(p => p.id === projectId);
        if (project) {
          projectName = project.name;
          this.projectNameCache.set(projectId, projectName);
        } else {
          return false;
        }
      }

      // parsed rules を取得（キャッシュ利用）
      const parsedRules = await this.getParsedGitignoreRules(projectId);
      if (!parsedRules || parsedRules.length === 0) return false;

      const normalizedPath = path.replace(/^\/+/, '');
      const ignored = isPathIgnored(parsedRules, normalizedPath, false);
      if (ignored) coreInfo(`[FileRepository] Path "${path}" is ignored by .gitignore rules`);
      return ignored;
    } catch (error) {
      console.warn('[FileRepository] Error checking gitignore:', error);
      return false; // エラー時は無視しない（安全側に倒す）
    }
  }

  /**
   * キャッシュから解析済みの GitIgnore ルールを返す（なければ読み込む）
   */
  private async getParsedGitignoreRules(projectId: string): Promise<GitIgnoreRule[]> {
    const entry = this.gitignoreCache.get(projectId);
    if (entry && Date.now() - entry.ts < this.GITIGNORE_CACHE_TTL_MS) {
      return entry.rules;
    }

    // フォールバックで既存のロード経路を使う
    await this.getGitignoreRules(projectId); // これがキャッシュに parsed をセットする
    const refreshed = this.gitignoreCache.get(projectId);
    return refreshed ? refreshed.rules : [];
  }

  /**
   * 指定プロジェクトの .gitignore をキャッシュから取得、なければ読み込んでキャッシュする
   */
  private async getGitignoreRules(projectId: string): Promise<string[]> {
    // キャッシュが有効か確認
    const entry = this.gitignoreCache.get(projectId);
    if (entry && Date.now() - entry.ts < this.GITIGNORE_CACHE_TTL_MS) {
      return entry.rules.map(r => r.raw);
    }

    try {
      const files = await this.getProjectFiles(projectId);
      const gitignoreFile = files.find(f => f.path === '/.gitignore');
      if (!gitignoreFile || !gitignoreFile.content) {
        this.gitignoreCache.delete(projectId);
        return [];
      }

      const parsed = parseGitignore(gitignoreFile.content);
      this.gitignoreCache.set(projectId, { rules: parsed, ts: Date.now() });
      return parsed.map(r => r.raw);
    } catch (error) {
      console.warn('[FileRepository] Failed to load .gitignore for caching:', error);
      this.gitignoreCache.delete(projectId);
      return [];
    }
  }

  /**
   * .gitignore キャッシュを更新する（content が undefined なら削除）
   */
  private updateGitignoreCache(projectId: string, content?: string): void {
    if (!content) {
      this.gitignoreCache.delete(projectId);
      return;
    }
    const parsed = parseGitignore(content);
    this.gitignoreCache.set(projectId, { rules: parsed, ts: Date.now() });
  }

  /**
   * .gitignore キャッシュをクリア
   */
  private clearGitignoreCache(projectId: string): void {
    this.gitignoreCache.delete(projectId);
  }

  /**
   * GitFileSystemへの自動同期（非同期・バックグラウンド実行）
   * 同期後にGitキャッシュも自動的にフラッシュ
   * .gitignoreルールに基づいて無視すべきパスはスキップ
   */
  private async syncToGitFileSystem(
    projectId: string,
    path: string,
    content: string,
    operation: 'create' | 'update' | 'delete',
    bufferContent?: ArrayBuffer,
    fileType?: 'file' | 'folder'
  ): Promise<void> {
    coreInfo(
      `[FileRepository.syncToGitFileSystem] START - path: ${path}, operation: ${operation}, type: ${fileType}`
    );
    try {
      // .gitignoreチェック（全ての操作で適用）
      const shouldIgnore = await this.shouldIgnorePathForGit(projectId, path);
      if (shouldIgnore) {
        coreInfo(`[FileRepository] Skipping GitFileSystem sync for ignored path: ${path}`);
        return;
      }
      coreInfo(`[FileRepository.syncToGitFileSystem] Path not ignored, proceeding: ${path}`);

      // 遅延インポートで循環参照を回避
      const { syncManager } = await import('./syncManager');
      // プロジェクト名を取得
      let projectName = this.projectNameCache.get(projectId);
      if (!projectName) {
        const projects = await this.getProjects();
        const project = projects.find(p => p.id === projectId);
        if (project) {
          projectName = project.name;
          this.projectNameCache.set(projectId, projectName);
        } else {
          coreWarn('[FileRepository] Project not found for sync:', projectId);
          return;
        }
      }

      // フォルダの場合はディレクトリを作成
      if (fileType === 'folder' && operation !== 'delete') {
        coreInfo(`[FileRepository.syncToGitFileSystem] Creating directory: ${path}`);
        const projectDir = gitFileSystem.getProjectDir(projectName);
        const fullPath = `${projectDir}${path}`;
        await gitFileSystem.ensureDirectory(fullPath);
      } else {
        // ファイルの場合はSyncManagerを使用して同期
        coreInfo(`[FileRepository.syncToGitFileSystem] Calling syncSingleFileToFS for: ${path}`);
        await syncManager.syncSingleFileToFS(projectName, path, content, operation, bufferContent);
      }

      // Git変更検知のために自動的にキャッシュフラッシュ
      await gitFileSystem.flush();
      coreInfo(`[FileRepository.syncToGitFileSystem] COMPLETED - path: ${path}`);
    } catch (error) {
      coreError('[FileRepository] syncToGitFileSystem error:', error);
      throw error;
    }
  }

  /**
   * プロジェクトの全ファイル取得
   */
  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    if (!this.db) throw new Error('Database not initialized');

    // projectIdのバリデーション
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
      coreError('[FileRepository] Invalid projectId:', projectId);
      throw new Error(`Invalid projectId: ${projectId}`);
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => {
        console.error('[FileRepository] Failed to get project files:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const files = request.result.map((f: any) => ({
          ...f,
          createdAt: new Date(f.createdAt),
          updatedAt: new Date(f.updatedAt),
          bufferContent: f.isBufferArray ? f.bufferContent : undefined,
        }));
        resolve(files);
      };
    });
  }

  /**
   * FileRepository - 最適化されたバルク処理
   * git clone等の大量ファイル作成時に個別同期ではなく一括同期を使用
   */

  // fileRepository.ts に追加するメソッド

  /**
   * 複数ファイルを一括作成/更新する（最適化版 - 一括同期対応）
   * git clone等の大量ファイル作成時に使用
   * 個別同期ではなく、最後に一括同期を実行することで大幅に高速化
   *
   * @param projectId プロジェクトID
   * @param entries ファイルエントリの配列
   * @param skipSync true の場合、GitFileSystemへの同期をスキップ
   * @returns 作成されたファイルの配列
   */
  async createFilesBulk(
    projectId: string,
    entries: Array<{
      path: string;
      content: string;
      type: 'file' | 'folder';
      isBufferArray?: boolean;
      bufferContent?: ArrayBuffer;
    }>,
    skipSync: boolean = false
  ): Promise<ProjectFile[]> {
    if (!this.db) throw new Error('Database not initialized');

    // 🚀 最適化1: タイムスタンプを事前生成（ループ外で1回だけ）
    const timestamp = new Date();
    const createdFiles: ProjectFile[] = [];

    // 🚀 最適化2: プロジェクト名を事前取得（非同期待機を削減）
    let projectName: string | undefined;
    if (!skipSync) {
      projectName = this.projectNameCache.get(projectId);
      if (!projectName) {
        const projects = await this.getProjects();
        const project = projects.find(p => p.id === projectId);
        projectName = project?.name;
        if (projectName) {
          this.projectNameCache.set(projectId, projectName);
        }
      }
    }

    // 🚀 最適化3: バッチ処理（大量ファイル時にチャンク単位で処理）
    const BATCH_SIZE = 200;
    const batches: Array<typeof entries> = [];
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      batches.push(entries.slice(i, i + BATCH_SIZE));
    }

    // .gitignore チェック用
    let hasGitignore = false;
    let gitignoreContent = '';

    // 🚀 最適化5: 各バッチを並列処理（Promise.all）
    await Promise.all(
      batches.map(batch =>
        new Promise < void> ((resolve, reject) => {
          const transaction = this.db!.transaction(['files'], 'readwrite');
          const store = transaction.objectStore('files');

          transaction.onerror = () => reject(transaction.error);
          transaction.oncomplete = () => resolve();

          try {
            for (const entry of batch) {
              const file: ProjectFile = {
                id: generateUniqueId('file'),
                projectId,
                path: entry.path,
                name: entry.path.split('/').pop() || '',
                content: entry.isBufferArray ? '' : entry.content || '',
                type: entry.type || 'file',
                parentPath: entry.path.substring(0, entry.path.lastIndexOf('/')) || '/',
                createdAt: timestamp, // 事前生成されたタイムスタンプを使用
                updatedAt: timestamp, // 事前生成されたタイムスタンプを使用
                isBufferArray: !!entry.isBufferArray,
                bufferContent: entry.isBufferArray ? entry.bufferContent : undefined,
              };

              createdFiles.push(file);
              store.put(file);

              // .gitignore の検出
              if (entry.path === '/.gitignore' && !entry.isBufferArray) {
                hasGitignore = true;
                gitignoreContent = entry.content || '';
              }
            }
          } catch (error) {
            reject(error);
          }
        })
      )
    );

    // .gitignore キャッシュ更新
    if (hasGitignore) {
      try {
        if (!gitignoreContent || gitignoreContent.trim() === '') {
          this.clearGitignoreCache(projectId);
        } else {
          this.updateGitignoreCache(projectId, gitignoreContent);
        }
      } catch (e) {
        coreWarn('[FileRepository] Failed to update gitignore cache after bulk create:', e);
      }
    }

    // GitFileSystemへの同期
    if (!skipSync) {
      try {
        coreInfo(
          `[FileRepository] Starting optimized bulk sync for ${createdFiles.length} files...`
        );

        if (projectName) {
          const { syncManager } = await import('./syncManager');
          // 一括同期（100ファイルでも1回の処理）
          await syncManager.syncFromIndexedDBToFS(projectId, projectName);
          coreInfo('[FileRepository] Optimized bulk sync completed');
        } else {
          coreWarn('[FileRepository] Project name not found, skipping sync');
        }
      } catch (error) {
        coreError('[FileRepository] Optimized bulk sync error:', error);
        // 同期エラーでもファイル作成は成功しているので続行
      }
    } else {
      coreInfo('[FileRepository] Skipping sync as per skipSync flag.');
    }

    // 🚀 最適化4: イベント発火を非同期化（メイン処理をブロックしない）
    setTimeout(() => {
      for (const file of createdFiles) {
        this.emitChange({ type: 'create', projectId: file.projectId, file });
      }
    }, 0);

    return createdFiles;
  }

  /**
   * ファイル情報を取得（内部ヘルパー）
   */
  private async getFileById(fileId: string): Promise<ProjectFile | null> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(fileId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * プロジェクト内のパスでファイルを取得（path はプロジェクトルート相対パス）
   * 可能な限りインデックスを使って効率的に取得する。
   */
  async getFileByPath(projectId: string, path: string): Promise<ProjectFile | null> {
    if (!this.db) throw new Error('Database not initialized');

    // 正規化: leading slash を許容しているのでそのまま使う
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');

      // 優先: compound index があればそれを使う
      if (store.indexNames.contains('projectId_path')) {
        try {
          const idx = store.index('projectId_path');
          const req = idx.get([projectId, path]);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => resolve(req.result || null);
          return;
        } catch (e) {
          // fallthrough to fallback
        }
      }

      // フォールバック: projectId インデックスから全取得してフィルタ（従来の方法）
      if (store.indexNames.contains('projectId')) {
        const idx = store.index('projectId');
        const req = idx.getAll(projectId);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const files = req.result as ProjectFile[];
          const found = files.find(f => f.path === path) || null;
          resolve(found);
        };
        return;
      }

      // 最後の手段: 全件走査
      const allReq = store.getAll();
      allReq.onerror = () => reject(allReq.error);
      allReq.onsuccess = () => {
        const files = allReq.result as ProjectFile[];
        const found = files.find(f => f.projectId === projectId && f.path === path) || null;
        resolve(found);
      };
    });
  }

  /**
   * 指定プレフィックスに一致するファイルを取得（path はプロジェクトルート相対パス）
   * 例: prefix === '/src/' -> '/src/' 以下の全ファイルを返す
   */
  async getFilesByPrefix(projectId: string, prefix: string): Promise<ProjectFile[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');

      // 可能であれば projectId_path インデックスを使って範囲検索
      if (store.indexNames.contains('projectId_path')) {
        try {
          const idx = store.index('projectId_path');
          const lower: any = [projectId, prefix];
          const upper: any = [projectId, prefix + '\uffff'];
          const range = IDBKeyRange.bound(lower, upper);
          const req = idx.getAll(range);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const files = req.result.map((f: any) => ({
              ...f,
              createdAt: new Date(f.createdAt),
              updatedAt: new Date(f.updatedAt),
              bufferContent: f.isBufferArray ? f.bufferContent : undefined,
            }));
            resolve(files as ProjectFile[]);
          };
          return;
        } catch (e) {
          // fallthrough
        }
      }

      // フォールバック: projectId インデックスで絞ってから prefix フィルタ
      if (store.indexNames.contains('projectId')) {
        const idx = store.index('projectId');
        const req = idx.getAll(projectId);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const files = (req.result as any[])
            .filter(f => {
              if (!prefix || prefix === '') return true;
              return (f.path || '').startsWith(prefix);
            })
            .map(f => ({
              ...f,
              createdAt: new Date(f.createdAt),
              updatedAt: new Date(f.updatedAt),
              bufferContent: f.isBufferArray ? f.bufferContent : undefined,
            }));
          resolve(files as ProjectFile[]);
        };
        return;
      }

      // 最後の手段: 全件取得してフィルタ
      const allReq = store.getAll();
      allReq.onerror = () => reject(allReq.error);
      allReq.onsuccess = () => {
        const files = (allReq.result as any[])
          .filter(f => {
            if (!prefix || prefix === '') return true;
            return (f.path || '').startsWith(prefix);
          })
          .map(f => ({
            ...f,
            createdAt: new Date(f.createdAt),
            updatedAt: new Date(f.updatedAt),
            bufferContent: f.isBufferArray ? f.bufferContent : undefined,
          }));
        resolve(files as ProjectFile[]);
      };
    });
  }

  /**
   * 削除後の共通処理（gitignoreキャッシュクリア、同期、イベント発火）
   */
  private async handlePostDeletion(
    projectId: string,
    deletedFiles: ProjectFile[],
    isRecursive: boolean = false
  ): Promise<void> {
    // .gitignoreが削除されていればキャッシュをクリア
    const hasGitignore = deletedFiles.some(f => f.path === '/.gitignore');
    if (hasGitignore) {
      try {
        this.clearGitignoreCache(projectId);
      } catch (e) {
        coreWarn('[FileRepository] Failed to clear gitignore cache after delete:', e);
      }
    }

    // GitFileSystemへの同期
    try {
      if (isRecursive || deletedFiles.length > 5) {
        // 大量削除の場合は全体同期
        const { syncManager } = await import('./syncManager');
        let projectName = this.projectNameCache.get(projectId);
        if (!projectName) {
          const projects = await this.getProjects();
          const project = projects.find(p => p.id === projectId);
          projectName = project?.name;
          if (projectName) this.projectNameCache.set(projectId, projectName);
        }
        if (projectName) {
          await syncManager.syncFromIndexedDBToFS(projectId, projectName);
        }
      } else {
        // 少数削除の場合は個別同期
        for (const file of deletedFiles) {
          await this.syncToGitFileSystem(projectId, file.path, '', 'delete', undefined, file.type);
        }
      }
    } catch (error) {
      coreWarn('[FileRepository] Post-deletion sync failed (non-critical):', error);
    }

    // イベント発火
    for (const file of deletedFiles) {
      this.emitChange({
        type: 'delete',
        projectId,
        file: { id: file.id, path: file.path },
      });
    }
  }

  /**
   * ファイル削除（単一または再帰）
   * フォルダの場合は自動的に配下も削除される
   */
  async deleteFile(fileId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fileToDelete = await this.getFileById(fileId);
    if (!fileToDelete) {
      throw new Error(`File with id ${fileId} not found`);
    }

    const { projectId, path, type } = fileToDelete;
    const deletedFiles: ProjectFile[] = [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const index = store.index('projectId');

      if (type === 'folder') {
        // フォルダの場合は配下も含めて削除
        const request = index.getAll(projectId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const allFiles = request.result as ProjectFile[];
          for (const f of allFiles) {
            if (f.path === path || f.path.startsWith(path + '/')) {
              store.delete(f.id);
              deletedFiles.push(f);
            }
          }
        };
      } else {
        // ファイルの場合は単一削除
        const request = store.delete(fileId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          deletedFiles.push(fileToDelete);
        };
      }

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = async () => {
        await this.handlePostDeletion(projectId, deletedFiles, type === 'folder');
        resolve();
      };
    });
  }

  /**
   * 指定プレフィックス（ディレクトリ）に一致するファイルを一括削除
   * @deprecated deleteFile を使用してください（フォルダを渡せば自動的に再帰削除されます）
   */
  async deleteFilesByPrefix(projectId: string, prefix: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const deletedFiles: ProjectFile[] = [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const files = request.result as ProjectFile[];
        for (const f of files) {
          if (f.path === prefix || f.path.startsWith(prefix + '/')) {
            store.delete(f.id);
            deletedFiles.push(f);
          }
        }
      };

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = async () => {
        await this.handlePostDeletion(projectId, deletedFiles, true);
        resolve();
      };
    });
  }

  /**
   * AIレビュー状態をクリア
   */
  async clearAIReview(projectId: string, filePath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const files = request.result;
        const file = files.find((f: ProjectFile) => f.path === filePath);

        if (file) {
          file.aiReviewStatus = undefined;
          file.aiReviewComments = undefined;
          store.put(file);
        }

        resolve();
      };
    });
  }

  // ==================== チャットスペース操作 ====================

  /**
   * チャットスペース作成
   */
  async createChatSpace(projectId: string, name: string): Promise<ChatSpace> {
    await this.init();

    const chatSpace: ChatSpace = {
      id: generateUniqueId('chatspace'),
      name,
      projectId,
      messages: [],
      selectedFiles: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chatSpaces'], 'readwrite');
      const store = transaction.objectStore('chatSpaces');
      const request = store.add(chatSpace);

      request.onsuccess = () => resolve(chatSpace);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * チャットスペース保存
   */
  async saveChatSpace(chatSpace: ChatSpace): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chatSpaces'], 'readwrite');
      const store = transaction.objectStore('chatSpaces');
      const request = store.put({ ...chatSpace, updatedAt: new Date() });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * プロジェクトの全チャットスペース取得
   */
  async getChatSpaces(projectId: string): Promise<ChatSpace[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chatSpaces'], 'readonly');
      const store = transaction.objectStore('chatSpaces');
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const chatSpaces = request.result.map((cs: any) => ({
          ...cs,
          createdAt: new Date(cs.createdAt),
          updatedAt: new Date(cs.updatedAt),
        }));
        resolve(chatSpaces);
      };
    });
  }

  /**
   * チャットスペース削除
   */
  async deleteChatSpace(chatSpaceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chatSpaces'], 'readwrite');
      const store = transaction.objectStore('chatSpaces');
      const request = store.delete(chatSpaceId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * チャットスペースにメッセージ追加
   */
  async addMessageToChatSpace(
    chatSpaceId: string,
    message: Omit<ChatSpaceMessage, 'id'>
  ): Promise<ChatSpaceMessage> {
    if (!this.db) throw new Error('Database not initialized');

    // まずチャットスペースを取得
    const transaction = this.db.transaction(['chatSpaces'], 'readwrite');
    const store = transaction.objectStore('chatSpaces');
    const chatSpaceRequest = store.get(chatSpaceId);

    return new Promise((resolve, reject) => {
      chatSpaceRequest.onsuccess = () => {
        const chatSpace = chatSpaceRequest.result;

        if (!chatSpace) {
          reject(new Error(`Chat space with id ${chatSpaceId} not found`));
          return;
        }

        const newMessage: ChatSpaceMessage = {
          ...message,
          id: generateUniqueId('message'),
        };

        chatSpace.messages.push(newMessage);
        chatSpace.updatedAt = new Date();

        const putRequest = store.put(chatSpace);
        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = () => resolve(newMessage);
      };

      chatSpaceRequest.onerror = () => reject(chatSpaceRequest.error);
    });
  }

  /**
   * チャットスペース内の既存メッセージを更新する（部分更新をサポート）
   * 主に editResponse を差し替える用途で使う想定
   */
  async updateChatSpaceMessage(
    chatSpaceId: string,
    messageId: string,
    updates: Partial<ChatSpaceMessage>
  ): Promise<ChatSpaceMessage | null> {
    if (!this.db) throw new Error('Database not initialized');

    const transaction = this.db.transaction(['chatSpaces'], 'readwrite');
    const store = transaction.objectStore('chatSpaces');
    const chatSpaceRequest = store.get(chatSpaceId);

    return new Promise((resolve, reject) => {
      chatSpaceRequest.onsuccess = () => {
        const chatSpace = chatSpaceRequest.result as ChatSpace | undefined;
        if (!chatSpace) {
          resolve(null);
          return;
        }

        const idx = (chatSpace.messages || []).findIndex(
          (m: ChatSpaceMessage) => m.id === messageId
        );
        if (idx === -1) {
          resolve(null);
          return;
        }

        const existing = chatSpace.messages[idx];
        const updatedMessage: ChatSpaceMessage = {
          ...existing,
          ...updates,
          // updated timestamp unless explicitly provided
          timestamp: updates.timestamp ? updates.timestamp : new Date(),
        };

        chatSpace.messages[idx] = updatedMessage;
        chatSpace.updatedAt = new Date();

        const putRequest = store.put(chatSpace);
        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = () => resolve(updatedMessage);
      };

      chatSpaceRequest.onerror = () => reject(chatSpaceRequest.error);
    });
  }

  /**
   * チャットスペースの選択ファイル更新
   */
  async updateChatSpaceSelectedFiles(chatSpaceId: string, selectedFiles: string[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise(async (resolve, reject) => {
      const transaction = this.db!.transaction(['chatSpaces'], 'readwrite');
      const store = transaction.objectStore('chatSpaces');
      const request = store.get(chatSpaceId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const chatSpace = request.result;
        if (chatSpace) {
          chatSpace.selectedFiles = selectedFiles;
          chatSpace.updatedAt = new Date();
          store.put(chatSpace);
        }
        resolve();
      };
    });
  }

  /**
   * チャットスペース名変更
   */
  async renameChatSpace(chatSpaceId: string, newName: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['chatSpaces'], 'readwrite');
      const store = transaction.objectStore('chatSpaces');
      const request = store.get(chatSpaceId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const chatSpace = request.result;
        if (chatSpace) {
          chatSpace.name = newName;
          chatSpace.updatedAt = new Date();
          store.put(chatSpace);
        }
        resolve();
      };
    });
  }
}

/**
 * fileRepository用パス → Git API用パスに変換
 * pathResolver の toGitPath を使用
 * @deprecated 直接 pathResolver の toGitPath を使用してください
 */
const toGitPath = pathToGitPath;

/**
 * Git API用パス → fileRepository用パスに変換
 * pathResolver の fromGitPath を使用
 * @deprecated 直接 pathResolver の fromGitPath を使用してください
 */
const fromGitPath = pathFromGitPath;

// エクスポート
export const fileRepository = FileRepository.getInstance();
export { normalizePath, getParentPath, toGitPath, fromGitPath };

// 新しいパス解決モジュールを再エクスポート
export * from './pathResolver';
