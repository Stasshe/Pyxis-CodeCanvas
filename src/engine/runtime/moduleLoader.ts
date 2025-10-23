/**
 * [NEW ARCHITECTURE] Module Loader
 *
 * ## 役割
 * - モジュールの読み込みと実行
 * - トランスパイル処理の調整
 * - キャッシュとの連携
 * - 循環参照の検出
 */

import { ModuleCache } from './moduleCache';
import { ModuleResolver } from './moduleResolver';
import { normalizePath, dirname } from './pathUtils';
import { runtimeInfo, runtimeWarn, runtimeError } from './runtimeLogger';
import { transpileManager } from './transpileManager';

import { fileRepository } from '@/engine/core/fileRepository';

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
    runtimeInfo('🚀 Initializing ModuleLoader...');

    // キャッシュを初期化
    await this.cache.init();

    runtimeInfo('✅ ModuleLoader initialized');
  }

  /**
   * モジュールを読み込み（非同期）
   */
  async load(moduleName: string, currentFilePath: string): Promise<unknown> {
    runtimeInfo('📦 Loading module:', moduleName, 'from', currentFilePath);

    // モジュールパスを解決
    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) {
      throw new Error(`Cannot find module '${moduleName}'`);
    }

    // ビルトインモジュールは特殊なマーカーを返す
    if (resolved.isBuiltIn) {
      runtimeInfo('✅ Built-in module:', moduleName);
      return { __isBuiltIn: true, moduleName };
    }

    const resolvedPath = resolved.path;

    // 実行キャッシュをチェック（循環参照対策）
    if (this.executionCache[resolvedPath]) {
      const cached = this.executionCache[resolvedPath];
      if (cached.loaded) {
        runtimeInfo('📦 Using execution cache:', resolvedPath);
        return cached.exports;
      }
      if (cached.loading) {
        runtimeWarn('⚠️ Circular dependency detected:', resolvedPath);
        return cached.exports; // 部分的なexportsを返す
      }
    }

    // 実行キャッシュを初期化
    this.executionCache[resolvedPath] = {
      exports: {},
      loaded: false,
      loading: true,
    };

    try {
      // ファイルを読み込み
      const fileContent = await this.readFile(resolvedPath);
      if (fileContent === null) {
        throw new Error(`File not found: ${resolvedPath}`);
      }

      // トランスパイル済みコードを取得（キャッシュ優先）
      const code = await this.getTranspiledCode(resolvedPath, fileContent);

      // モジュールを実行
      const moduleExports = await this.executeModule(code, resolvedPath);

      // 実行キャッシュを更新
      this.executionCache[resolvedPath].exports = moduleExports;
      this.executionCache[resolvedPath].loaded = true;
      this.executionCache[resolvedPath].loading = false;

      runtimeInfo('✅ Module loaded:', resolvedPath);
      return moduleExports;
    } catch (error) {
      // エラー時はキャッシュをクリア
      delete this.executionCache[resolvedPath];
      runtimeError('❌ Failed to load module:', resolvedPath, error);
      throw error;
    }
  }

  /**
   * トランスパイル済みコードを取得
   *
   * Public so callers (like NodeRuntime) can reuse the same transpile + cache
   * logic for entry/root files.
   */
  async getTranspiledCode(filePath: string, content: string): Promise<string> {
    // キャッシュをチェック
    // Use content-based versioning so cache invalidates when file content changes
    const version = this.computeContentVersion(content);
    const cached = await this.cache.get(filePath, version);
    if (cached) {
      runtimeInfo('📦 Using transpile cache:', filePath);
      return cached.code;
    }

    // トランスパイルが必要か判定
    const needsTranspile = this.needsTranspile(filePath, content);
    let code = content;

    if (needsTranspile) {
      runtimeInfo('🔄 Transpiling module:', filePath);
      const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(filePath);
      const isJSX = /\.(jsx|tsx)$/.test(filePath);
      const isESModule = this.isESModule(content);

      const result = await transpileManager.transpile({
        code: content,
        filePath,
        isTypeScript,
        isESModule,
        isJSX,
      });

      code = result.code;

      // キャッシュに保存
      await this.cache.set(
        filePath,
        {
          originalPath: filePath,
          code: result.code,
          sourceMap: result.sourceMap,
          deps: result.dependencies,
          mtime: Date.now(),
          size: result.code.length,
        },
        version
      );

      runtimeInfo('✅ Transpile completed and cached');
    }

    return code;
  }

  /**
   * Compute a simple content-based version string. We keep it inexpensive (32-bit
   * rolling hash -> base36) because content may be long and this is called frequently.
   */
  private computeContentVersion(content: string): string {
    let h = 0;
    for (let i = 0; i < content.length; i++) {
      const ch = content.charCodeAt(i);
      h = (h << 5) - h + ch;
      h = h & h;
    }
    return Math.abs(h).toString(36);
  }

  /**
   * モジュールを実行
   */
  private async executeModule(code: string, filePath: string): Promise<unknown> {
    const module = { exports: {} };
    const exports = module.exports;
    const __filename = filePath;
    const __dirname = this.dirname(filePath);

    // __require__ 関数を定義（非同期）
    const __require__ = async (moduleName: string) => {
      return await this.load(moduleName, filePath);
    };

    // コードをラップして実行
    const wrappedCode = `
      (async function(module, exports, __require__, __filename, __dirname) {
        ${code}
        return module.exports;
      })
    `;

    try {
      const executeFunc = eval(wrappedCode);
      const result = await executeFunc(module, exports, __require__, __filename, __dirname);
      return result;
    } catch (error) {
      this.error('❌ Module execution failed:', filePath);
      this.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });
      this.error('Code snippet (first 500 chars):', code.slice(0, 500));
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

    // require()を含む（非同期化が必要）
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
   * ファイルを読み込み
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);

      // パスを正規化して検索
      const normalizedPath = normalizePath(filePath, this.projectName);
      const file = files.find(f => normalizePath(f.path, this.projectName) === normalizedPath);

      if (!file) {
        this.error('❌ File not found:', filePath, '→', normalizedPath);
        return null;
      }

      if (file.isBufferArray && file.bufferContent) {
        this.warn('⚠️ Cannot execute binary file:', filePath);
        return null;
      }

      return file.content;
    } catch (error) {
      this.error('❌ Failed to read file:', filePath, error);
      return null;
    }
  }

  /**
   * ディレクトリパスを取得
   */
  private dirname(filePath: string): string {
    return dirname(filePath);
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.cache.clear();
    this.executionCache = {};
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
