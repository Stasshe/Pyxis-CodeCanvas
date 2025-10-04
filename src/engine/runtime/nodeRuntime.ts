/**
 * [NEW ARCHITECTURE] Node.js Runtime Emulator
 *
 * ## 設計原則
 * 1. IndexedDB (fileRepository) を唯一の真実の源として使用
 * 2. GitFileSystemは読み取り専用で使用（ビルトインモジュールfs経由のみ）
 * 3. npm installされたパッケージはIndexedDBから読み取り
 * 4. ES Modulesとcommonjsの両方をサポート
 * 5. 後方互換性は完全に無視した破壊的変更
 *
 * ## アーキテクチャ
 * ```
 * ユーザーコード実行
 *     ↓
 * NodeRuntime.execute()
 *     ↓
 * ┌─────────────────────────────────────┐
 * │ モジュール解決フロー                 │
 * ├─────────────────────────────────────┤
 * │ 1. ビルトインモジュール (fs, path...) │
 * │ 2. node_modules (IndexedDB)         │
 * │ 3. 相対パス (./, ../)               │
 * │ 4. エイリアス (@/)                  │
 * └─────────────────────────────────────┘
 *     ↓
 * ES Module Transformer
 *     ↓
 * Sandbox実行環境
 * ```
 */

import { fileRepository } from '@/engine/core/fileRepository';
import { transformESModules } from '@/engine/node/esModuleTransformer';
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
 * モジュールキャッシュ
 */
interface ModuleCache {
  [key: string]: {
    exports: unknown;
    loaded: boolean;
  };
}

/**
 * パッケージ情報
 */
interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  type?: 'module' | 'commonjs';
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Node.js Runtime Emulator
 */
export class NodeRuntime {
  private projectId: string;
  private projectName: string;
  private debugConsole: ExecutionOptions['debugConsole'];
  private onInput?: ExecutionOptions['onInput'];
  private moduleCache: ModuleCache = {};
  private builtInModules: BuiltInModules;
  private projectDir: string;
  private packageJson: PackageJson | null = null;

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

      // package.jsonを読み込み
      await this.loadPackageJson();

      // ファイルを読み込み
      const fileContent = await this.readFile(filePath);
      if (fileContent === null) {
        throw new Error(`File not found: ${filePath}`);
      }

      // ファイル拡張子を判定
      const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
      const isModule = this.isESModule(filePath, fileContent);

      this.log('📄 File info:', {
        filePath,
        isTypeScript,
        isModule,
        size: fileContent.length,
      });

      // コードを変換
      let transformedCode = fileContent;
      if (isTypeScript) {
        // TODO: TypeScript変換（現在は未実装）
        this.warn('⚠️ TypeScript is not fully supported yet');
      }

      // ES Moduleの変換
      if (isModule) {
        transformedCode = transformESModules(fileContent);
        this.log('🔄 Transformed to CommonJS');
      }

      // サンドボックス環境を構築
      const sandbox = this.createSandbox(filePath);

      // コードを実行
      const wrappedCode = this.wrapCode(transformedCode, filePath);
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
   * ファイルがES Moduleかどうかを判定
   */
  private isESModule(filePath: string, content: string): boolean {
    // package.jsonのtype設定を確認
    if (this.packageJson?.type === 'module') {
      return filePath.endsWith('.js') || filePath.endsWith('.ts');
    }
    if (this.packageJson?.type === 'commonjs') {
      return filePath.endsWith('.mjs') || filePath.endsWith('.mts');
    }

    // 拡張子で判定
    if (filePath.endsWith('.mjs') || filePath.endsWith('.mts')) {
      return true;
    }
    if (filePath.endsWith('.cjs') || filePath.endsWith('.cts')) {
      return false;
    }

    // コンテンツで判定
    return /^\s*(import|export)\s+/m.test(content);
  }

  /**
   * コードをラップ（CommonJS形式）
   */
  private wrapCode(code: string, filePath: string): string {
    return `
      'use strict';
      const module = { exports: {} };
      const exports = module.exports;
      const __filename = ${JSON.stringify(filePath)};
      const __dirname = ${JSON.stringify(this.dirname(filePath))};
      
      ${code}
      
      return module.exports;
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

      // require関数
      require: (moduleName: string) => {
        return self.require(moduleName, currentFilePath);
      },

      // __filename, __dirname は wrapCode で注入
    };
  }

  /**
   * モジュールを読み込み（requireの実装）
   */
  private require(moduleName: string, currentFilePath: string): unknown {
    this.log('📦 require:', moduleName, 'from', currentFilePath);

    // 1. ビルトインモジュールの解決
    const builtInModule = this.resolveBuiltInModule(moduleName);
    if (builtInModule !== null) {
      this.log('✅ Built-in module resolved:', moduleName);
      return builtInModule;
    }

    // 2. モジュールパスを解決
    const resolvedPath = this.resolveModulePath(moduleName, currentFilePath);
    this.log('🔍 Resolved path:', resolvedPath);

    // 3. キャッシュを確認
    if (this.moduleCache[resolvedPath]?.loaded) {
      this.log('📦 Using cached module:', resolvedPath);
      return this.moduleCache[resolvedPath].exports;
    }

    // 4. モジュールを読み込み
    try {
      const moduleContent = this.readFileSync(resolvedPath);
      if (moduleContent === null) {
        throw new Error(`Cannot find module '${moduleName}'`);
      }

      // 5. モジュールを実行
      const moduleExports = this.executeModule(resolvedPath, moduleContent);

      // 6. キャッシュに保存
      this.moduleCache[resolvedPath] = {
        exports: moduleExports,
        loaded: true,
      };

      this.log('✅ Module loaded:', resolvedPath);
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
      'fs/promises': this.builtInModules.fs, // fs モジュール自体がPromise APIを含んでいる
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
   * モジュールパスを解決
   */
  private resolveModulePath(moduleName: string, currentFilePath: string): string {
    // 相対パス
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      const currentDir = this.dirname(currentFilePath);
      const resolved = this.resolvePath(currentDir, moduleName);
      return this.addExtensionIfNeeded(resolved);
    }

    // エイリアス (@/)
    if (moduleName.startsWith('@/')) {
      const resolved = moduleName.replace('@/', `${this.projectDir}/src/`);
      return this.addExtensionIfNeeded(resolved);
    }

    // node_modules
    const nodeModulesPath = this.resolveNodeModules(moduleName);
    if (nodeModulesPath) {
      return nodeModulesPath;
    }

    // 見つからない場合はそのまま返す（エラーハンドリングは呼び出し元で）
    return moduleName;
  }

  /**
   * node_modulesからモジュールを解決
   */
  private resolveNodeModules(moduleName: string): string | null {
    // パッケージ名とサブパスを分離
    let packageName: string;
    let subPath = '';

    if (moduleName.startsWith('@')) {
      // スコープ付きパッケージ (@vue/runtime-core)
      const parts = moduleName.split('/');
      packageName = `${parts[0]}/${parts[1]}`;
      subPath = parts.slice(2).join('/');
    } else {
      // 通常のパッケージ (lodash/merge)
      const parts = moduleName.split('/');
      packageName = parts[0];
      subPath = parts.slice(1).join('/');
    }

    this.log('🔍 Resolving node_modules:', { packageName, subPath });

    // package.jsonを読み込み（エントリーポイント解決用）
    const packageJsonPath = `${this.projectDir}/node_modules/${packageName}/package.json`;
    const packageJsonContent = this.readFileSync(packageJsonPath);

    if (packageJsonContent) {
      try {
        const pkg: PackageJson = JSON.parse(packageJsonContent);
        const entryPoint = pkg.module || pkg.main || 'index.js';

        if (subPath) {
          // サブパス指定あり
          return `${this.projectDir}/node_modules/${packageName}/${subPath}`;
        } else {
          // パッケージルート
          return `${this.projectDir}/node_modules/${packageName}/${entryPoint}`;
        }
      } catch (error) {
        this.warn('⚠️ Failed to parse package.json:', packageJsonPath);
      }
    }

    // フォールバック: 直接ファイルパスを試す
    const fallbackPath = subPath
      ? `${this.projectDir}/node_modules/${packageName}/${subPath}`
      : `${this.projectDir}/node_modules/${packageName}/index.js`;

    const content = this.readFileSync(fallbackPath);
    if (content !== null) {
      return fallbackPath;
    }

    return null;
  }

  /**
   * 拡張子が必要な場合に追加
   */
  private addExtensionIfNeeded(filePath: string): string {
    // 既に拡張子がある場合
    if (/\.(js|mjs|cjs|ts|mts|cts|json)$/.test(filePath)) {
      return filePath;
    }

    // 拡張子を試す順序
    const extensions = ['.js', '.mjs', '.ts', '.mts', '.json'];
    for (const ext of extensions) {
      const pathWithExt = filePath + ext;
      if (this.readFileSync(pathWithExt) !== null) {
        return pathWithExt;
      }
    }

    // index.jsを試す
    const indexPath = `${filePath}/index.js`;
    if (this.readFileSync(indexPath) !== null) {
      return indexPath;
    }

    // 見つからない場合はそのまま返す
    return filePath;
  }

  /**
   * モジュールを実行
   */
  private executeModule(filePath: string, content: string): unknown {
    this.log('🔄 Executing module:', filePath);

    // ES Moduleの変換
    const isModule = this.isESModule(filePath, content);
    let transformedCode = content;
    if (isModule) {
      transformedCode = transformESModules(content);
    }

    // サンドボックス環境を構築
    const sandbox = this.createSandbox(filePath);

    // コードをラップして実行
    const wrappedCode = this.wrapCode(transformedCode, filePath);
    const executeFunc = new Function(...Object.keys(sandbox), wrappedCode);

    return executeFunc(...Object.values(sandbox));
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
   * ファイルを読み込み（同期的に見えるが実際は同期）
   * 注意: これは本来非同期であるべきだが、requireは同期的なのでキャッシュを前提とする
   */
  private readFileSync(filePath: string): string | null {
    try {
      // IndexedDBから同期的に読み取ることはできないため、
      // 事前にキャッシュされていることを前提とする
      // TODO: 実行前にすべてのファイルをメモリにキャッシュする仕組みを追加
      this.warn('⚠️ Synchronous file read is not fully supported:', filePath);
      return null;
    } catch (error) {
      this.error('❌ Failed to read file sync:', filePath, error);
      return null;
    }
  }

  /**
   * package.jsonを読み込み
   */
  private async loadPackageJson(): Promise<void> {
    try {
      const packageJsonPath = `${this.projectDir}/package.json`;
      const content = await this.readFile(packageJsonPath);
      if (content) {
        this.packageJson = JSON.parse(content);
        this.log('📦 package.json loaded:', this.packageJson);
      }
    } catch (error) {
      this.log('⚠️ No package.json found or invalid JSON');
      this.packageJson = null;
    }
  }

  /**
   * パスを正規化
   */
  private normalizePath(filePath: string): string {
    // プロジェクトディレクトリからの相対パスに正規化
    let normalized = filePath;

    // /projects/xxx/ を削除
    if (normalized.startsWith(this.projectDir)) {
      normalized = normalized.slice(this.projectDir.length);
    }

    // 先頭の / を確保
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }

    // 末尾の / を削除
    if (normalized.endsWith('/') && normalized !== '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  /**
   * パスを解決
   */
  private resolvePath(basePath: string, relativePath: string): string {
    const parts = basePath.split('/').filter(Boolean);
    const relParts = relativePath.split('/').filter(Boolean);

    for (const part of relParts) {
      if (part === '..') {
        parts.pop();
      } else if (part !== '.') {
        parts.push(part);
      }
    }

    return '/' + parts.join('/');
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
}

/**
 * Node.jsファイルを実行
 */
export async function executeNodeFile(options: ExecutionOptions): Promise<void> {
  const runtime = new NodeRuntime(options);
  await runtime.execute(options.filePath);
}
