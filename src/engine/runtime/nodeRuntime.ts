/**
 * [NEW ARCHITECTURE] Node.js Runtime Emulator
 *
 * ## 設計原則
 * 1. IndexedDB (fileRepository) を唯一の真実の源として使用
 * 2. ModuleLoaderによる高度なモジュール解決
 * 3. npm installされたパッケージはIndexedDBから読み取り
 * 4. ES Modulesとcommonjsの両方をサポート
 * 5. トランスパイルキャッシュによる高速化
 * 6. require()は非同期化（await __require__()に変換）
 */

import { ModuleLoader } from './moduleLoader';
import { runtimeInfo, runtimeWarn, runtimeError } from './runtimeLogger';

import { fileRepository } from '@/engine/core/fileRepository';
import { createBuiltInModules, type BuiltInModules } from '@/engine/node/builtInModule';

/**
 * 実行オプション
 */
export interface ExecutionOptions {
  projectId: string;
  projectName: string;
  filePath: string;
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  onInput?: (prompt: string, callback: (input: string) => void) => void;
}

/**
 * Node.js Runtime Emulator
 */
export class NodeRuntime {
  private projectId: string;
  private projectName: string;
  private debugConsole: ExecutionOptions['debugConsole'];
  private onInput?: ExecutionOptions['onInput'];
  private builtInModules: BuiltInModules;
  private moduleLoader: ModuleLoader;
  private projectDir: string;
  
  // イベントループ追跡
  private activeTimers: Set<any> = new Set();
  private eventLoopResolve: (() => void) | null = null;

  constructor(options: ExecutionOptions) {
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.debugConsole = options.debugConsole;
    this.onInput = options.onInput;
    this.projectDir = `/projects/${this.projectName}`;

    // ビルトインモジュールの初期化（onInputを渡す）
    this.builtInModules = createBuiltInModules({
      projectDir: this.projectDir,
      projectId: this.projectId,
      projectName: this.projectName,
      onInput: this.onInput,
    });

    // ModuleLoaderの初期化
    this.moduleLoader = new ModuleLoader({
      projectId: this.projectId,
      projectName: this.projectName,
      debugConsole: this.debugConsole,
    });

    runtimeInfo('🚀 NodeRuntime initialized', {
      projectId: this.projectId,
      projectName: this.projectName,
      projectDir: this.projectDir,
    });
  }

  /**
   * ファイルを実行
   */
  async execute(filePath: string, argv: string[] = []): Promise<void> {
    try {
      runtimeInfo('▶️ Executing file:', filePath);

      // ModuleLoaderを初期化
      await this.moduleLoader.init();

      // ファイルを読み込み
      const fileContent = await this.readFile(filePath);
      if (fileContent === null) {
        throw new Error(`File not found: ${filePath}`);
      }

      runtimeInfo('📄 File loaded:', {
        filePath,
        size: fileContent.length,
      });

      // トランスパイル（require → await __require__ に変換）
      // Use ModuleLoader.getTranspiledCode so the entry file benefits from
      // the same transpile cache and disk-backed cache as other modules.
      // Don't fallback to simple transpile; always use ModuleLoader.
      // Don't fallback to original code.
      const code = await this.moduleLoader.getTranspiledCode(filePath, fileContent);

      // サンドボックス環境を構築
      const sandbox = await this.createSandbox(filePath, argv);

      // コードを実行（async関数としてラップ）
      const wrappedCode = this.wrapCode(code, filePath);
      const executeFunc = new Function(...Object.keys(sandbox), wrappedCode);

      runtimeInfo('✅ Code compiled successfully');
      await executeFunc(...Object.values(sandbox));
      runtimeInfo('✅ Execution completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      runtimeError('❌ Execution failed:', errorMessage);
      if (errorStack) {
        runtimeError('Stack trace:', errorStack);
      }
      throw error;
    }
  }

  /**
   * イベントループが空になるまで待つ（本物のNode.jsと同じ挙動）
   */
  async waitForEventLoop(): Promise<void> {
    // アクティブなタイマーがなければすぐに完了
    if (this.activeTimers.size === 0) {
      runtimeInfo('✅ Event loop is already empty');
      return;
    }

    runtimeInfo('⏳ Waiting for event loop to complete...', {
      activeTimers: this.activeTimers.size,
    });

    // イベントループが空になるまで待機
    return new Promise<void>((resolve) => {
      this.eventLoopResolve = resolve;
      // タイムアウト: 最大30秒待つ（無限ループ防止）
      setTimeout(() => {
        if (this.eventLoopResolve) {
          runtimeInfo('⚠️ Event loop timeout after 30s');
          this.eventLoopResolve();
          this.eventLoopResolve = null;
        }
      }, 30000);
    });
  }

  private checkEventLoop() {
    if (this.activeTimers.size === 0 && this.eventLoopResolve) {
      runtimeInfo('✅ Event loop is now empty');
      this.eventLoopResolve();
      this.eventLoopResolve = null;
    }
  }

  /**
   * トランスパイルが必要か判定
   */
  private needsTranspile(filePath: string, content: string): boolean {
    if (/\.(ts|tsx|mts|cts)$/.test(filePath)) {
      return true;
    }

    if (/\.(jsx|tsx)$/.test(filePath)) {
      return true;
    }

    if (this.isESModule(content)) {
      return true;
    }

    // require()を含む場合も変換が必要（await __require__に変換）
    if (/require\s*\(/.test(content)) {
      return true;
    }

    return false;
  }

  /**
   * ES Moduleかどうかを判定
   */
  private isESModule(content: string): boolean {
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '');

    return /^\s*(import|export)\s+/m.test(cleaned);
  }

  /**
   * コードをラップ（async関数として実行）
   */
  private wrapCode(code: string, filePath: string): string {
    return `
      return (async () => {
        'use strict';
        const module = { exports: {} };
        const exports = module.exports;
        const __filename = ${JSON.stringify(filePath)};
        const __dirname = ${JSON.stringify(this.dirname(filePath))};
        
        ${code}
        
        return module.exports;
      })();
    `;
  }

  /**
   * サンドボックス環境を構築
   */
  private async createSandbox(currentFilePath: string, argv: string[] = []): Promise<Record<string, unknown>> {
    const self = this;

    // __require__ 関数（thenable Proxy を返すことで `await __require__('fs').promises` のような
    // パターンでも正しく動作するようにする）
    // NOTE: async function は常に Promise を返すためプロパティアクセスの優先度による問題が
    // 発生していた。ここでは Promise をラップする thenable Proxy を返す。
    const __require__ = (moduleName: string) => {
      runtimeInfo('📦 __require__:', moduleName);

      // 実際のロード処理を行う Promise。
      // built-in モジュールは同期的に解決できるため、その場合は
      // loadPromise.__syncValue に実体を格納しておき、Proxy が同期的に
      // 値/関数を返せるようにする。非同期モジュールは通常どおり load する。
      let resolveFn: (v: any) => void;
      let rejectFn: (e: any) => void;
      const loadPromise: any = new Promise<any>((res, rej) => {
        resolveFn = res;
        rejectFn = rej;
      });

      // まずビルトインモジュールを同期チェック
      const builtInModule = this.resolveBuiltInModule(moduleName);
      if (builtInModule !== null) {
        runtimeInfo('✅ Built-in module resolved:', moduleName);
        // 同期値マーカーを付与してすぐに解決
        (loadPromise as any).__syncValue = builtInModule;
        resolveFn!(builtInModule);
      } else {
        // 非ビルトイン: 非同期ロードを開始
        (async () => {
          try {
            // Support package.json "imports" specifiers like `#ansi-styles`.
            // If the specifier starts with `#`, try to resolve it via the project's package.json
            // and use the resolved path/target when loading.
            let toLoad = moduleName;
            try {
              if (typeof moduleName === 'string' && moduleName.startsWith('#')) {
                const resolved = await self.resolveImportSpecifier(moduleName, currentFilePath);
                if (resolved) {
                  runtimeInfo('🔗 Resolved import specifier', moduleName, '->', resolved);
                  toLoad = resolved;
                }
              }
            } catch (e) {
              // resolution failure should not crash the loader; fall back to original name
              runtimeWarn('⚠️ Failed to resolve import specifier:', moduleName, e);
            }

            const moduleExports = await self.moduleLoader.load(toLoad, currentFilePath);

            // ビルトインモジュールマーカーを処理
            if (typeof moduleExports === 'object' && moduleExports !== null) {
              const obj = moduleExports as any;
              if (obj.__isBuiltIn) {
                const resolved = this.resolveBuiltInModule(obj.moduleName);
                (loadPromise as any).__syncValue = resolved;
                resolveFn!(resolved);
                return;
              }
            }

            resolveFn!(moduleExports);
          } catch (error) {
            runtimeError('❌ Failed to load module:', moduleName, error);
            rejectFn!(new Error(`Cannot find module '${moduleName}'`));
          }
        })();
      }

      // thenable Proxy を返す。これによりプロパティアクセス（例: .promises）は
      // 同期的に thenable のプロパティ（Promise）として取得でき、`await __require__('fs').promises` が
      // 正しく動作する。
      const wrapper = new Proxy(loadPromise as any, {
        get(target, prop: PropertyKey) {
          // Promise の then/catch/finally はそのままバインドして返す（await 対応）
          if (prop === 'then' || prop === 'catch' || prop === 'finally') {
            return (target as any)[prop].bind(target);
          }

          // Symbol のような特殊プロパティはそのまま返す
          if (typeof prop === 'symbol') {
            return (target as any)[prop];
          }

          // まず同期解決済みの値があれば同期的に返す（built-in モジュール向け）
          const syncVal = (target as any).__syncValue;
          if (syncVal !== undefined) {
            const v = (syncVal as any)[prop];
            if (typeof v === 'function') {
              // 元のオブジェクトにバインドした関数をそのまま返す（同期的）
              return (v as Function).bind(syncVal);
            }
            return v;
          }

          // 非同期モジュール: Promise 解決後のプロパティを返す。関数なら thenable なラッパーを返す。
          return (target as Promise<any>).then(mod => {
            if (mod == null) return undefined;

            const value = (mod as any)[prop];

            if (typeof value === 'function') {
              const fnWrapper = (...args: unknown[]) => {
                return (target as Promise<any>).then(actualMod => {
                  const actualValue = actualMod == null ? undefined : (actualMod as any)[prop];
                  if (typeof actualValue !== 'function') {
                    throw new Error(
                      `Property '${String(prop)}' is not a function on module '${moduleName}'`
                    );
                  }
                  return actualValue.apply(actualMod, args);
                });
              };
              (fnWrapper as any).then = (onFulfilled: any, onRejected: any) => {
                return (target as Promise<any>).then(mod => {
                  const actualValue = mod == null ? undefined : (mod as any)[prop];
                  return Promise.resolve(actualValue).then(onFulfilled, onRejected);
                }, onRejected);
              };
              return fnWrapper;
            }

            return value;
          });
        },

        // モジュール自体が関数として扱われた場合: __require__('x')(...)
        apply(target, thisArg, argsList) {
          const syncVal = (target as any).__syncValue;
          if (syncVal !== undefined) {
            if (typeof syncVal !== 'function') {
              throw new Error(`Module '${moduleName}' is not callable`);
            }
            return (syncVal as any).apply(thisArg, argsList as any);
          }
          return (target as Promise<any>).then(mod => {
            if (typeof mod !== 'function') {
              throw new Error(`Module '${moduleName}' is not callable`);
            }
            return (mod as any).apply(thisArg, argsList as any);
          });
        },
      });

      return wrapper;
    };

    return {
      // グローバルオブジェクト
      // sandbox console: prefer debugConsole (output from executed file). If absent, fall back to runtime logger.
      console: {
        log: (...args: unknown[]) => {
          if (this.debugConsole && this.debugConsole.log) {
            this.debugConsole.log(...args);
          } else {
            runtimeInfo(...args);
          }
        },
        error: (...args: unknown[]) => {
          if (this.debugConsole && this.debugConsole.error) {
            this.debugConsole.error(...args);
          } else {
            runtimeError(...args);
          }
        },
        warn: (...args: unknown[]) => {
          if (this.debugConsole && this.debugConsole.warn) {
            this.debugConsole.warn(...args);
          } else {
            runtimeWarn(...args);
          }
        },
        clear: () => this.debugConsole?.clear(),
      },
      // ラップされたsetTimeout/setInterval（イベントループ追跡用）
      setTimeout: (handler: TimerHandler, timeout?: number, ...args: any[]): number => {
        const timerId = setTimeout(() => {
          this.activeTimers.delete(timerId);
          if (typeof handler === 'function') {
            handler(...args);
          }
          this.checkEventLoop();
        }, timeout) as any;
        this.activeTimers.add(timerId);
        return timerId as number;
      },
      setInterval: (handler: TimerHandler, timeout?: number, ...args: any[]): number => {
        const intervalId = setInterval(() => {
          if (typeof handler === 'function') {
            handler(...args);
          }
        }, timeout) as any;
        this.activeTimers.add(intervalId);
        return intervalId as number;
      },
      clearTimeout: (id?: number) => {
        if (id !== undefined) {
          clearTimeout(id);
          this.activeTimers.delete(id);
          this.checkEventLoop();
        }
      },
      clearInterval: (id?: number) => {
        if (id !== undefined) {
          clearInterval(id);
          this.activeTimers.delete(id);
          this.checkEventLoop();
        }
      },
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      JSON,
      Error,
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,

      // Node.js グローバル
      global: globalThis,
      process: {
        env: {},
        argv: ['node', currentFilePath].concat(argv || []),
        cwd: () => this.projectDir,
        platform: 'browser',
        version: 'v18.0.0',
        versions: {
          node: '18.0.0',
          v8: '10.0.0',
        },
        stdin: {
          on: () => {},
          once: () => {},
          removeListener: () => {},
          setRawMode: () => {},
          pause: () => {},
          resume: () => {},
          isTTY: true,
        },
        stdout: {
          write: (data: string) => {
            if (this.debugConsole && this.debugConsole.log) {
              this.debugConsole.log(data);
            } else {
              runtimeInfo(data);
            }
            return true;
          },
          isTTY: true,
        },
        stderr: {
          write: (data: string) => {
            if (this.debugConsole && this.debugConsole.error) {
              this.debugConsole.error(data);
            } else {
              runtimeError(data);
            }
            return true;
          },
          isTTY: true,
        },
      },
      Buffer: this.builtInModules.Buffer,

      // __require__ 関数（非同期）
      __require__,
    };
  }

  /**
   * ビルトインモジュールを解決
   */
  private resolveBuiltInModule(moduleName: string): unknown | null {
    const builtIns: Record<string, unknown> = {
      'fs': this.builtInModules.fs,
      'fs/promises': this.builtInModules.fs,
      'path': this.builtInModules.path,
      'os': this.builtInModules.os,
      'util': this.builtInModules.util,
      'http': this.builtInModules.http,
      'https': this.builtInModules.https,
      'buffer': { Buffer: this.builtInModules.Buffer },
      'readline': this.builtInModules.readline,
    };

    return builtIns[moduleName] || null;
  }

  /**
   * package.json の "imports" を解決する (specifier が # で始まる場合)
   * - project の package.json を探し、imports マッピングを参照する
   * - 条件付きマッピングがある場合は 'node' を優先し、なければ 'default' を使う
   * - './' で始まるローカルパスは projectDir を基準に展開して返す
   */
  private async resolveImportSpecifier(
    specifier: string,
    _currentFilePath: string
  ): Promise<string | null> {
    try {
      await fileRepository.init();
      // package.json はプロジェクトルートにあるはずなので normalizePath === '/package.json' で探す
      const pkgFile = await fileRepository.getFileByPath(this.projectId, '/package.json');
      if (!pkgFile || !pkgFile.content) return null;

      let pkgJson: any;
      try {
        pkgJson = JSON.parse(pkgFile.content);
      } catch (e) {
        runtimeWarn('⚠️ Failed to parse package.json for imports resolution:', e);
        return null;
      }

      const imports = pkgJson.imports;
      if (!imports) return null;

      const mapping = imports[specifier];
      if (mapping === undefined) return null;

      let target: string | null = null;
      if (typeof mapping === 'string') {
        target = mapping;
      } else if (typeof mapping === 'object' && mapping !== null) {
        // prefer 'node', then 'default'
        if (typeof mapping.node === 'string') target = mapping.node;
        else if (typeof mapping.default === 'string') target = mapping.default;
        else {
          // fallback: first string property
          for (const k of Object.keys(mapping)) {
            if (typeof mapping[k] === 'string') {
              target = mapping[k];
              break;
            }
          }
        }
      }

      if (!target) return null;

      // ローカル相対パスなら projectDir を基準に絶対パス化
      if (target.startsWith('./')) {
        const rel = target.slice(2).replace(/^\/+|^\/+/g, '');
        const resolved = this.projectDir.replace(/\/$/, '') + '/' + rel.replace(/^\/+/, '');
        return resolved;
      }

      // 先頭スラッシュは projectDir をプレフィックスして扱う
      if (target.startsWith('/')) {
        return this.projectDir.replace(/\/$/, '') + target;
      }

      // それ以外はパッケージ名などの可能性があるのでそのまま返す
      return target;
    } catch (error) {
      runtimeWarn('⚠️ Error while resolving import specifier:', specifier, error);
      return null;
    }
  }

  /**
   * ファイルを読み込み（非同期）
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      await fileRepository.init();
      const normalizedPath = this.normalizePath(filePath);

      const file = await fileRepository.getFileByPath(this.projectId, normalizedPath);
      if (!file) {
        this.log('⚠️ File not found in IndexedDB:', normalizedPath);
        return null;
      }

      if (file.isBufferArray && file.bufferContent) {
        this.warn('⚠️ Cannot execute binary file:', normalizedPath);
        return null;
      }

      return file.content;
    } catch (error) {
      this.error('❌ Failed to read file:', filePath, error);
      return null;
    }
  }

  /**
   * パスを正規化
   */
  private normalizePath(filePath: string): string {
    let normalized = filePath;

    if (normalized.startsWith(this.projectDir)) {
      normalized = normalized.slice(this.projectDir.length);
    }

    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }

    if (normalized.endsWith('/') && normalized !== '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  /**
   * ディレクトリパスを取得
   */
  private dirname(filePath: string): string {
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/') || '/';
  }

  /**
   * ログ出力
   */
  private log(...args: unknown[]): void {
    this.debugConsole?.log(...args);
  }

  /**
   * エラー出力
   */
  private error(...args: unknown[]): void {
    this.debugConsole?.error(...args);
  }

  /**
   * 警告出力
   */
  private warn(...args: unknown[]): void {
    this.debugConsole?.warn(...args);
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.moduleLoader.clearCache();
  }
}

/**
 * Node.jsファイルを実行
 */
export async function executeNodeFile(options: ExecutionOptions): Promise<void> {
  const runtime = new NodeRuntime(options);
  await runtime.execute(options.filePath);
}
