/**
 * FileRepository - Storage Adapter を使用した統一的なファイル操作API
 * 全てのファイル操作はこのクラスを経由する
 * 変更は自動的にGitFileSystemに非同期同期される
 *
 * パス形式: AppPath（先頭スラッシュ付き）
 * 例: "/src/hello.ts", "/", "/folder"
 * パス変換は pathResolver モジュールを使用
 *
 * 環境に応じて適切なストレージアダプターを使用:
 * - Browser: IndexedDB
 * - Node.js/Test: InMemory
 */

import { gitFileSystem } from './gitFileSystem';
import { type GitIgnoreRule, isPathIgnored, parseGitignore } from './gitignore';
import {
  fromGitPath as pathFromGitPath,
  getParentPath as pathGetParentPath,
  toGitPath as pathToGitPath,
  toAppPath,
} from './pathUtils';
import { getStorageAdapter, isBrowser } from './storage';
import type { IStorageAdapter } from './storage/types';

import { LOCALSTORAGE_KEY } from '@/constants/config';
import { coreError, coreInfo, coreWarn } from '@/engine/core/coreLogger';
import { initialFileContents } from '@/engine/initialFileContents';
import {
  addMessageToChatSpace as chatAddMessageToChatSpace,
  createChatSpace as chatCreateChatSpace,
  deleteChatSpace as chatDeleteChatSpace,
  deleteChatSpacesForProject as chatDeleteChatSpacesForProject,
  getChatSpaces as chatGetChatSpaces,
  renameChatSpace as chatRenameChatSpace,
  saveChatSpace as chatSaveChatSpace,
  updateChatSpaceMessage as chatUpdateChatSpaceMessage,
  updateChatSpaceSelectedFiles as chatUpdateChatSpaceSelectedFiles,
} from '@/engine/storage/chatStorageAdapter';
import type { ChatSpace, ChatSpaceMessage, Project, ProjectFile } from '@/types';

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
  file: ProjectFile | { id: string; path: string };
};

// イベントリスナー型
type FileChangeListener = (event: FileChangeEvent) => void;

/**
 * パスを正規化する（先頭スラッシュ付き、末尾スラッシュなし）
 * @deprecated 直接 pathResolver の toAppPath を使用してください
 */
const normalizePath = toAppPath;

/**
 * 親パスを取得（正規化済み）
 * @deprecated 直接 pathResolver の getParentPath を使用してください
 */
const getParentPath = pathGetParentPath;

export class FileRepository {
  private storage: IStorageAdapter | null = null;
  private static instance: FileRepository | null = null;
  private projectNameCache: Map<string, string> = new Map();
  private initPromise: Promise<void> | null = null;

  // .gitignore ルールのキャッシュ
  private gitignoreCache: Map<string, { rules: GitIgnoreRule[]; ts: number }> = new Map();
  private readonly GITIGNORE_CACHE_TTL_MS = 5 * 60 * 1000;

  // イベントリスナー管理
  private listeners: Set<FileChangeListener> = new Set();

  private constructor() {}

  static getInstance(): FileRepository {
    if (!FileRepository.instance) {
      FileRepository.instance = new FileRepository();
    }
    return FileRepository.instance;
  }

  addChangeListener(listener: FileChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(event: FileChangeEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        coreWarn('[FileRepository] Listener error:', error);
      }
    });
  }

  async init(): Promise<void> {
    if (this.storage?.isInitialized()) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.storage = await getStorageAdapter();
      coreInfo('[FileRepository] Storage adapter initialized');
    })();

    return this.initPromise;
  }

  // ==================== プロジェクト操作 ====================

  async createProject(name: string, description?: string): Promise<Project> {
    await this.init();

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
      coreWarn('[FileRepository] saveProject failed, attempting to recover:', err);
      const refreshed = await this.getProjects();
      const found = refreshed.find(p => p.name === name);
      if (found) return found;
      throw err;
    }

    try {
      await this.registerInitialFiles(project.id, initialFileContents, '');
    } catch (e) {
      coreWarn('[FileRepository] registerInitialFiles failed (non-critical):', e);
    }

    try {
      await this.createChatSpace(project.id, `${project.name} - 初期チャット`);
    } catch (error) {
      console.warn('[FileRepository] Failed to create initial chat space:', error);
    }

    return project;
  }

  async createEmptyProject(name: string, description?: string): Promise<Project> {
    await this.init();

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

    try {
      await this.createChatSpace(project.id, `${project.name} - 初期チャット`);
    } catch (error) {
      console.warn('[FileRepository] Failed to create initial chat space:', error);
    }

    return project;
  }

  private async registerInitialFiles(
    projectId: string,
    obj: any,
    parentPath: string
  ): Promise<void> {
    for (const [name, value] of Object.entries(obj)) {
      if (['children', 'content', 'type'].includes(name)) continue;
      const path = parentPath === '' ? `/${name}` : `${parentPath}/${name}`;
      if (typeof value === 'string') {
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
          await this.createFile(projectId, path, '', 'folder');
          await this.registerInitialFiles(projectId, value, path);
        }
      }
    }
  }

  async saveProject(project: Project): Promise<void> {
    await this.init();
    await this.storage!.projects.save({ ...project, updatedAt: new Date() });
  }

  async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
    await this.init();
    const project = await this.storage!.projects.getById(projectId);
    if (!project) {
      throw new Error(`Project with id ${projectId} not found`);
    }
    const updatedProject = { ...project, ...updates, updatedAt: new Date() };
    await this.saveProject(updatedProject);
  }

  async getProjects(): Promise<Project[]> {
    await this.init();
    return this.storage!.projects.getAll();
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.init();

    const project = await this.storage!.projects.getById(projectId);
    const projectName = project?.name || '';

    // Delete all files for the project
    await this.storage!.files.deleteByProject(projectId);

    // Delete the project
    await this.storage!.projects.delete(projectId);

    coreInfo(`[FileRepository] Project deleted: ${projectName}`);

    // Delete chat spaces
    try {
      await chatDeleteChatSpacesForProject(projectId);
    } catch (err) {
      coreWarn('[FileRepository] Failed to delete chat spaces via adapter:', err);
    }

    // Cleanup localStorage (browser only)
    if (isBrowser()) {
      this.cleanupLocalStorage(projectId).catch(err => {
        coreWarn('[FileRepository] Failed to cleanup localStorage:', err);
      });
    }

    // Delete from GitFileSystem (browser only)
    if (isBrowser() && projectName) {
      this.deleteProjectFromGitFS(projectName).catch(err => {
        coreWarn('[FileRepository] Failed to delete project from GitFileSystem:', err);
      });
    }
  }

  private async cleanupLocalStorage(projectId: string): Promise<void> {
    try {
      const recentProjectsStr = localStorage.getItem(LOCALSTORAGE_KEY.RECENT_PROJECTS);
      if (recentProjectsStr) {
        const recentProjects = JSON.parse(recentProjectsStr);
        const updatedProjects = recentProjects.filter((id: string) => id !== projectId);
        localStorage.setItem(LOCALSTORAGE_KEY.RECENT_PROJECTS, JSON.stringify(updatedProjects));
      }
      const keysToRemove = [LOCALSTORAGE_KEY.LAST_EXECUTE_FILE];
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      coreError('[FileRepository] Failed to cleanup localStorage:', error);
    }
  }

  private async deleteProjectFromGitFS(projectName: string): Promise<void> {
    try {
      await gitFileSystem.deleteProject(projectName);
      coreInfo(`[FileRepository] Deleted project from GitFileSystem: ${projectName}`);
    } catch (error) {
      coreError('[FileRepository] Failed to delete project from GitFileSystem:', error);
      throw error;
    }
  }

  // ==================== ファイル操作 ====================

  async createFile(
    projectId: string,
    path: string,
    content: string,
    type: 'file' | 'folder',
    isBufferArray?: boolean,
    bufferContent?: ArrayBuffer
  ): Promise<ProjectFile> {
    await this.init();

    const normalizedPath = toAppPath(path);
    const existingFile = await this.storage!.files.getByPath(projectId, normalizedPath);

    if (existingFile) {
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
      await this.saveFile(existingFile);
      return existingFile;
    }

    const existingFiles = await this.storage!.files.getAllByProject(projectId);
    await this.ensureParentDirectories(projectId, normalizedPath, existingFiles);

    const file: ProjectFile = {
      id: generateUniqueId('file'),
      projectId,
      path: normalizedPath,
      name: normalizedPath.split('/').pop() || '',
      content: isBufferArray ? '' : content,
      type,
      parentPath: normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) || '/',
      createdAt: new Date(),
      updatedAt: new Date(),
      isBufferArray: !!isBufferArray,
      bufferContent: isBufferArray ? bufferContent : undefined,
    };

    await this.saveFile(file);

    this.emitChange({ type: 'create', projectId, file });

    return file;
  }

  private async ensureParentDirectories(
    projectId: string,
    path: string,
    existingFiles: ProjectFile[]
  ): Promise<void> {
    if (path === '/' || !path.includes('/')) return;

    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
    if (parentPath === '/' || parentPath === '') return;

    const parentExists = existingFiles.some(f => f.path === parentPath && f.type === 'folder');

    if (!parentExists) {
      coreInfo(`[FileRepository] Creating parent directory: ${parentPath}`);
      await this.ensureParentDirectories(projectId, parentPath, existingFiles);

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
      existingFiles.push(parentFile);

      this.emitChange({ type: 'create', projectId, file: parentFile });
    }
  }

  async saveFile(file: ProjectFile): Promise<void> {
    await this.init();

    const updatedFile = { ...file, updatedAt: new Date() };
    await this.storage!.files.save(updatedFile);

    coreInfo(`[FileRepository] File saved: ${updatedFile.path} (${updatedFile.type})`);

    // Update gitignore cache
    try {
      if (updatedFile.path === '/.gitignore') {
        if (!updatedFile.content || updatedFile.content.trim() === '') {
          this.clearGitignoreCache(updatedFile.projectId);
        } else {
          this.updateGitignoreCache(updatedFile.projectId, updatedFile.content);
        }
      }
    } catch (e) {
      coreWarn('[FileRepository] Failed to update gitignore cache:', e);
    }

    // Sync to GitFileSystem (browser only)
    if (isBrowser()) {
      this.syncToGitFileSystem(
        updatedFile.projectId,
        updatedFile.path,
        updatedFile.isBufferArray ? '' : updatedFile.content || '',
        'update',
        updatedFile.bufferContent,
        updatedFile.type
      ).catch(error => {
        coreWarn('[FileRepository] Background sync failed (non-critical):', error);
      });
    }

    this.emitChange({ type: 'update', projectId: updatedFile.projectId, file: updatedFile });
  }

  async saveFileByPath(projectId: string, path: string, content: string): Promise<void> {
    await this.init();

    const normalizedPath = toAppPath(path);
    const existingFile = await this.getFileByPath(projectId, normalizedPath);

    if (existingFile) {
      const updatedFile = {
        ...existingFile,
        content,
        isBufferArray: false,
        bufferContent: undefined,
        updatedAt: new Date(),
      };
      await this.saveFile(updatedFile);
    } else {
      await this.createFile(projectId, normalizedPath, content, 'file');
    }
  }

  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    await this.init();

    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
      coreError('[FileRepository] Invalid projectId:', projectId);
      throw new Error(`Invalid projectId: ${projectId}`);
    }

    return this.storage!.files.getAllByProject(projectId);
  }

  async getFilesByPrefix(projectId: string, prefix: string): Promise<ProjectFile[]> {
    await this.init();
    return this.storage!.files.getByPrefix(projectId, prefix);
  }

  async getFileById(fileId: string): Promise<ProjectFile | null> {
    await this.init();
    return this.storage!.files.getById(fileId);
  }

  async getFileByPath(projectId: string, path: string): Promise<ProjectFile | null> {
    await this.init();
    const normalizedPath = toAppPath(path);
    return this.storage!.files.getByPath(projectId, normalizedPath);
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.init();

    const fileToDelete = await this.getFileById(fileId);
    if (!fileToDelete) {
      throw new Error(`File with id ${fileId} not found`);
    }

    const { projectId, path, type } = fileToDelete;
    const deletedFiles: ProjectFile[] = [];

    if (type === 'folder') {
      const allFiles = await this.storage!.files.getAllByProject(projectId);
      for (const f of allFiles) {
        if (f.path === path || f.path.startsWith(path + '/')) {
          await this.storage!.files.delete(f.id);
          deletedFiles.push(f);
        }
      }
    } else {
      await this.storage!.files.delete(fileId);
      deletedFiles.push(fileToDelete);
    }

    await this.handlePostDeletion(projectId, deletedFiles, type === 'folder');
  }

  async deleteFiles(projectId: string, paths: string[]): Promise<void> {
    await this.init();

    const deletedFiles: ProjectFile[] = [];
    const allFiles = await this.storage!.files.getAllByProject(projectId);

    for (const path of paths) {
      const normalizedPath = toAppPath(path);
      for (const f of allFiles) {
        if (f.path === normalizedPath || f.path.startsWith(normalizedPath + '/')) {
          if (!deletedFiles.find(d => d.id === f.id)) {
            await this.storage!.files.delete(f.id);
            deletedFiles.push(f);
          }
        }
      }
    }

    await this.handlePostDeletion(projectId, deletedFiles, paths.length > 1);
  }

  private async handlePostDeletion(
    projectId: string,
    deletedFiles: ProjectFile[],
    isRecursive: boolean
  ): Promise<void> {
    // Clear gitignore cache if .gitignore was deleted
    if (deletedFiles.some(f => f.path === '/.gitignore')) {
      try {
        this.clearGitignoreCache(projectId);
      } catch (e) {
        coreWarn('[FileRepository] Failed to clear gitignore cache:', e);
      }
    }

    // Sync to GitFileSystem (browser only)
    if (isBrowser()) {
      try {
        if (isRecursive || deletedFiles.length > 5) {
          const { syncManager } = await import('./syncManager');
          let projectName = this.projectNameCache.get(projectId);
          if (!projectName) {
            const project = await this.storage!.projects.getById(projectId);
            projectName = project?.name;
            if (projectName) this.projectNameCache.set(projectId, projectName);
          }
          if (projectName) {
            await syncManager.syncFromIndexedDBToFS(projectId, projectName);
          }
        } else {
          for (const file of deletedFiles) {
            await this.syncToGitFileSystem(
              projectId,
              file.path,
              '',
              'delete',
              undefined,
              file.type
            );
          }
        }
      } catch (error) {
        coreWarn('[FileRepository] Post-deletion sync failed:', error);
      }
    }

    // Emit events
    for (const file of deletedFiles) {
      this.emitChange({ type: 'delete', projectId, file: { id: file.id, path: file.path } });
    }
  }

  async clearAIReview(projectId: string, filePath: string): Promise<void> {
    await this.init();

    const normalizedPath = toAppPath(filePath);
    const file = await this.storage!.files.getByPath(projectId, normalizedPath);

    if (file) {
      file.aiReviewStatus = undefined;
      file.aiReviewComments = undefined;
      await this.storage!.files.save(file);
    }
  }

  // ==================== GitIgnore ====================

  private async shouldIgnorePathForGit(projectId: string, path: string): Promise<boolean> {
    try {
      const parsedRules = await this.getParsedGitignoreRules(projectId);
      if (!parsedRules || parsedRules.length === 0) return false;

      const normalizedPath = path.replace(/^\/+/, '');
      const ignored = isPathIgnored(parsedRules, normalizedPath, false);
      if (ignored) coreInfo(`[FileRepository] Path "${path}" is ignored by .gitignore`);
      return ignored;
    } catch (error) {
      console.warn('[FileRepository] Error checking gitignore:', error);
      return false;
    }
  }

  private async getParsedGitignoreRules(projectId: string): Promise<GitIgnoreRule[]> {
    const entry = this.gitignoreCache.get(projectId);
    if (entry && Date.now() - entry.ts < this.GITIGNORE_CACHE_TTL_MS) {
      return entry.rules;
    }

    await this.getGitignoreRules(projectId);
    const refreshed = this.gitignoreCache.get(projectId);
    return refreshed ? refreshed.rules : [];
  }

  private async getGitignoreRules(projectId: string): Promise<string[]> {
    const entry = this.gitignoreCache.get(projectId);
    if (entry && Date.now() - entry.ts < this.GITIGNORE_CACHE_TTL_MS) {
      return entry.rules.map(r => r.raw);
    }

    try {
      const gitignoreFile = await this.storage!.files.getByPath(projectId, '/.gitignore');
      if (!gitignoreFile || !gitignoreFile.content) {
        this.gitignoreCache.delete(projectId);
        return [];
      }

      const parsed = parseGitignore(gitignoreFile.content);
      this.gitignoreCache.set(projectId, { rules: parsed, ts: Date.now() });
      return parsed.map(r => r.raw);
    } catch (error) {
      console.warn('[FileRepository] Failed to load .gitignore:', error);
      this.gitignoreCache.delete(projectId);
      return [];
    }
  }

  private updateGitignoreCache(projectId: string, content?: string): void {
    if (!content) {
      this.gitignoreCache.delete(projectId);
      return;
    }
    const parsed = parseGitignore(content);
    this.gitignoreCache.set(projectId, { rules: parsed, ts: Date.now() });
  }

  private clearGitignoreCache(projectId: string): void {
    this.gitignoreCache.delete(projectId);
  }

  // ==================== GitFileSystem Sync ====================

  private async syncToGitFileSystem(
    projectId: string,
    path: string,
    content: string,
    operation: 'create' | 'update' | 'delete',
    bufferContent?: ArrayBuffer,
    fileType?: 'file' | 'folder'
  ): Promise<void> {
    if (!isBrowser()) {
      coreInfo(`[FileRepository] Skipping GitFileSystem sync in non-browser environment`);
      return;
    }

    try {
      const shouldIgnore = await this.shouldIgnorePathForGit(projectId, path);
      if (shouldIgnore) {
        coreInfo(`[FileRepository] Skipping sync for ignored path: ${path}`);
        return;
      }

      const { syncManager } = await import('./syncManager');
      let projectName = this.projectNameCache.get(projectId);
      if (!projectName) {
        const project = await this.storage!.projects.getById(projectId);
        if (project) {
          projectName = project.name;
          this.projectNameCache.set(projectId, projectName);
        } else {
          coreWarn('[FileRepository] Project not found for sync:', projectId);
          return;
        }
      }

      if (fileType === 'folder' && operation !== 'delete') {
        const projectDir = gitFileSystem.getProjectDir(projectName);
        const fullPath = `${projectDir}${path}`;
        await gitFileSystem.ensureDirectory(fullPath);
      } else {
        await syncManager.syncSingleFileToFS(projectName, path, content, operation, bufferContent);
      }

      await gitFileSystem.flush();
    } catch (error) {
      coreError('[FileRepository] syncToGitFileSystem error:', error);
      throw error;
    }
  }

  // ==================== Bulk Operations ====================

  async bulkCreateFiles(
    projectId: string,
    files: Array<{ path: string; content: string; type: 'file' | 'folder' }>
  ): Promise<void> {
    await this.init();

    for (const f of files) {
      await this.createFile(projectId, f.path, f.content, f.type);
    }

    if (isBrowser()) {
      try {
        const { syncManager } = await import('./syncManager');
        let projectName = this.projectNameCache.get(projectId);
        if (!projectName) {
          const project = await this.storage!.projects.getById(projectId);
          projectName = project?.name;
          if (projectName) this.projectNameCache.set(projectId, projectName);
        }
        if (projectName) {
          await syncManager.syncFromIndexedDBToFS(projectId, projectName);
        }
      } catch (error) {
        coreWarn('[FileRepository] Bulk sync failed:', error);
      }
    }
  }

  // ==================== チャットスペース操作 ====================

  /** @deprecated chatStorageAdapter を直接使用してください */
  async createChatSpace(projectId: string, name: string): Promise<ChatSpace> {
    return chatCreateChatSpace(projectId, name);
  }

  /** @deprecated chatStorageAdapter を直接使用してください */
  async saveChatSpace(chatSpace: ChatSpace): Promise<void> {
    return chatSaveChatSpace(chatSpace);
  }

  /** @deprecated chatStorageAdapter を直接使用してください */
  async getChatSpaces(projectId: string): Promise<ChatSpace[]> {
    return chatGetChatSpaces(projectId);
  }

  /** @deprecated chatStorageAdapter を直接使用してください */
  async deleteChatSpace(projectId: string, chatSpaceId: string): Promise<void> {
    return chatDeleteChatSpace(projectId, chatSpaceId);
  }

  /** @deprecated chatStorageAdapter を直接使用してください */
  async addMessageToChatSpace(
    projectId: string,
    chatSpaceId: string,
    message: Omit<ChatSpaceMessage, 'id'>
  ): Promise<ChatSpaceMessage> {
    return chatAddMessageToChatSpace(projectId, chatSpaceId, message as ChatSpaceMessage);
  }

  /** @deprecated chatStorageAdapter を直接使用してください */
  async updateChatSpaceMessage(
    projectId: string,
    chatSpaceId: string,
    messageId: string,
    updates: Partial<ChatSpaceMessage>
  ): Promise<ChatSpaceMessage | null> {
    return chatUpdateChatSpaceMessage(projectId, chatSpaceId, messageId, updates);
  }

  /** @deprecated chatStorageAdapter を直接使用してください */
  async updateChatSpaceSelectedFiles(
    projectId: string,
    chatSpaceId: string,
    selectedFiles: string[]
  ): Promise<void> {
    return chatUpdateChatSpaceSelectedFiles(projectId, chatSpaceId, selectedFiles);
  }

  /** @deprecated chatStorageAdapter を直接使用してください */
  async renameChatSpace(projectId: string, chatSpaceId: string, newName: string): Promise<void> {
    return chatRenameChatSpace(projectId, chatSpaceId, newName);
  }

  async close(): Promise<void> {
    if (this.storage) {
      await this.storage.close();
      this.storage = null;
      this.initPromise = null;
      coreInfo('[FileRepository] Storage closed');
    }
  }
}

/** @deprecated 直接 pathResolver の toGitPath を使用してください */
const toGitPath = pathToGitPath;

/** @deprecated 直接 pathResolver の fromGitPath を使用してください */
const fromGitPath = pathFromGitPath;

// エクスポート
export const fileRepository = FileRepository.getInstance();
export { normalizePath, getParentPath, toGitPath, fromGitPath };

// パス解決モジュールを再エクスポート
export * from './pathUtils';
