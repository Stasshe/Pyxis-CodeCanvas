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

import { fileRepository } from '@/engine/core/fileRepository';
import { createBuiltInModules, type BuiltInModules } from '@/engine/node/builtInModule';
import { ModuleLoader } from './moduleLoader';
import { transpileManager } from './transpileManager';
import { runtimeInfo, runtimeWarn, runtimeError } from './runtimeLogger';

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
  async execute(filePath: string): Promise<void> {
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
      let code = fileContent;
      const needsTranspile = this.needsTranspile(filePath, fileContent);

      if (needsTranspile) {
        runtimeInfo('🔄 Transpiling main file:', filePath);
        
        const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(filePath);
        const isJSX = /\.(jsx|tsx)$/.test(filePath);
        const isESModule = this.isESModule(fileContent);

        const result = await transpileManager.transpile({
          code: fileContent,
          filePath,
          isTypeScript,
          isESModule,
          isJSX,
        });

        code = result.code;
        runtimeInfo('✅ Transpile completed',code);
        fileRepository.createFile(this.projectId, '/cache/j.js', code,'file');
      }

      // サンドボックス環境を構築
      const sandbox = await this.createSandbox(filePath);

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
  private async createSandbox(currentFilePath: string): Promise<Record<string, unknown>> {
    const self = this;

    // __require__ 関数（thenable Proxy を返すことで `await __require__('fs').promises` のような
    // パターンでも正しく動作するようにする）
    // NOTE: async function は常に Promise を返すためプロパティアクセスの優先度による問題が
    // 発生していた。ここでは Promise をラップする thenable Proxy を返す。
    const __require__ = (moduleName: string) => {
      runtimeInfo('📦 __require__:', moduleName);

      // 実際のロード処理を行う Promise
      const loadPromise = (async () => {
        // ビルトインモジュールを先にチェック
        const builtInModule = this.resolveBuiltInModule(moduleName);
        if (builtInModule !== null) {
          runtimeInfo('✅ Built-in module resolved:', moduleName);
          return builtInModule;
        }

        // ModuleLoaderでユーザーモジュールを読み込み
        try {
          const moduleExports = await self.moduleLoader.load(moduleName, currentFilePath);

          // ビルトインモジュールマーカーを処理
          if (typeof moduleExports === 'object' && moduleExports !== null) {
            const obj = moduleExports as any;
            if (obj.__isBuiltIn) {
              return this.resolveBuiltInModule(obj.moduleName);
            }
          }

          return moduleExports;
        } catch (error) {
          runtimeError('❌ Failed to load module:', moduleName, error);
          throw new Error(`Cannot find module '${moduleName}'`);
        }
      })();

      // thenable Proxy を返す。これによりプロパティアクセス（例: .promises）は
      // 同期的に thenable のプロパティ（Promise）として取得でき、`await __require__('fs').promises` が
      // 正しく動作する。
      const wrapper = new Proxy(loadPromise as any, {
        get(target, prop: PropertyKey) {
          // Promise の then/catch/finally はそのままバインドして返す（await 対応）
          if (prop === 'then' || prop === 'catch' || prop === 'finally') {
            return (target as any)[prop].bind(target);
          }

          // その他のプロパティアクセスは、ロードされたモジュールから該当プロパティを返す Promise を返す
          // 例えば `.promises` へのアクセスは Promise を返し、その後に外側で await される想定
          return (target as Promise<any>).then(mod => {
            if (mod == null) return undefined;
            return (mod as any)[prop];
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
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
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
        argv: ['node', currentFilePath],
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
      fs: this.builtInModules.fs,
      'fs/promises': this.builtInModules.fs,
      path: this.builtInModules.path,
      os: this.builtInModules.os,
      util: this.builtInModules.util,
      http: this.builtInModules.http,
      https: this.builtInModules.https,
      buffer: { Buffer: this.builtInModules.Buffer },
      readline: this.builtInModules.readline,
    };

    return builtIns[moduleName] || null;
  }

  /**
   * ファイルを読み込み（非同期）
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const normalizedPath = this.normalizePath(filePath);

      const file = files.find((f) => this.normalizePath(f.path) === normalizedPath);
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
