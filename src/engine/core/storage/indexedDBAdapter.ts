/**
 * IndexedDB Storage Adapter
 *
 * This adapter provides an IndexedDB implementation of the storage layer
 * for use in browser environments. This is the production storage backend.
 */

import type {
  IStorageAdapter,
  IProjectStore,
  IFileStore,
  IChatSpaceStore,
  StorageConfig,
} from './types';
import type { Project, ProjectFile, ChatSpace } from '@/types';

const DEFAULT_DB_NAME = 'PyxisProjects';
const DEFAULT_DB_VERSION = 5;

/**
 * IndexedDB Project Store
 */
class IndexedDBProjectStore implements IProjectStore {
  constructor(private getDb: () => IDBDatabase | null) {}

  private get db(): IDBDatabase {
    const db = this.getDb();
    if (!db) throw new Error('Database not initialized');
    return db;
  }

  async getAll(): Promise<Project[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['projects'], 'readonly');
      const store = transaction.objectStore('projects');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const projects = request.result.map((p: Project) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        }));
        resolve(projects);
      };
    });
  }

  async getById(id: string): Promise<Project | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['projects'], 'readonly');
      const store = transaction.objectStore('projects');
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }
        resolve({
          ...request.result,
          createdAt: new Date(request.result.createdAt),
          updatedAt: new Date(request.result.updatedAt),
        });
      };
    });
  }

  async getByName(name: string): Promise<Project | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['projects'], 'readonly');
      const store = transaction.objectStore('projects');
      const index = store.index('name');
      const request = index.get(name);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }
        resolve({
          ...request.result,
          createdAt: new Date(request.result.createdAt),
          updatedAt: new Date(request.result.updatedAt),
        });
      };
    });
  }

  async save(project: Project): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['projects'], 'readwrite');
      const store = transaction.objectStore('projects');
      const request = store.put({ ...project, updatedAt: new Date() });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['projects'], 'readwrite');
      const store = transaction.objectStore('projects');
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

/**
 * IndexedDB File Store
 */
class IndexedDBFileStore implements IFileStore {
  constructor(private getDb: () => IDBDatabase | null) {}

  private get db(): IDBDatabase {
    const db = this.getDb();
    if (!db) throw new Error('Database not initialized');
    return db;
  }

  async getAllByProject(projectId: string): Promise<ProjectFile[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const files = request.result.map((f: ProjectFile) => ({
          ...f,
          createdAt: new Date(f.createdAt),
          updatedAt: new Date(f.updatedAt),
        }));
        resolve(files);
      };
    });
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
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }
        resolve({
          ...request.result,
          createdAt: new Date(request.result.createdAt),
          updatedAt: new Date(request.result.updatedAt),
        });
      };
    });
  }

  async getByPath(projectId: string, path: string): Promise<ProjectFile | null> {
    // Try using compound index first
    try {
      return await new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        
        if (store.indexNames.contains('projectId_path')) {
          const index = store.index('projectId_path');
          const request = index.get([projectId, path]);
          
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            if (!request.result) {
              resolve(null);
              return;
            }
            resolve({
              ...request.result,
              createdAt: new Date(request.result.createdAt),
              updatedAt: new Date(request.result.updatedAt),
            });
          };
        } else {
          // Fallback to scanning
          const index = store.index('projectId');
          const request = index.getAll(projectId);
          
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const file = request.result.find((f: ProjectFile) => f.path === path);
            if (!file) {
              resolve(null);
              return;
            }
            resolve({
              ...file,
              createdAt: new Date(file.createdAt),
              updatedAt: new Date(file.updatedAt),
            });
          };
        }
      });
    } catch {
      // Fallback for older databases
      const allFiles = await this.getAllByProject(projectId);
      const file = allFiles.find(f => f.path === path);
      return file || null;
    }
  }

  async save(file: ProjectFile): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put({ ...file, updatedAt: new Date() });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async deleteByProject(projectId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const index = store.index('projectId');
      const request = index.openCursor(IDBKeyRange.only(projectId));

      request.onerror = () => reject(request.error);
      request.onsuccess = event => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
    });
  }
}

/**
 * IndexedDB ChatSpace Store
 */
class IndexedDBChatSpaceStore implements IChatSpaceStore {
  constructor(private getDb: () => IDBDatabase | null) {}

  private get db(): IDBDatabase {
    const db = this.getDb();
    if (!db) throw new Error('Database not initialized');
    return db;
  }

  async getAllByProject(projectId: string): Promise<ChatSpace[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chatSpaces'], 'readonly');
      const store = transaction.objectStore('chatSpaces');
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async getById(projectId: string, id: string): Promise<ChatSpace | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chatSpaces'], 'readonly');
      const store = transaction.objectStore('chatSpaces');
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async save(chatSpace: ChatSpace): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chatSpaces'], 'readwrite');
      const store = transaction.objectStore('chatSpaces');
      const request = store.put(chatSpace);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(projectId: string, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chatSpaces'], 'readwrite');
      const store = transaction.objectStore('chatSpaces');
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async deleteByProject(projectId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['chatSpaces'], 'readwrite');
      const store = transaction.objectStore('chatSpaces');
      const index = store.index('projectId');
      const request = index.openCursor(IDBKeyRange.only(projectId));

      request.onerror = () => reject(request.error);
      request.onsuccess = event => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
    });
  }
}

/**
 * IndexedDB Storage Adapter
 *
 * Provides a complete IndexedDB implementation of the storage layer
 * for browser production use.
 */
export class IndexedDBStorageAdapter implements IStorageAdapter {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private config: StorageConfig;

  readonly projects: IndexedDBProjectStore;
  readonly files: IndexedDBFileStore;
  readonly chatSpaces: IndexedDBChatSpaceStore;

  constructor(config: StorageConfig = {}) {
    this.config = {
      dbName: config.dbName || DEFAULT_DB_NAME,
      version: config.version || DEFAULT_DB_VERSION,
      debug: config.debug || false,
    };

    const getDb = () => this.db;
    this.projects = new IndexedDBProjectStore(getDb);
    this.files = new IndexedDBFileStore(getDb);
    this.chatSpaces = new IndexedDBChatSpaceStore(getDb);
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName!, this.config.version);

      request.onerror = () => {
        console.error('[IndexedDBStorageAdapter] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        if (this.config.debug) {
          console.log('[IndexedDBStorageAdapter] Database initialized successfully');
        }
        resolve();
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Projects store
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('name', 'name', { unique: true });
        } else {
          const projectStore = (event.target as IDBOpenDBRequest).transaction!.objectStore(
            'projects'
          );
          if (!projectStore.indexNames.contains('name')) {
            projectStore.createIndex('name', 'name', { unique: true });
          }
        }

        // Files store
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('projectId', 'projectId', { unique: false });
          try {
            fileStore.createIndex('projectId_path', ['projectId', 'path'], { unique: false });
          } catch {
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
            } catch {
              // ignore if not supported
            }
          }
        }

        // ChatSpaces store
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

        if (this.config.debug) {
          console.log('[IndexedDBStorageAdapter] Database upgraded');
        }
      };
    });

    return this.initPromise;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
      if (this.config.debug) {
        console.log('[IndexedDBStorageAdapter] Database closed');
      }
    }
  }

  isInitialized(): boolean {
    return this.db !== null;
  }
}
