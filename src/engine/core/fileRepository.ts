/**
 * FileRepository - IndexedDBを管理する統一的なファイル操作API
 * 全てのファイル操作はこのクラスを経由する
 * 変更は自動的にGitFileSystemに非同期同期される
 */

import { Project, ProjectFile, ChatSpace, ChatSpaceMessage } from '@/types';
import { initialFileContents } from '@/engine/initialFileContents';
import { LOCALSTORAGE_KEY } from '@/context/config';
import { coreInfo, coreWarn, coreError } from '@/engine/core/coreLogger';

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

export class FileRepository {
  private dbName = 'PyxisProjects';
  private version = 2;
  private db: IDBDatabase | null = null;
  private static instance: FileRepository | null = null;
  private projectNameCache: Map<string, string> = new Map(); // projectId -> projectName

  // イベントリスナー管理
  private listeners: Set<FileChangeListener> = new Set();

  private constructor() {}

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
          db.createObjectStore('projects', { keyPath: 'id' });
        }

        // ファイルストア
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('projectId', 'projectId', { unique: false });
        }

        // チャットスペースストア
        if (!db.objectStoreNames.contains('chatSpaces')) {
          const chatStore = db.createObjectStore('chatSpaces', { keyPath: 'id' });
          chatStore.createIndex('projectId', 'projectId', { unique: false });
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

    // 初期ファイル・フォルダを再帰登録
    await this.registerInitialFiles(project.id, initialFileContents, '');

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
      const { gitFileSystem } = await import('./gitFileSystem');
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

      // .gitignoreを読み込み
      const gitignorePath = `${path.startsWith('/') ? '' : '/'}${projectName}/.gitignore`;
      const files = await this.getProjectFiles(projectId);
      const gitignoreFile = files.find(f => f.path === '/.gitignore');

      if (!gitignoreFile || !gitignoreFile.content) {
        return false; // .gitignoreがない場合は無視しない
      }

      const gitignoreRules = gitignoreFile.content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')); // コメントと空行を除外

      // パスの正規化（先頭の/を削除）
      const normalizedPath = path.replace(/^\/+/, '');

      // 各ルールをチェック
      for (const rule of gitignoreRules) {
        if (this.matchGitignoreRule(normalizedPath, rule)) {
          coreInfo(`[FileRepository] Path "${path}" matched gitignore rule: "${rule}"`);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.warn('[FileRepository] Error checking gitignore:', error);
      return false; // エラー時は無視しない（安全側に倒す）
    }
  }

  /**
   * .gitignoreルールとパスをマッチング（簡易実装）
   */
  private matchGitignoreRule(path: string, rule: string): boolean {
    // ディレクトリルール（末尾が/）
    if (rule.endsWith('/')) {
      const dirName = rule.slice(0, -1);
      return path === dirName || path.startsWith(dirName + '/');
    }

    // ワイルドカードルール（*を含む）
    if (rule.includes('*')) {
      const regexPattern = rule.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(path);
    }

    // 完全一致または部分一致
    return path === rule || path.startsWith(rule + '/') || path.endsWith('/' + rule);
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
    coreInfo(`[FileRepository.syncToGitFileSystem] START - path: ${path}, operation: ${operation}, type: ${fileType}`);
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
      const { gitFileSystem } = await import('./gitFileSystem');

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
   * 複数ファイルを一括作成/更新する（パフォーマンス向上用）
   * entries: { path, content, type, isBufferArray?, bufferContent? }
   */
  async createFilesBulk(projectId: string, entries: Array<any>): Promise<ProjectFile[]> {
    if (!this.db) throw new Error('Database not initialized');

    const createdFiles: ProjectFile[] = [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = async () => {
        // After DB commit, asynchronously sync to GitFileSystem and emit events
        for (const file of createdFiles) {
          try {
            // call background sync (non-blocking)
            this.syncToGitFileSystem(file.projectId, file.path, file.isBufferArray ? '' : file.content || '', 'create', file.bufferContent, file.type).catch(err => {
              coreWarn('[FileRepository] Background bulk sync failed (non-critical):', err);
            });

            this.emitChange({ type: 'create', projectId: file.projectId, file });
          } catch (err) {
            coreWarn('[FileRepository] createFilesBulk post-sync error:', err);
          }
        }
        resolve(createdFiles);
      };

      try {
        for (const entry of entries) {
          const existingRequest = store.index('projectId').getAll(entry.projectId || projectId);
          // We will not wait for existingRequest; instead, create a new ProjectFile for each entry
          const file: ProjectFile = {
            id: generateUniqueId('file'),
            projectId,
            path: entry.path,
            name: entry.path.split('/').pop() || '',
            content: entry.isBufferArray ? '' : entry.content || '',
            type: entry.type || 'file',
            parentPath: entry.path.substring(0, entry.path.lastIndexOf('/')) || '/',
            createdAt: new Date(),
            updatedAt: new Date(),
            isBufferArray: !!entry.isBufferArray,
            bufferContent: entry.isBufferArray ? entry.bufferContent : undefined,
          };

          createdFiles.push(file);
          store.put(file);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * ファイル削除（自動的にGitFileSystemに非同期同期）
   */
  async deleteFile(fileId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // 削除前にファイル情報を取得（同期用）
    const fileToDelete = await new Promise<ProjectFile | null>((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(fileId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.delete(fileId);

      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        if (fileToDelete) {
          // GitFileSystemへの自動同期（削除）
          this.syncToGitFileSystem(fileToDelete.projectId, fileToDelete.path, '', 'delete', undefined, fileToDelete.type).catch(
            error => {
              console.warn('[FileRepository] Background delete sync failed (non-critical):', error);
            }
          );

          // ファイル削除イベントを発火
          this.emitChange({
            type: 'delete',
            projectId: fileToDelete.projectId,
            file: { id: fileToDelete.id, path: fileToDelete.path },
          });
        }
        resolve();
      };
    });
  }

  /**
   * 指定プレフィックス（ディレクトリ）に一致するファイルを一括削除する
   */
  async deleteFilesByPrefix(projectId: string, prefix: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

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
            // fire delete sync/event asynchronously after transaction
          }
        }
      };

      transaction.oncomplete = async () => {
        // After deletion, background sync for deleted files is handled in deleteFile when used individually.
        // Here we emit a generic change event to indicate mass deletion (listeners may resync)
        this.emitChange({ type: 'delete', projectId, file: { id: '', path: prefix } as any });
        resolve();
      };

      transaction.onerror = () => reject(transaction.error);
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

// シングルトンインスタンスをエクスポート
export const fileRepository = FileRepository.getInstance();
