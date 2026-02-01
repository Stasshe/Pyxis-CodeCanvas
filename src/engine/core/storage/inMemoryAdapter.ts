/**
 * In-Memory Storage Adapter
 *
 * This adapter provides an in-memory implementation of the storage layer
 * for use in Node.js testing environments. It maintains state in memory
 * and does not persist data.
 */

import type {
  IStorageAdapter,
  IProjectStore,
  IFileStore,
  IChatSpaceStore,
  StorageConfig,
} from './types';
import type { Project, ProjectFile, ChatSpace } from '@/types';

/**
 * In-Memory Project Store
 */
class InMemoryProjectStore implements IProjectStore {
  private data: Map<string, Project> = new Map();

  async getAll(): Promise<Project[]> {
    return Array.from(this.data.values()).map(p => ({
      ...p,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    }));
  }

  async getById(id: string): Promise<Project | null> {
    const project = this.data.get(id);
    if (!project) return null;
    return {
      ...project,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt),
    };
  }

  async getByName(name: string): Promise<Project | null> {
    for (const project of this.data.values()) {
      if (project.name === name) {
        return {
          ...project,
          createdAt: new Date(project.createdAt),
          updatedAt: new Date(project.updatedAt),
        };
      }
    }
    return null;
  }

  async save(project: Project): Promise<void> {
    this.data.set(project.id, {
      ...project,
      updatedAt: new Date(),
    });
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.data.clear();
  }
}

/**
 * In-Memory File Store
 */
class InMemoryFileStore implements IFileStore {
  private data: Map<string, ProjectFile> = new Map();
  private projectIndex: Map<string, Set<string>> = new Map();

  async getAllByProject(projectId: string): Promise<ProjectFile[]> {
    const fileIds = this.projectIndex.get(projectId) || new Set();
    return Array.from(fileIds)
      .map(id => this.data.get(id))
      .filter((f): f is ProjectFile => f !== undefined)
      .map(f => ({
        ...f,
        createdAt: new Date(f.createdAt),
        updatedAt: new Date(f.updatedAt),
      }));
  }

  async getByPrefix(projectId: string, prefix: string): Promise<ProjectFile[]> {
    const allFiles = await this.getAllByProject(projectId);
    if (prefix === '/') {
      return allFiles;
    }
    return allFiles.filter(
      f => f.path === prefix || f.path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')
    );
  }

  async getById(id: string): Promise<ProjectFile | null> {
    const file = this.data.get(id);
    if (!file) return null;
    return {
      ...file,
      createdAt: new Date(file.createdAt),
      updatedAt: new Date(file.updatedAt),
    };
  }

  async getByPath(projectId: string, path: string): Promise<ProjectFile | null> {
    const fileIds = this.projectIndex.get(projectId) || new Set();
    for (const id of fileIds) {
      const file = this.data.get(id);
      if (file && file.path === path) {
        return {
          ...file,
          createdAt: new Date(file.createdAt),
          updatedAt: new Date(file.updatedAt),
        };
      }
    }
    return null;
  }

  async save(file: ProjectFile): Promise<void> {
    this.data.set(file.id, {
      ...file,
      updatedAt: new Date(),
    });

    // Update project index
    if (!this.projectIndex.has(file.projectId)) {
      this.projectIndex.set(file.projectId, new Set());
    }
    this.projectIndex.get(file.projectId)!.add(file.id);
  }

  async delete(id: string): Promise<void> {
    const file = this.data.get(id);
    if (file) {
      const projectFiles = this.projectIndex.get(file.projectId);
      if (projectFiles) {
        projectFiles.delete(id);
      }
      this.data.delete(id);
    }
  }

  async deleteByProject(projectId: string): Promise<void> {
    const fileIds = this.projectIndex.get(projectId);
    if (fileIds) {
      for (const id of fileIds) {
        this.data.delete(id);
      }
      this.projectIndex.delete(projectId);
    }
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.data.clear();
    this.projectIndex.clear();
  }
}

/**
 * In-Memory ChatSpace Store
 */
class InMemoryChatSpaceStore implements IChatSpaceStore {
  private data: Map<string, ChatSpace> = new Map();
  private projectIndex: Map<string, Set<string>> = new Map();

  async getAllByProject(projectId: string): Promise<ChatSpace[]> {
    const ids = this.projectIndex.get(projectId) || new Set();
    return Array.from(ids)
      .map(id => this.data.get(id))
      .filter((cs): cs is ChatSpace => cs !== undefined);
  }

  async getById(projectId: string, id: string): Promise<ChatSpace | null> {
    return this.data.get(id) || null;
  }

  async save(chatSpace: ChatSpace): Promise<void> {
    this.data.set(chatSpace.id, chatSpace);
    if (!this.projectIndex.has(chatSpace.projectId)) {
      this.projectIndex.set(chatSpace.projectId, new Set());
    }
    this.projectIndex.get(chatSpace.projectId)!.add(chatSpace.id);
  }

  async delete(projectId: string, id: string): Promise<void> {
    this.data.delete(id);
    const projectSpaces = this.projectIndex.get(projectId);
    if (projectSpaces) {
      projectSpaces.delete(id);
    }
  }

  async deleteByProject(projectId: string): Promise<void> {
    const ids = this.projectIndex.get(projectId);
    if (ids) {
      for (const id of ids) {
        this.data.delete(id);
      }
      this.projectIndex.delete(projectId);
    }
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.data.clear();
    this.projectIndex.clear();
  }
}

/**
 * In-Memory Storage Adapter
 *
 * Provides a complete in-memory implementation of the storage layer
 * for testing purposes.
 */
export class InMemoryStorageAdapter implements IStorageAdapter {
  readonly projects: InMemoryProjectStore;
  readonly files: InMemoryFileStore;
  readonly chatSpaces: InMemoryChatSpaceStore;

  private initialized = false;
  private config: StorageConfig;

  constructor(config: StorageConfig = {}) {
    this.config = config;
    this.projects = new InMemoryProjectStore();
    this.files = new InMemoryFileStore();
    this.chatSpaces = new InMemoryChatSpaceStore();
  }

  async init(): Promise<void> {
    if (this.config.debug) {
      console.log('[InMemoryStorageAdapter] Initialized');
    }
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.config.debug) {
      console.log('[InMemoryStorageAdapter] Closed');
    }
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.projects.clear();
    this.files.clear();
    this.chatSpaces.clear();
  }
}
