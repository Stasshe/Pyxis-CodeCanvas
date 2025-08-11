import { getFileSystem } from '@/utils/core/filesystem';
import pathBrowserify from 'path-browserify';
import { DebugConsoleAPI } from '@/components/Bottom/DebugConsoleAPI';

  // fs モジュールのエミュレーション
export function createFSModule(projectDir: string, onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean, isBufferArray?: boolean, bufferContent?: ArrayBuffer) => Promise<void>, unixCommands?: any) {
    const fs = getFileSystem();
    if (!fs) {
        throw new Error("ファイルシステムが初期化されていません");
    }
  
  // 共通ロジックを持つヘルパー関数
  async function handleWriteFile(fs: any, projectDir: string, path: string, data: string, onFileOperation?: (path: string, type: 'file', content?: string, isNodeRuntime?: boolean, isBufferArray?: boolean, bufferContent?: ArrayBuffer) => Promise<void>) {
    let fullPath;
    let relativePath;
    if (path.startsWith('/')) {
      fullPath = `${projectDir}${path}`;
      relativePath = path;
    } else {
      fullPath = `${projectDir}/${path}`;
      relativePath = `/${path}`;
    }

    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (parentDir && parentDir !== projectDir) {
      try {
        await fs.promises.stat(parentDir);
      } catch {
        await fs.promises.mkdir(parentDir, { recursive: true } as any);
      }
    }

    await fs.promises.writeFile(fullPath, data);
    await flushFileSystemCache(fs);

    if (onFileOperation) {
      console.log(`[handleWriteFile] Calling onFileOperation with isNodeRuntime=true`);
      await onFileOperation(relativePath, 'file', data, true, false, undefined);
      console.log(`[handleWriteFile] onFileOperation completed`);
    }
  }

  const fsModule = {
    readFile: async (path: string, options?: any): Promise<string> => {
      try {
        // パスがプロジェクトルート相対の場合の処理
        let fullPath;
        if (path.startsWith('/')) {
          // 絶対パスの場合、プロジェクトディレクトリを基準とする
          fullPath = `${projectDir}${path}`;
        } else {
          // 相対パスの場合
          fullPath = `${projectDir}/${path}`;
        }
        
        console.log(`[fs.readFile] Attempting to read: ${path} -> ${fullPath}`);
        const content = await fs.promises.readFile(fullPath, { encoding: 'utf8' });
        return content as string;
      } catch (error) {
        console.error(`[fs.readFile] Failed to read ${path}:`, error);
        throw new Error(`ENOENT: ${path}`);
      }
    },
    writeFile: async (path: string, data: string, options?: any): Promise<void> => {
      try {
        await handleWriteFile(fs, projectDir, path, data, onFileOperation);
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
          fullPath = `${projectDir}${path}`;
        } else {
          fullPath = `${projectDir}/${path}`;
        }
        
        await fs.promises.stat(fullPath);
        return true;
      } catch {
        return false;
      }
    },
    asyncWriteFile: async (path: string, data: string, options?: any): Promise<void> => {
      await fsModule.writeFile(path, data, options);
    },
    asyncReadFile: async (path: string, options?: any): Promise<string> => {
      return await fsModule.readFile(path, options);
    },
    asyncRemoveFile: async (path: string): Promise<void> => {
      await fsModule.unlink(path);
    },
    mkdir: async (path: string, options?: any): Promise<void> => {
      if (!unixCommands) throw new Error('Unix commands not available');
      
      const recursive = options?.recursive || false;
      await unixCommands.mkdir(path, recursive);
      // unixCommandsが内部でonFileOperationを呼び出すので追加の同期は不要
    },
    readdir: async (path: string, options?: any): Promise<string[]> => {
      try {
        const fullPath = path.startsWith('/') ? path : `${projectDir}/${path}`;
        const files = await fs.promises.readdir(fullPath);
        return files.filter((file: string) => file !== '.git' && !file.startsWith('.git'));
      } catch (error) {
        throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      }
    },
    unlink: async (path: string): Promise<void> => {
      if (!unixCommands) throw new Error('Unix commands not available');
      
      await unixCommands.rm(path);
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
          fullPath = `${projectDir}${path}`;
        } else {
          fullPath = `${projectDir}/${path}`;
        }
        return await fs.promises.stat(fullPath);
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
export function createPathModule(projectDir: string) {
  // path-browserifyのAPIをそのまま返す
  return {
    ...pathBrowserify,
    // 必要ならprojectDirを使った独自拡張も追加可能
  };
}

// os モジュールのエミュレーション
export function createOSModule() {
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
export function createUtilModule() {
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
    },
    promisify: (fn: Function): Function => {
      return (...args: any[]) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: any, result: any) => {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          });
        });
      };
    },
    callbackify: (fn: Function): Function => {
      return (...args: any[]) => {
        const cb = args.pop();
        fn(...args)
          .then((res: any) => cb(null, res))
          .catch((err: any) => cb(err));
      };
    },
    inherits: (ctor: Function, superCtor: Function) => {
      ctor.prototype = Object.create(superCtor.prototype);
      ctor.prototype.constructor = ctor;
    },
    isDeepStrictEqual: (a: any, b: any): boolean => {
      return JSON.stringify(a) === JSON.stringify(b);
    },
    types: {
      isArray: Array.isArray,
      isObject: (obj: any) => obj !== null && typeof obj === 'object',
      isPromise: (obj: any) => !!obj && typeof obj.then === 'function',
      isRegExp: (obj: any) => Object.prototype.toString.call(obj) === '[object RegExp]',
      isDate: (obj: any) => Object.prototype.toString.call(obj) === '[object Date]',
      isError: (obj: any) => obj instanceof Error,
      isFunction: (obj: any) => typeof obj === 'function',
      isString: (obj: any) => typeof obj === 'string',
      isNumber: (obj: any) => typeof obj === 'number',
      isBoolean: (obj: any) => typeof obj === 'boolean',
      isNull: (obj: any) => obj === null,
      isUndefined: (obj: any) => obj === undefined,
      isSymbol: (obj: any) => typeof obj === 'symbol',
      isBuffer: (obj: any) => obj && obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
    },
    toPromise: (fn: Function, ...args: any[]): Promise<any> => {
      return new Promise((resolve, reject) => {
        fn(...args, (err: any, result: any) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    },
    deprecate: (fn: Function, msg: string): Function => {
      let warned = false;
      return function(this: any, ...args: any[]) {
        if (!warned) {
          console.warn('DeprecationWarning:', msg);
          warned = true;
        }
        return fn.apply(this, args);
      };
    }
  };
}

// readline モジュールのエミュレーション
export function createReadlineModule() {
  // DebugConsoleAPI経由で入力を取得するためのイベントエミッター
  class Interface {
    private _input: any;
    private _output: any;
    private _prompt: string = '> ';
    private _listeners: Map<string, Function[]> = new Map();
    private _isWaitingForInput: boolean = false;
    
    constructor(options: any = {}) {
      this._input = options.input || process.stdin;
      this._output = options.output || process.stdout;
      if (options.prompt) this._prompt = options.prompt;
      
      // DebugConsoleからの入力をリッスン
      DebugConsoleAPI.onInput((input: string) => {
        if (this._isWaitingForInput) {
          this._isWaitingForInput = false;
          this.emit('line', input.trim());
        }
      });
    }
    
    // イベントリスナーの管理
    on(event: string, listener: Function): this {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, []);
      }
      this._listeners.get(event)!.push(listener);
      return this;
    }
    
    // イベントの発火
    emit(event: string, ...args: any[]): boolean {
      const listeners = this._listeners.get(event);
      if (listeners) {
        listeners.forEach(listener => listener(...args));
        return true;
      }
      return false;
    }
    
    // プロンプトの表示
    prompt(preserveCursor?: boolean): void {
      this._isWaitingForInput = true;
      DebugConsoleAPI.log(this._prompt);
    }
    
    // プロンプトの設定
    setPrompt(prompt: string): void {
      this._prompt = prompt;
    }
    
    // 質問（非同期）
    question(query: string, callback: (answer: string) => void): void {
      DebugConsoleAPI.log(query);
      this._isWaitingForInput = true;
      
      const onLine = (answer: string) => {
        this.removeListener('line', onLine);
        callback(answer);
      };
      
      this.on('line', onLine);
    }
    
    // 質問（Promise版）
    questionAsync(query: string): Promise<string> {
      return new Promise((resolve) => {
        this.question(query, resolve);
      });
    }
    
    // リスナーの削除
    removeListener(event: string, listener: Function): this {
      const listeners = this._listeners.get(event);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }
      return this;
    }
    
    // インターフェースを閉じる
    close(): void {
      this._listeners.clear();
      this._isWaitingForInput = false;
      this.emit('close');
    }
    
    // 一行書き込み
    write(data: string): void {
      DebugConsoleAPI.log(data);
    }
  }
  
  return {
    // インターフェースの作成
    createInterface: (options: any): Interface => {
      return new Interface(options);
    },
    
    // より簡単な質問関数
    question: (query: string): Promise<string> => {
      return new Promise((resolve) => {
        DebugConsoleAPI.log(query);
        const onInput = (input: string) => {
          DebugConsoleAPI.removeInputListener(onInput);
          resolve(input.trim());
        };
        DebugConsoleAPI.onInput(onInput);
      });
    },
    
    // Interface クラスをエクスポート
    Interface: Interface
  };
}

// ファイルシステムのキャッシュをフラッシュしてGitに変更を認識させる
export async function flushFileSystemCache(fs: any): Promise<void> {
  try {
    // Lightning-FSのキャッシュをフラッシュ（バックエンドストレージと同期）
    if (fs && fs.sync) {
      await fs.sync();
    }
    
    // ファイルシステムの強制同期のため短縮した遅延
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    console.warn('[nodeRuntime] Failed to flush filesystem cache:', error);
  }
}