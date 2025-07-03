import { getFileSystem, getProjectDir } from './filesystem';
import { UnixCommands } from './cmd/unix';

// Node.js風のランタイム環境
export class NodeJSRuntime {
  private fs: any;
  private projectDir: string;
  private unixCommands: UnixCommands;
  private console: any;
  private onOutput?: (output: string, type: 'log' | 'error') => void;
  private onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;

  constructor(
    projectName: string, 
    onOutput?: (output: string, type: 'log' | 'error') => void,
    onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>
  ) {
    this.fs = getFileSystem();
    this.projectDir = getProjectDir(projectName);
    this.unixCommands = new UnixCommands(projectName, onFileOperation);
    this.onOutput = onOutput;
    this.onFileOperation = onFileOperation;
    
    // console.logをオーバーライド
    this.console = {
      log: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        this.onOutput?.(output, 'log');
      },
      error: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        this.onOutput?.(output, 'error');
      },
      warn: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        this.onOutput?.(`⚠️ ${output}`, 'log');
      },
      info: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        this.onOutput?.(`ℹ️ ${output}`, 'log');
      }
    };
  }

  // Node.js風のコードを実行
  async executeNodeJS(code: string): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      // Node.js風のグローバル環境を構築
      const nodeGlobals = this.createNodeGlobals();
      
      // コードを実行可能な形に変換
      const wrappedCode = this.wrapCodeForExecution(code, nodeGlobals);
      
      // 実行
      const result = await this.executeInSandbox(wrappedCode, nodeGlobals);
      
      return { success: true, output: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.onOutput?.(errorMessage, 'error');
      return { success: false, error: errorMessage };
    }
  }

  // Node.js風のグローバル環境を作成
  private createNodeGlobals(): any {
    const self = this;
    
    return {
      console: this.console,
      process: {
        cwd: () => this.unixCommands.getRelativePath(),
        env: { NODE_ENV: 'development' },
        version: 'v18.0.0',
        platform: 'browser',
        argv: ['node', 'script.js']
      },
      require: (moduleName: string) => {
        // 基本的なNode.jsモジュールをエミュレート
        switch (moduleName) {
          case 'fs':
            return this.createFSModule();
          case 'path':
            return this.createPathModule();
          case 'os':
            return this.createOSModule();
          case 'util':
            return this.createUtilModule();
          default:
            throw new Error(`Module '${moduleName}' not found`);
        }
      },
      __filename: this.projectDir + '/script.js',
      __dirname: this.projectDir,
      Buffer: globalThis.Buffer || {
        from: (data: any) => new Uint8Array(typeof data === 'string' ? new TextEncoder().encode(data) : data),
        isBuffer: (obj: any) => obj instanceof Uint8Array
      },
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
      clearTimeout: globalThis.clearTimeout,
      clearInterval: globalThis.clearInterval
    };
  }

  // fs モジュールのエミュレーション
  private createFSModule() {
    const self = this;
    
    const fsModule = {
      readFile: async (path: string, options?: any): Promise<string> => {
        try {
          // パスがプロジェクトルート相対の場合の処理
          let fullPath;
          if (path.startsWith('/')) {
            // 絶対パスの場合、プロジェクトディレクトリを基準とする
            fullPath = `${self.projectDir}${path}`;
          } else {
            // 相対パスの場合
            fullPath = `${self.projectDir}/${path}`;
          }
          
          console.log(`[fs.readFile] Attempting to read: ${path} -> ${fullPath}`);
          const content = await self.fs.promises.readFile(fullPath, { encoding: 'utf8' });
          return content as string;
        } catch (error) {
          console.error(`[fs.readFile] Failed to read ${path}:`, error);
          throw new Error(`ENOENT: ${path}`);
        }
      },
      writeFile: async (path: string, data: string, options?: any): Promise<void> => {
        try {
          let fullPath;
          let relativePath;
          if (path.startsWith('/')) {
            fullPath = `${self.projectDir}${path}`;
            relativePath = path;
          } else {
            fullPath = `${self.projectDir}/${path}`;
            relativePath = `/${path}`;
          }
          
          console.log(`[fs.writeFile] Writing to: ${path} -> ${fullPath}`);
          
          // 親ディレクトリが存在することを確認
          const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
          if (parentDir && parentDir !== self.projectDir) {
            try {
              await self.fs.promises.stat(parentDir);
            } catch {
              await self.fs.promises.mkdir(parentDir, { recursive: true } as any);
            }
          }
          
          await self.fs.promises.writeFile(fullPath, data);
          
          // ファイルシステムのキャッシュをフラッシュ（unix.tsと同様）
          await self.flushFileSystemCache();
          
          console.log(`[nodeRuntime.fs.writeFile] File written to filesystem: ${fullPath}, content length: ${data.length}`);
          
          // IndexedDBとの同期（unix.tsと同様）
          if (self.onFileOperation) {
            console.log(`[nodeRuntime.fs.writeFile] Calling onFileOperation with isNodeRuntime=true`);
            await self.onFileOperation(relativePath, 'file', data, true); // isNodeRuntime = true
            console.log(`[nodeRuntime.fs.writeFile] onFileOperation completed`);
          }
          
          self.onOutput?.(`File written: ${path}`, 'log');
        } catch (error) {
          throw new Error(`Failed to write file '${path}': ${(error as Error).message}`);
        }
      },
      readFileSync: (path: string, options?: any): string => {
        throw new Error('Synchronous file operations are not supported in browser environment. Use async versions.');
      },
      writeFileSync: (path: string, data: string, options?: any): void => {
        throw new Error('Synchronous file operations are not supported in browser environment. Use async versions.');
      },
      existsSync: async (path: string): Promise<boolean> => {
        try {
          let fullPath;
          if (path.startsWith('/')) {
            fullPath = `${self.projectDir}${path}`;
          } else {
            fullPath = `${self.projectDir}/${path}`;
          }
          
          await self.fs.promises.stat(fullPath);
          return true;
        } catch {
          return false;
        }
      },
      mkdir: async (path: string, options?: any): Promise<void> => {
        const recursive = options?.recursive || false;
        await self.unixCommands.mkdir(path, recursive);
        // unixCommandsが内部でonFileOperationを呼び出すので追加の同期は不要
      },
      readdir: async (path: string, options?: any): Promise<string[]> => {
        try {
          const fullPath = path.startsWith('/') ? path : `${self.projectDir}/${path}`;
          const files = await self.fs.promises.readdir(fullPath);
          return files.filter((file: string) => file !== '.git' && !file.startsWith('.git'));
        } catch (error) {
          throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
        }
      },
      unlink: async (path: string): Promise<void> => {
        await self.unixCommands.rm(path);
        // unixCommandsが内部でonFileOperationを呼び出すので追加の同期は不要
      },
      appendFile: async (path: string, data: string, options?: any): Promise<void> => {
        try {
          // 既存のファイル内容を読み取り
          let existingContent = '';
          try {
            existingContent = await fsModule.readFile(path);
          } catch {
            // ファイルが存在しない場合は空として扱う
          }
          
          // 既存の内容に新しいデータを追加
          const newContent = existingContent + data;
          await fsModule.writeFile(path, newContent);
        } catch (error) {
          throw new Error(`Failed to append to file '${path}': ${(error as Error).message}`);
        }
      },
      stat: async (path: string): Promise<any> => {
        try {
          let fullPath;
          if (path.startsWith('/')) {
            fullPath = `${self.projectDir}${path}`;
          } else {
            fullPath = `${self.projectDir}/${path}`;
          }
          return await self.fs.promises.stat(fullPath);
        } catch (error) {
          throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
        }
      }
    };

    // fs.promisesプロパティを追加
    (fsModule as any).promises = fsModule;
    
    return fsModule;
  }

  // path モジュールのエミュレーション
  private createPathModule() {
    return {
      join: (...paths: string[]): string => {
        return paths
          .filter(path => path)
          .join('/')
          .replace(/\/+/g, '/')
          .replace(/\/$/, '') || '/';
      },
      resolve: (...paths: string[]): string => {
        let resolved = this.projectDir;
        for (const path of paths) {
          if (path.startsWith('/')) {
            resolved = path;
          } else {
            resolved = `${resolved}/${path}`;
          }
        }
        return resolved.replace(/\/+/g, '/');
      },
      dirname: (path: string): string => {
        const lastSlash = path.lastIndexOf('/');
        return lastSlash > 0 ? path.substring(0, lastSlash) : '/';
      },
      basename: (path: string, ext?: string): string => {
        const name = path.substring(path.lastIndexOf('/') + 1);
        return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
      },
      extname: (path: string): string => {
        const lastDot = path.lastIndexOf('.');
        const lastSlash = path.lastIndexOf('/');
        return (lastDot > lastSlash) ? path.substring(lastDot) : '';
      }
    };
  }

  // os モジュールのエミュレーション
  private createOSModule() {
    return {
      platform: () => 'browser',
      type: () => 'Browser',
      arch: () => 'x64',
      hostname: () => 'localhost',
      tmpdir: () => '/tmp',
      homedir: () => '/home/user',
      EOL: '\n'
    };
  }

  // util モジュールのエミュレーション
  private createUtilModule() {
    return {
      inspect: (obj: any, options?: any): string => {
        try {
          return JSON.stringify(obj, null, 2);
        } catch {
          return String(obj);
        }
      },
      format: (f: string, ...args: any[]): string => {
        let i = 0;
        return f.replace(/%[sdj%]/g, (x) => {
          if (x === '%%') return x;
          if (i >= args.length) return x;
          switch (x) {
            case '%s': return String(args[i++]);
            case '%d': return String(Number(args[i++]));
            case '%j':
              try {
                return JSON.stringify(args[i++]);
              } catch {
                return '[Circular]';
              }
            default:
              return x;
          }
        });
      }
    };
  }

  // コードを実行用にラップ
  private wrapCodeForExecution(code: string, globals: any): string {
    // 確実に非同期関数として実行されるようにする
    return `
      (async function() {
        // グローバル変数を設定
        ${Object.keys(globals).map(key => `const ${key} = arguments[0].${key};`).join('\n        ')}
        
        // ユーザーコードを実行
        ${code}
      })
    `;
  }

  // サンドボックス内でコードを実行
  private async executeInSandbox(wrappedCode: string, globals: any): Promise<string> {
    try {
      console.log('[NodeJS Runtime] Executing code:', wrappedCode.substring(0, 200) + '...');
      
      // 安全なFunction実行
      const asyncFunction = eval(wrappedCode);
      
      if (typeof asyncFunction !== 'function') {
        throw new Error('Generated function is not executable');
      }
      
      // グローバル変数を渡して実行
      const result = await asyncFunction(globals);
      
      return result !== undefined ? String(result) : '';
    } catch (error) {
      console.error('[NodeJS Runtime] Execution error:', error);
      throw new Error(`Execution error: ${(error as Error).message}`);
    }
  }

  // ファイルを実行
  async executeFile(filePath: string): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      // ファイルパスの正規化（プロジェクトルート相対）
      let fullPath;
      if (filePath.startsWith('/')) {
        // 絶対パスの場合、プロジェクトディレクトリを基準とする
        fullPath = `${this.projectDir}${filePath}`;
      } else {
        // 相対パスの場合
        fullPath = `${this.projectDir}/${filePath}`;
      }
      
      console.log(`[executeFile] Reading file: ${filePath} -> ${fullPath}`);
      
      const code = await this.fs.promises.readFile(fullPath, { encoding: 'utf8' });
      
      this.onOutput?.(`Executing: ${filePath}`, 'log');
      return await this.executeNodeJS(code as string);
    } catch (error) {
      const errorMessage = `Failed to execute file '${filePath}': ${(error as Error).message}`;
      console.error('[executeFile] Error:', error);
      this.onOutput?.(errorMessage, 'error');
      return { success: false, error: errorMessage };
    }
  }

  // ファイルシステムのキャッシュをフラッシュしてGitに変更を認識させる
  private async flushFileSystemCache(): Promise<void> {
    try {
      // Lightning-FSのキャッシュをフラッシュ（バックエンドストレージと同期）
      if (this.fs && (this.fs as any).sync) {
        await (this.fs as any).sync();
      }
      
      // ファイルシステムの強制同期のため短縮した遅延
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.warn('[nodeRuntime] Failed to flush filesystem cache:', error);
    }
  }
}
