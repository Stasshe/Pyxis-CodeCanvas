// IndexedDBを使ったプロジェクト管理システム

// ユニークID生成関数
const generateUniqueId = (prefix: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 12);
  const counter = Math.floor(Math.random() * 10000);
  return `${prefix}_${timestamp}_${random}_${counter}`;
};

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  description?: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  name: string;
  content: string;
  type: 'file' | 'folder';
  parentPath?: string;
  createdAt: Date;
  updatedAt: Date;
}

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

    // デフォルトファイルを作成
    await this.createFile(project.id, '/README.md', `# ${name}\n\n${description || 'このプロジェクトの説明をここに記入してください。'}\n\n## セットアップ\n\n\`\`\`bash\n# プロジェクトの開始\ngit status\n\`\`\``, 'file');
    await this.createFile(project.id, '/src', '', 'folder');
    await this.createFile(project.id, '/src/index.js', '// メインエントリーポイント\nconsole.log("Hello, World!");\n\n// プロジェクトのコードをここに記述してください', 'file');
    await this.createFile(project.id, '/src/components', '', 'folder');
    await this.createFile(project.id, '/src/components/App.js', '// Appコンポーネント\nexport default function App() {\n  return (\n    <div>\n      <h1>Hello App</h1>\n      <p>プロジェクト: ${name}</p>\n    </div>\n  );\n}', 'file');
    await this.createFile(project.id, '/.gitignore', '# 依存関係\nnode_modules/\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\n\n# ビルド出力\ndist/\nbuild/\n\n# 環境変数\n.env\n.env.local\n.env.development.local\n.env.test.local\n.env.production.local\n\n# IDEファイル\n.vscode/\n.idea/\n\n# OS固有\n.DS_Store\nThumbs.db', 'file');

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
    console.log('[DB] Creating file:', { projectId, path, content, type });
    
    // 既存ファイルをチェック
    const existingFiles = await this.getProjectFiles(projectId);
    const existingFile = existingFiles.find(f => f.path === path);
    
    if (existingFile) {
      console.log('[DB] File already exists, updating:', path);
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

    console.log('[DB] File object created:', file);
    await this.saveFile(file);
    console.log('[DB] File saved successfully');
    return file;
  }

  async saveFile(file: ProjectFile): Promise<void> {
    console.log('[DB] Saving file:', { 
      id: file.id, 
      path: file.path, 
      contentLength: file.content.length,
      projectId: file.projectId 
    });
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
        console.log('[DB] Save successful for file:', file.path);
        resolve();
      };
    });
  }

  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(['files'], 'readonly');
      const store = transaction.objectStore('files');
      const index = store.index('projectId');
      const request = index.getAll(projectId);

      request.onerror = () => reject(request.error);
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
