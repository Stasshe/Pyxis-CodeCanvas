import type { Project, ProjectFile } from '../types';
import { initialFileContents } from './initialFileContents';

// IndexedDBを使ったプロジェクト管理システム

// ユニークID生成関数
const generateUniqueId = (prefix: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 12);
  const counter = Math.floor(Math.random() * 10000);
  return `${prefix}_${timestamp}_${random}_${counter}`;
};

class ProjectDB {
  private dbName = 'PyxisProjects';
  private version = 1;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // プロジェクトストア
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('name', 'name', { unique: false });
          projectStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // ファイルストア
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' });
          fileStore.createIndex('projectId', 'projectId', { unique: false });
          fileStore.createIndex('path', 'path', { unique: false });
          fileStore.createIndex('parentPath', 'parentPath', { unique: false });
        }
      };
    });
  }

  // プロジェクト操作
  async createProject(name: string, description?: string): Promise<Project> {
    const project: Project = {
      id: generateUniqueId('project'),
      name,
      description,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.saveProject(project);

    // initialFileContents.tsから初期ファイルを登録
    const initialFiles = [
      { path: '/README.md', key: 'README.md', type: 'file' },
      { path: '/.gitignore', key: '.gitignore', type: 'file' },
      { path: '/docs', key: null, type: 'folder' },
      { path: '/docs/getting-started.md', key: 'docs_getting-started.md', type: 'file' },
      { path: '/docs/git-commands.md', key: 'docs_git-commands.md', type: 'file' },
      { path: '/docs/unix-commands.md', key: 'docs_unix-commands.md', type: 'file' },
      { path: '/src', key: null, type: 'folder' },
      { path: '/src/index.js', key: 'src_index.js', type: 'file' },
      { path: '/src/fileOperationg.js', key: 'src_fileOperationg.js', type: 'file' },
    ];
    for (const f of initialFiles) {
      if (f.type === 'folder') {
        await this.createFile(project.id, f.path, '', 'folder');
      } else {
        const content = initialFileContents[f.key!] ?? '';
        await this.createFile(project.id, f.path, content, 'file');
      }
    }

    return project;
  }

  async saveProject(project: Project): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(['projects'], 'readwrite');
      const store = transaction.objectStore('projects');
      const request = store.put({ ...project, updatedAt: new Date() });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getProjects(): Promise<Project[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(['projects'], 'readonly');
      const store = transaction.objectStore('projects');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const projects = request.result.map(p => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        }));
        resolve(projects.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
      };
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(['projects', 'files'], 'readwrite');
      
      // プロジェクトを削除
      const projectStore = transaction.objectStore('projects');
      projectStore.delete(projectId);

      // 関連ファイルを削除
      const fileStore = transaction.objectStore('files');
      const index = fileStore.index('projectId');
      const request = index.openCursor(IDBKeyRange.only(projectId));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
    });
  }

  // ファイル操作
  async createFile(projectId: string, path: string, content: string, type: 'file' | 'folder'): Promise<ProjectFile> {
    
    // 既存ファイルをチェック
    const existingFiles = await this.getProjectFiles(projectId);
    const existingFile = existingFiles.find(f => f.path === path);
    
    if (existingFile) {
      existingFile.content = content;
      existingFile.updatedAt = new Date();
      await this.saveFile(existingFile);
      return existingFile;
    }
    
    const file: ProjectFile = {
      id: generateUniqueId('file'),
      projectId,
      path,
      name: path.split('/').pop() || '',
      content,
      type,
      parentPath: path.substring(0, path.lastIndexOf('/')) || '/',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.saveFile(file);
    return file;
  }

  async saveFile(file: ProjectFile): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        console.error('[DB] Database not initialized');
        reject(new Error('Database not initialized'));
        return;
      }

      const updatedFile = { ...file, updatedAt: new Date() };
      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.put(updatedFile);

      request.onerror = () => {
        console.error('[DB] Save failed:', request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        resolve();
      };
      
      // トランザクション完了後に追加の同期処理
      transaction.oncomplete = () => {
        // IndexedDBの変更を確実にフラッシュ
        setTimeout(() => {
        }, 50);
      };
    });
  }

  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        console.error('[DB] Database not initialized in getProjectFiles');
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => {
        console.error('[DB] Error getting project files:', request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        const files = request.result.map(f => ({
          ...f,
          createdAt: new Date(f.createdAt),
          updatedAt: new Date(f.updatedAt),
        }));
        resolve(files);
      };
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const request = store.delete(fileId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

export const projectDB = new ProjectDB();
