/**
 * InMemoryFileRepository - Node/テスト環境用のMapベースファイルリポジトリ
 * IndexedDBを使わず、全データをメモリ上のMapで管理する
 * GitFileSystem同期・chatStorage・localStorage操作はスキップ
 *
 * パス形式: AppPath（先頭スラッシュ付き）
 */

import {
  fromGitPath as pathFromGitPath,
  getParentPath as pathGetParentPath,
  toGitPath as pathToGitPath,
  toAppPath,
} from '../pathUtils';

import type { Project, ProjectFile } from '@/types';

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
 * @deprecated 直接 pathResolver の toAppPath を使用してください
 */
const normalizePath = toAppPath;

/**
 * @deprecated 直接 pathResolver の getParentPath を使用してください
 */
const getParentPath = pathGetParentPath;

export class FileRepository {
  private static instance: FileRepository | null = null;
  private projects: Map<string, Project> = new Map();
  private files: Map<string, ProjectFile> = new Map(); // key = file.id
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
      } catch (_error) {
        // ignore listener errors in inmemory mode
      }
    });
  }

  async init(): Promise<void> {
    // no-op: メモリストレージは初期化不要
  }

  async close(): Promise<void> {
    // no-op
  }

  // ==================== プロジェクト操作 ====================

  async createProject(name: string, description?: string): Promise<Project> {
    // 重複チェック
    for (const p of this.projects.values()) {
      if (p.name === name) return p;
    }

    const project: Project = {
      id: generateUniqueId('project'),
      name,
      description,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.projects.set(project.id, project);
    return project;
  }

  async createEmptyProject(name: string, description?: string): Promise<Project> {
    for (const p of this.projects.values()) {
      if (p.name === name) {
        throw new Error(`プロジェクト名 "${name}" は既に存在します。別の名前を使用してください。`);
      }
    }

    const project: Project = {
      id: generateUniqueId('project'),
      name,
      description,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.projects.set(project.id, project);
    return project;
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, { ...project, updatedAt: new Date() });
  }

  async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project with id ${projectId} not found`);
    }
    this.projects.set(projectId, { ...project, ...updates, updatedAt: new Date() });
  }

  async getProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).map(p => ({
      ...p,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    }));
  }

  async deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);

    // 関連ファイルを削除
    for (const [id, file] of this.files) {
      if (file.projectId === projectId) {
        this.files.delete(id);
      }
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
    const normalizedPath = toAppPath(path);

    // 既存ファイルをチェック
    const existingFiles = await this.getProjectFiles(projectId);
    const existingFile = existingFiles.find(f => f.path === normalizedPath);

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

    // 親ディレクトリの自動作成
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
    const updatedFile = { ...file, updatedAt: new Date() };
    this.files.set(updatedFile.id, updatedFile);

    this.emitChange({
      type: 'update',
      projectId: updatedFile.projectId,
      file: updatedFile,
    });
  }

  async saveFileByPath(projectId: string, path: string, content: string): Promise<void> {
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
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
      throw new Error(`Invalid projectId: ${projectId}`);
    }

    const result: ProjectFile[] = [];
    for (const file of this.files.values()) {
      if (file.projectId === projectId) {
        result.push({
          ...file,
          createdAt: new Date(file.createdAt),
          updatedAt: new Date(file.updatedAt),
          bufferContent: file.isBufferArray ? file.bufferContent : undefined,
        });
      }
    }
    return result;
  }

  async getFileByPath(projectId: string, path: string): Promise<ProjectFile | null> {
    const normalizedPath = toAppPath(path);
    for (const file of this.files.values()) {
      if (file.projectId === projectId && file.path === normalizedPath) {
        return file;
      }
    }
    return null;
  }

  async getFilesByPrefix(projectId: string, prefix: string): Promise<ProjectFile[]> {
    const result: ProjectFile[] = [];
    for (const file of this.files.values()) {
      if (file.projectId === projectId) {
        if (!prefix || prefix === '' || (file.path || '').startsWith(prefix)) {
          result.push({
            ...file,
            createdAt: new Date(file.createdAt),
            updatedAt: new Date(file.updatedAt),
            bufferContent: file.isBufferArray ? file.bufferContent : undefined,
          });
        }
      }
    }
    return result;
  }

  async createFilesBulk(
    projectId: string,
    entries: Array<{
      path: string;
      content: string;
      type: 'file' | 'folder';
      isBufferArray?: boolean;
      bufferContent?: ArrayBuffer;
    }>,
    _skipSync = false
  ): Promise<ProjectFile[]> {
    const timestamp = new Date();
    const createdFiles: ProjectFile[] = [];

    for (const entry of entries) {
      const file: ProjectFile = {
        id: generateUniqueId('file'),
        projectId,
        path: entry.path,
        name: entry.path.split('/').pop() || '',
        content: entry.isBufferArray ? '' : entry.content || '',
        type: entry.type || 'file',
        parentPath: entry.path.substring(0, entry.path.lastIndexOf('/')) || '/',
        createdAt: timestamp,
        updatedAt: timestamp,
        isBufferArray: !!entry.isBufferArray,
        bufferContent: entry.isBufferArray ? entry.bufferContent : undefined,
      };

      this.files.set(file.id, file);
      createdFiles.push(file);
    }

    // イベント発火
    setTimeout(() => {
      for (const file of createdFiles) {
        this.emitChange({ type: 'create', projectId: file.projectId, file });
      }
    }, 0);

    return createdFiles;
  }

  async clearAIReview(projectId: string, filePath: string): Promise<void> {
    const normalizedPath = toAppPath(filePath);
    for (const file of this.files.values()) {
      if (file.projectId === projectId && file.path === normalizedPath) {
        file.aiReviewStatus = undefined;
        file.aiReviewComments = undefined;
        this.files.set(file.id, file);
        break;
      }
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    const fileToDelete = this.files.get(fileId);
    if (!fileToDelete) {
      throw new Error(`File with id ${fileId} not found`);
    }

    const { projectId, path, type } = fileToDelete;
    const deletedFiles: ProjectFile[] = [];

    if (type === 'folder') {
      for (const [id, f] of this.files) {
        if (f.projectId === projectId && (f.path === path || f.path.startsWith(path + '/'))) {
          this.files.delete(id);
          deletedFiles.push(f);
        }
      }
    } else {
      this.files.delete(fileId);
      deletedFiles.push(fileToDelete);
    }

    for (const file of deletedFiles) {
      this.emitChange({
        type: 'delete',
        projectId,
        file: { id: file.id, path: file.path },
      });
    }
  }
}

/**
 * @deprecated 直接 pathResolver の toGitPath を使用してください
 */
const toGitPath = pathToGitPath;

/**
 * @deprecated 直接 pathResolver の fromGitPath を使用してください
 */
const fromGitPath = pathFromGitPath;

// エクスポート
export const fileRepository = FileRepository.getInstance();
export { normalizePath, getParentPath, toGitPath, fromGitPath };

// 新しいパス解決モジュールを再エクスポート
export * from '../pathUtils';
