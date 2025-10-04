/**
 * [NEW ARCHITECTURE] Node.js Runtime Emulator
 *
 * ## 設計原則
 * 1. IndexedDB (fileRepository) を唯一の真実の源として使用
 * 2. ModuleLoaderによる高度なモジュール解決
 * 3. npm installされたパッケージはIndexedDBから読み取り
 * 4. ES Modulesとcommonjsの両方をサポート
 * 5. トランスパイルキャッシュによる高速化
 *
 * ## アーキテクチャ
 * ```
 * ユーザーコード実行
 *     ↓
 * NodeRuntime.execute()
 *     ↓
 * ModuleLoader
 *     ├─ ModuleResolver (パス解決)
 *     ├─ ModuleCache (トランスパイルキャッシュ)
 *     └─ Transpiler (ES Module → CommonJS)
 *     ↓
 * Sandbox実行環境
 * ```
 */

import { fileRepository } from '@/engine/core/fileRepository';
import { createBuiltInModules, type BuiltInModules } from '@/engine/node/builtInModule';
import { ModuleLoader } from './moduleLoader';

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

    // ビルトインモジュールの初期化
    this.builtInModules = createBuiltInModules({
      projectDir: this.projectDir,
      projectId: this.projectId,
      projectName: this.projectName,
    });

    // ModuleLoaderの初期化
    this.moduleLoader = new ModuleLoader({
      projectId: this.projectId,
      projectName: this.projectName,
      debugConsole: this.debugConsole,
    });

    this.log('🚀 NodeRuntime initialized', {
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
      this.log('▶️ Executing file:', filePath);

      // ModuleLoaderを初期化
      await this.moduleLoader.init();

      // ファイルを読み込み
      const fileContent = await this.readFile(filePath);
      if (fileContent === null) {
        throw new Error(`File not found: ${filePath}`);
      }

      this.log('📄 File loaded:', {
        filePath,
        size: fileContent.length,
      });

      // トランスパイルが必要か判定
      let code = fileContent;
      const needsTranspile = this.needsTranspile(filePath, fileContent);

      if (needsTranspile) {
        this.log('🔄 Transpiling main file:', filePath);
        const { transpileManager } = await import('./transpileManager');
        
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
        this.log('✅ Transpile completed');
      }

      // サンドボックス環境を構築
      const sandbox = this.createSandbox(filePath);

      // コードを実行
      const wrappedCode = this.wrapCode(code, filePath);
      const executeFunc = new Function(...Object.keys(sandbox), wrappedCode);
      
      this.log('✅ Code compiled successfully');
      await executeFunc(...Object.values(sandbox));
      this.log('✅ Execution completed');
    } catch (error) {
      this.error('❌ Execution failed:', error);
      throw error;
    }
  }

  /**
   * トランスパイルが必要か判定
   */
  private needsTranspile(filePath: string, content: string): boolean {
    // TypeScriptファイル
    if (/\.(ts|tsx|mts|cts)$/.test(filePath)) {
      return true;
    }

    // JSXファイル
    if (/\.(jsx|tsx)$/.test(filePath)) {
      return true;
    }

    // ES Module構文を含む
    if (this.isESModule(content)) {
      return true;
    }

    return false;
  }

  /**
   * ES Moduleかどうかを判定
   */
  private isESModule(content: string): boolean {
    // コメントと文字列を除外して判定
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '');

    return /^\s*(import|export)\s+/m.test(cleaned);
  }

  /**
   * コードをラップ（CommonJS形式）
   */
  private wrapCode(code: string, filePath: string): string {
    return `
      'use strict';
      (async () => {
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
  private createSandbox(currentFilePath: string): Record<string, unknown> {
    const self = this;

    return {
      // グローバルオブジェクト
      console: {
        log: (...args: unknown[]) => this.log(...args),
        error: (...args: unknown[]) => this.error(...args),
        warn: (...args: unknown[]) => this.warn(...args),
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
      },
      Buffer: this.builtInModules.Buffer,

      // require関数（ModuleLoaderを使用）
      require: (moduleName: string) => {
        return self.require(moduleName, currentFilePath);
      },

      // __filename, __dirname は wrapCode で注入
    };
  }

  /**
   * モジュールを読み込み（requireの実装）
   */
  private async require(moduleName: string, currentFilePath: string): Promise<unknown> {
    this.log('📦 require:', moduleName, 'from', currentFilePath);

    // ビルトインモジュールの解決
    const builtInModule = this.resolveBuiltInModule(moduleName);
    if (builtInModule !== null) {
      this.log('✅ Built-in module resolved:', moduleName);
      return builtInModule;
    }

    // ModuleLoaderを使用してモジュールを読み込み
    try {
      const moduleExports = await this.moduleLoader.load(moduleName, currentFilePath);

      // ビルトインモジュールの場合
      if (typeof moduleExports === 'object' && moduleExports !== null) {
        const obj = moduleExports as any;
        if (obj.__isBuiltIn) {
          return this.resolveBuiltInModule(obj.moduleName);
        }
      }

      return moduleExports;
    } catch (error) {
      this.error('❌ Failed to load module:', moduleName, error);
      throw new Error(`Cannot find module '${moduleName}'`);
    }
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
        // バイナリファイル
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
