import type { Project, ProjectFile } from '../types';

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

    // デフォルトファイルを作成
    await this.createFile(project.id, '/README.md', `# ${name}\n\n${description || 'このプロジェクトの説明をここに記入してください。'}\n\n## セットアップ\n\n\`\`\`bash\n# プロジェクトの開始\ngit status\n\`\`\``, 'file');
    await this.createFile(project.id, '/.gitignore', '# 依存関係\nnode_modules/\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\n\n# ビルド出力\ndist/\nbuild/\n\n# 環境変数\n.env\n.env.local\n.env.development.local\n.env.test.local\n.env.production.local\n\n# IDEファイル\n.vscode/\n.idea/\n\n# OS固有\n.DS_Store\nThumbs.db', 'file');
    await this.createFile(project.id, '/docs', '', 'folder');
    await this.createFile(project.id, '/docs/getting-started.md', '# スタートガイド\n\nこのプロジェクトの使用方法について説明します。\n', 'file');
    await this.createFile(project.id, '/docs/git-commands.md', `# Gitコマンドの使い方\n\nPyxisでは以下のGitコマンドが利用できます。\n\n- **git init**: 新しいリポジトリを初期化\n- **git add [ファイル]**: ファイルをステージに追加\n- **git commit -m "メッセージ"**: 変更をコミット\n- **git status**: 現在の状態を表示\n- **git log**: コミット履歴を表示\n- **git branch**: ブランチ一覧を表示\n- **git checkout [ブランチ名]**: ブランチを切り替え\n- **git checkout -b [新ブランチ名]**: 新しいブランチを作成して切り替え\n- **git merge [ブランチ名]**: ブランチをマージ\n- **git reset --hard [コミットID]**: 指定コミットまで巻き戻し\n- **git revert [コミットID]**: 指定コミットを打ち消すコミットを作成\n\n詳細は画面のGitパネルやヒストリーをご参照ください。`, 'file');
    await this.createFile(project.id, '/docs/unix-commands.md', `# ターミナルで使えるUnixコマンド\n\nPyxisのターミナルでは以下のコマンドが利用できます（一部制限あり）。\n\n- **ls**: ディレクトリの内容を表示\n- **cd [ディレクトリ]**: ディレクトリを移動\n- **pwd**: 現在のパスを表示\n- **cat [ファイル]**: ファイルの内容を表示\n- **touch [ファイル]**: 空ファイルを作成\n- **mkdir [ディレクトリ]**: ディレクトリを作成\n- **rm [ファイル/ディレクトリ]**: ファイルやディレクトリを削除\n- **cp [元] [先]**: ファイルをコピー\n- **mv [元] [先]**: ファイルを移動/リネーム\n- **echo [文字列]**: 文字列を表示\n- **clear**: 画面をクリア\n\n※ npmコマンドは現在開発中です。\n\n詳細はターミナルで**help**コマンドを実行してください。`, 'file');
    await this.createFile(project.id, '/src', '', 'folder');
    await this.createFile(project.id, '/src/index.js', '// メインエントリーポイント\nconsole.log("Hello, World!");\n\n// 関数定義と呼び出し\nfunction greet(name) {\n  return `こんにちは、${name}さん！`;\n}\nconsole.log(greet("ユーザー"));\n\n// 配列処理の例\nconst arr = [1, 2, 3, 4];\nconst squared = arr.map(x => x * x);\nconsole.log("二乗した配列:", squared);\n\n// 非同期処理の例\nasync function getData() {\n  return await new Promise(res => setTimeout(() => res(\"5秒経ちました。\"), 1000));\n}\ngetData().then(console.log);\n\n// プロジェクトのコードをここに記述してください', 'file');
    await this.createFile(project.id, '/src/fileOperationg.js', `const fs = require('fs').promises;\nconst triviaList = [\n  'カンガルーの赤ちゃんは生まれたとき2cmしかない！',\n  '富士山は一度も噴火していないと思われがちだが、実は1707年に噴火している！',\n  'バナナは実はベリー類に分類される！',\n  '日本では縦書きが一般的だけど、横書きの起源はタイプライターにあると言われてる！',\n];\n\nasync function saveRandomTrivia() {\n  const randomTrivia = triviaList[Math.floor(Math.random() * triviaList.length)];\n  const data = { date: new Date().toISOString(), trivia: randomTrivia };\n  try {\n    await fs.writeFile('trivia.json', JSON.stringify(data, null, 2), 'utf8');\n    console.log('今日の豆知識を保存しました:');\n    console.log(randomTrivia);\n  } catch (error) {\n    console.error('保存中にエラーが発生しました:', error.message);\n  }\n}\n\nsaveRandomTrivia();`, 'file');

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
      
      // トランザクション完了後に追加の同期処理
      transaction.oncomplete = () => {
        console.log('[DB] Transaction completed for file:', file.path);
        // IndexedDBの変更を確実にフラッシュ
        setTimeout(() => {
          console.log('[DB] Post-save sync delay completed for:', file.path);
        }, 50);
      };
    });
  }

  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    console.log('[DB] Getting project files for projectId:', projectId);
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
        console.log('[DB] Raw files from database:', request.result);
        const files = request.result.map(f => ({
          ...f,
          createdAt: new Date(f.createdAt),
          updatedAt: new Date(f.updatedAt),
        }));
        console.log('[DB] Processed files:', files);
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
