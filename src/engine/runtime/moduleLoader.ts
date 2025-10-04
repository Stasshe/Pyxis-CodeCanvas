/**
 * [NEW ARCHITECTURE] Module Loader
 *
 * ## 役割
 * - モジュールの読み込みと実行
 * - トランスパイル処理の調整
 * - キャッシュとの連携
 * - 循環参照の検出
 */

import { fileRepository } from '@/engine/core/fileRepository';
import { ModuleCache } from './moduleCache';
import { ModuleResolver, type PackageJson } from './moduleResolver';
import { transpileManager } from './transpileManager';

/**
 * モジュール実行キャッシュ（循環参照対策）
 */
interface ModuleExecutionCache {
  [key: string]: {
    exports: unknown;
    loaded: boolean;
    loading: boolean;
  };
}

/**
 * Module Loader Options
 */
export interface ModuleLoaderOptions {
  projectId: string;
  projectName: string;
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

/**
 * Module Loader
 */
export class ModuleLoader {
  private projectId: string;
  private projectName: string;
  private projectDir: string;
  private debugConsole?: ModuleLoaderOptions['debugConsole'];
  private cache: ModuleCache;
  private resolver: ModuleResolver;
  private executionCache: ModuleExecutionCache = {};
  private projectPackageJson: PackageJson | null = null;

  constructor(options: ModuleLoaderOptions) {
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.projectDir = `/projects/${this.projectName}`;
    this.debugConsole = options.debugConsole;

    this.cache = new ModuleCache(this.projectId, this.projectName);
    this.resolver = new ModuleResolver(this.projectId, this.projectName);
  }

  /**
   * 初期化
   */
  async init(): Promise<void> {
    this.log('🚀 Initializing ModuleLoader...');

    // キャッシュを初期化
    await this.cache.init();

    // プロジェクトのpackage.jsonを読み込み
    await this.loadProjectPackageJson();

    this.log('✅ ModuleLoader initialized');
  }

  /**
   * モジュールを読み込み
   */
  async load(moduleName: string, currentFilePath: string): Promise<unknown> {
    this.log('📦 Loading module:', moduleName, 'from', currentFilePath);

    // モジュールパスを解決
    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) {
      throw new Error(`Cannot find module '${moduleName}'`);
    }

    // ビルトインモジュールは解決済みパスを返す
    if (resolved.isBuiltIn) {
      this.log('✅ Built-in module:', moduleName);
      return { __isBuiltIn: true, moduleName };
    }

    // 実行キャッシュをチェック（循環参照対策）
    if (this.executionCache[resolved.path]) {
      const cached = this.executionCache[resolved.path];
      if (cached.loaded) {
        this.log('📦 Using execution cache:', resolved.path);
        return cached.exports;
      }
      if (cached.loading) {
        // 循環参照を検出
        this.warn('⚠️ Circular dependency detected:', resolved.path);
        return cached.exports; // 部分的にロード済みのexportsを返す
      }
    }

    // 実行キャッシュにエントリを作成
    this.executionCache[resolved.path] = {
      exports: {},
      loaded: false,
      loading: true,
    };

    try {
      // ファイルを読み込み
      const content = await this.readFile(resolved.path);
      if (content === null) {
        throw new Error(`File not found: ${resolved.path}`);
      }

      // トランスパイルキャッシュをチェック
      let code = content;
      const isTypeScript = this.isTypeScript(resolved.path);
      const isESModule = this.isESModule(resolved.path, content);

      if (isTypeScript || isESModule) {
        // キャッシュから取得を試みる
        const cached = await this.cache.get(resolved.path);
        if (cached && cached.mtime >= Date.now() - 3600000) {
          // 1時間以内のキャッシュは有効
          this.log('📦 Using transpile cache:', resolved.path);
          code = cached.code;
        } else {
          // トランスパイル
          this.log('🔄 Transpiling:', resolved.path);
          code = await this.transpile(resolved.path, content, isTypeScript, isESModule);

          // キャッシュに保存
          await this.cache.set(resolved.path, {
            originalPath: resolved.path,
            code,
            deps: this.extractDependencies(code),
            mtime: Date.now(),
            size: code.length,
          });
        }
      }

      // モジュールを実行
      const moduleExports = await this.executeModule(resolved.path, code);

      // 実行キャッシュを更新
      this.executionCache[resolved.path].exports = moduleExports;
      this.executionCache[resolved.path].loaded = true;
      this.executionCache[resolved.path].loading = false;

      this.log('✅ Module loaded:', resolved.path);
      return moduleExports;
    } catch (error) {
      // エラー時はキャッシュから削除
      delete this.executionCache[resolved.path];
      this.error('❌ Failed to load module:', moduleName, error);
      throw error;
    }
  }

  /**
   * ファイルがTypeScriptかどうかを判定
   */
  private isTypeScript(filePath: string): boolean {
    return /\.(ts|tsx|mts|cts)$/.test(filePath);
  }

  /**
   * ファイルがES Moduleかどうかを判定
   */
  private isESModule(filePath: string, content: string): boolean {
    // package.jsonのtype設定を確認
    if (this.projectPackageJson?.type === 'module') {
      return filePath.endsWith('.js') || filePath.endsWith('.ts');
    }
    if (this.projectPackageJson?.type === 'commonjs') {
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
   * トランスパイル（SWC wasm使用）
   */
  private async transpile(
    filePath: string,
    content: string,
    isTypeScript: boolean,
    isESModule: boolean
  ): Promise<string> {
    try {
      this.log('🔄 Transpiling with SWC wasm:', filePath);

      // ファイル拡張子からJSXを判定
      const isJSX = /\.(jsx|tsx)$/.test(filePath);

      // SWC wasmでトランスパイル
      const result = await transpileManager.transpile({
        code: content,
        filePath,
        isTypeScript,
        isESModule,
        isJSX,
      });

      this.log('✅ Transpile completed:', {
        filePath,
        originalSize: content.length,
        transpiledSize: result.code.length,
        dependencies: result.dependencies.length,
      });

      return result.code;
    } catch (error) {
      this.error('❌ Transpile failed:', filePath, error);
      // フォールバック: 元のコードを返す
      this.warn('⚠️ Using original code without transpilation');
      return content;
    }
  }



  /**
   * 依存関係を抽出
   */
  private extractDependencies(code: string): string[] {
    const deps: string[] = [];
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;

    let match;
    while ((match = requireRegex.exec(code)) !== null) {
      deps.push(match[1]);
    }
    while ((match = importRegex.exec(code)) !== null) {
      deps.push(match[1]);
    }

    return [...new Set(deps)]; // 重複を削除
  }

  /**
   * モジュールを実行
   */
  private async executeModule(filePath: string, code: string): Promise<unknown> {
    // CommonJS形式でラップ
    const wrappedCode = `
      'use strict';
      const module = { exports: {} };
      const exports = module.exports;
      const __filename = ${JSON.stringify(filePath)};
      const __dirname = ${JSON.stringify(this.dirname(filePath))};
      
      ${code}
      
      return module.exports;
    `;

    // require関数を提供
    const self = this;
    const requireFunc = (moduleName: string) => {
      // 同期的に見えるが、実際には事前にロード済みを前提とする
      // TODO: 非同期requireのサポート
      const cached = self.executionCache[moduleName];
      if (cached?.loaded) {
        return cached.exports;
      }
      throw new Error(`Module not loaded: ${moduleName}. Use async import() instead.`);
    };

    // サンドボックスを構築
    const sandbox = {
      console: {
        log: (...args: unknown[]) => this.log(...args),
        error: (...args: unknown[]) => this.error(...args),
        warn: (...args: unknown[]) => this.warn(...args),
      },
      require: requireFunc,
      module: { exports: this.executionCache[filePath].exports },
      exports: this.executionCache[filePath].exports,
      __filename: filePath,
      __dirname: this.dirname(filePath),
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
    };

    // 実行
    const executeFunc = new Function(...Object.keys(sandbox), wrappedCode);
    return executeFunc(...Object.values(sandbox));
  }

  /**
   * ファイルを読み込み
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
        this.warn('⚠️ Cannot load binary file as module:', normalizedPath);
        return null;
      }

      return file.content;
    } catch (error) {
      this.error('❌ Failed to read file:', filePath, error);
      return null;
    }
  }

  /**
   * プロジェクトのpackage.jsonを読み込み
   */
  private async loadProjectPackageJson(): Promise<void> {
    try {
      const packageJsonPath = `${this.projectDir}/package.json`;
      const content = await this.readFile(packageJsonPath);
      if (content) {
        this.projectPackageJson = JSON.parse(content);
        this.log('📦 Project package.json loaded:', this.projectPackageJson);
      }
    } catch (error) {
      this.log('⚠️ No project package.json found or invalid JSON');
      this.projectPackageJson = null;
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
    this.cache.clear();
    this.resolver.clearCache();
    this.executionCache = {};
  }
}
