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
    readFileSync: (path: string, options?: any): any => {
      // ブラウザ環境では真の同期操作は不可能なため、
      // 代わりにPromiseを返すことで非同期として扱う
      console.warn('⚠️  fs.readFileSync detected: Converting to async operation. Please await the result or use .then()');
      return fsModule.readFile(path, options);
    },
    writeFileSync: (path: string, data: string, options?: any): any => {
      // ブラウザ環境では真の同期操作は不可能なため、
      // 代わりにPromiseを返すことで非同期として扱う
      console.warn('⚠️  fs.writeFileSync detected: Converting to async operation. Please await the result or use .then()');
      return fsModule.writeFile(path, data, options);
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
  // 実際のNode.jsのreadline.Interfaceに近いクラス
  class Interface {
    private _input: any;
    private _output: any;
    private _prompt: string = '> ';
    private _listeners: Map<string, Function[]> = new Map();
    private _isWaitingForInput: boolean = false;
    private _completer: Function | null = null;
    private _terminal: boolean = true;
    private _historySize: number = 30;
    private _history: string[] = [];
    private _removeHistoryDuplicates: boolean = false;
    private _crlfDelay: number = 100;
    private _escapeCodeTimeout: number = 500;
    private _tabSize: number = 8;
    
    constructor(options: any = {}) {
      this._input = options.input || process.stdin;
      this._output = options.output || process.stdout;
      this._prompt = options.prompt || '> ';
      this._completer = options.completer || null;
      this._terminal = options.terminal !== false;
      this._historySize = options.historySize || 30;
      this._removeHistoryDuplicates = options.removeHistoryDuplicates || false;
      this._crlfDelay = options.crlfDelay || 100;
      this._escapeCodeTimeout = options.escapeCodeTimeout || 500;
      this._tabSize = options.tabSize || 8;
      
      // DebugConsoleからの入力をリッスン
      DebugConsoleAPI.onInput((input: string) => {
        if (this._isWaitingForInput) {
          this._isWaitingForInput = false;
          // 履歴に追加しない（questionで追加するため）
          this.emit('line', input.trim());
        }
      });
    }
    
    // 履歴管理
    private _addHistory(line: string): void {
      if (!line || line.trim() === '') return;
      
      console.log(`[readline] Adding to history: "${line}"`);
      
      if (this._removeHistoryDuplicates) {
        const index = this._history.indexOf(line);
        if (index !== -1) {
          this._history.splice(index, 1);
          console.log(`[readline] Removed duplicate from position ${index}`);
        }
      }
      
      this._history.unshift(line);
      if (this._history.length > this._historySize) {
        this._history = this._history.slice(0, this._historySize);
      }
      
      console.log(`[readline] History now has ${this._history.length} items:`, this._history);
    }
    
    // 履歴を取得
    getHistory(): string[] {
      console.log(`[readline] Current history (${this._history.length} items):`, this._history);
      return [...this._history];
    }
    
    // 履歴をクリア
    clearHistory(): void {
      this._history = [];
    }
    
    // イベントリスナーの管理
    on(event: string, listener: Function): this {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, []);
      }
      this._listeners.get(event)!.push(listener);
      return this;
    }
    
    once(event: string, listener: Function): this {
      const onceWrapper = (...args: any[]) => {
        this.removeListener(event, onceWrapper);
        listener(...args);
      };
      return this.on(event, onceWrapper);
    }
    
    // イベントの発火
    emit(event: string, ...args: any[]): boolean {
      const listeners = this._listeners.get(event);
      if (listeners) {
        listeners.forEach(listener => {
          try {
            listener(...args);
          } catch (error) {
            console.error('Error in readline event listener:', error);
          }
        });
        return true;
      }
      return false;
    }
    
    // プロンプトの表示
    prompt(preserveCursor?: boolean): void {
      this._isWaitingForInput = true;
      if (!preserveCursor) {
        DebugConsoleAPI.write('\r');
      }
      DebugConsoleAPI.write(this._prompt);
    }
    
    // プロンプトの設定
    setPrompt(prompt: string): void {
      this._prompt = prompt;
    }
    
    // プロンプトを取得
    getPrompt(): string {
      return this._prompt;
    }
    
    // 質問（非同期）
    question(query: string, callback?: (answer: string) => void): void {
      if (callback) {
        DebugConsoleAPI.write(query);
        this._isWaitingForInput = true;
        
        const onLine = (answer: string) => {
          this.removeListener('line', onLine);
          // 履歴に追加
          this._addHistory(answer);
          callback(answer);
        };
        
        this.on('line', onLine);
      } else {
        // Promiseを返す（Node.js 17+の動作）
        return new Promise((resolve) => {
          this.question(query, resolve);
        }) as any;
      }
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
    
    // 全てのリスナーを削除
    removeAllListeners(event?: string): this {
      if (event) {
        this._listeners.delete(event);
      } else {
        this._listeners.clear();
      }
      return this;
    }
    
    // リスナーの数を取得
    listenerCount(event: string): number {
      const listeners = this._listeners.get(event);
      return listeners ? listeners.length : 0;
    }
    
    // インターフェースを閉じる
    close(): void {
      this._listeners.clear();
      this._isWaitingForInput = false;
      this.emit('close');
    }
    
    // 一行書き込み
    write(data: string, key?: any): void {
      if (key && key.ctrl && key.name === 'c') {
        this.emit('SIGINT');
        return;
      }
      DebugConsoleAPI.write(data);
    }
    
    // カーソル位置を取得
    getCursorPos(): { rows: number; cols: number } {
      // ブラウザ環境では実際のカーソル位置は取得困難なので、
      // ダミーの値を返す
      return { rows: 1, cols: this._prompt.length };
    }
    
    // 行をクリア
    clearLine(dir: number = 0): void {
      // dir: -1 (left), 0 (entire), 1 (right)
      switch (dir) {
        case -1:
          DebugConsoleAPI.write('\x1b[1K'); // カーソルから行頭までクリア
          break;
        case 1:
          DebugConsoleAPI.write('\x1b[0K'); // カーソルから行末までクリア
          break;
        default:
          DebugConsoleAPI.write('\x1b[2K'); // 行全体をクリア
          break;
      }
    }
    
    // カーソルを移動
    cursorTo(x: number, y?: number): void {
      if (y !== undefined) {
        DebugConsoleAPI.write(`\x1b[${y + 1};${x + 1}H`);
      } else {
        DebugConsoleAPI.write(`\x1b[${x + 1}G`);
      }
    }
    
    // カーソルを相対移動
    moveCursor(dx: number, dy: number): void {
      if (dx < 0) {
        DebugConsoleAPI.write(`\x1b[${Math.abs(dx)}D`);
      } else if (dx > 0) {
        DebugConsoleAPI.write(`\x1b[${dx}C`);
      }
      
      if (dy < 0) {
        DebugConsoleAPI.write(`\x1b[${Math.abs(dy)}A`);
      } else if (dy > 0) {
        DebugConsoleAPI.write(`\x1b[${dy}B`);
      }
    }
    
    // 一時停止
    pause(): this {
      this._isWaitingForInput = false;
      this.emit('pause');
      return this;
    }
    
    // 再開
    resume(): this {
      this.emit('resume');
      return this;
    }
  }
  
  // カーソル制御関数（グローバル）
  const cursorTo = (stream: any, x: number, y?: number): boolean => {
    try {
      if (y !== undefined) {
        DebugConsoleAPI.moveCursor(0, 0); // まず原点に移動
        DebugConsoleAPI.moveCursor(x, y); // 指定位置に移動
      } else {
        DebugConsoleAPI.write(`\x1b[${x + 1}G`);
      }
      return true;
    } catch (error) {
      console.error('cursorTo error:', error);
      return false;
    }
  };
  
  const moveCursor = (stream: any, dx: number, dy: number): boolean => {
    try {
      DebugConsoleAPI.moveCursor(dx, dy);
      return true;
    } catch (error) {
      console.error('moveCursor error:', error);
      return false;
    }
  };
  
  const clearLine = (stream: any, dir: number = 0): boolean => {
    try {
      DebugConsoleAPI.clearLine();
      return true;
    } catch (error) {
      console.error('clearLine error:', error);
      return false;
    }
  };
  
  const clearScreenDown = (stream: any): boolean => {
    try {
      DebugConsoleAPI.write('\x1b[0J');
      return true;
    } catch (error) {
      console.error('clearScreenDown error:', error);
      return false;
    }
  };
  
  return {
    // インターフェースの作成
    createInterface: (options: any): Interface => {
      return new Interface(options);
    },
    
    // Interface クラスをエクスポート
    Interface: Interface,
    
    // カーソル制御関数
    cursorTo,
    moveCursor,
    clearLine,
    clearScreenDown,
    
    // 互換性のための簡単な関数
    question: (query: string): Promise<string> => {
      return new Promise((resolve) => {
        const rl = new Interface({});
        rl.question(query, (answer: string) => {
          rl.close();
          resolve(answer);
        });
      });
    }
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