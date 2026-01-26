/**
 * [NEW ARCHITECTURE] Module Loader
 *
 * ## 役割
 * - モジュールの読み込みと実行
 * - トランスパイル処理の調整
 * - キャッシュとの連携
 * - 循環参照の検出
 */

import { runtimeRegistry } from './RuntimeRegistry';
import { ModuleCache } from './moduleCache';
import { ModuleResolver } from './moduleResolver';
import { createModuleNotFoundError } from './nodeErrors';
import { getParentPath, toAppPath, fsPathToAppPath } from '@/engine/core/pathUtils';
import { runtimeError, runtimeInfo, runtimeWarn } from './runtimeLogger';
import { transpileManager } from './transpileManager';

import { fileRepository } from '@/engine/core/fileRepository';

/**
 * Node.js ビルトインモジュールのリスト
 * `node:` プレフィックス付きもサポート
 */
const NODE_BUILTIN_MODULES = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'zlib',
];

/**
 * ビルトインモジュールかどうかを判定
 * `node:` プレフィックス付きモジュールもサポート
 */
function isBuiltInModule(moduleName: string): boolean {
  // `node:` プレフィックスを削除して正規化
  const normalizedName = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  return NODE_BUILTIN_MODULES.includes(normalizedName);
}

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
  builtinResolver?: (moduleName: string) => any;
}

/**
 * Module Loader
 */
export class ModuleLoader {
  private projectId: string;
  private projectName: string;
  private projectDir: string;
  private debugConsole?: ModuleLoaderOptions['debugConsole'];
  private builtinResolver?: (moduleName: string) => any;
  private cache: ModuleCache;
  private resolver: ModuleResolver;
  private executionCache: ModuleExecutionCache = {};
  private moduleNameMap: Record<string, string> = {}; // モジュール名→解決済みパスのマッピング

  constructor(options: ModuleLoaderOptions) {
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.projectDir = `/projects/${this.projectName}`;
    this.debugConsole = options.debugConsole;
    this.builtinResolver = options.builtinResolver;

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
  /**
   * モジュールを読み込み（非同期）
   */
  async load(moduleName: string, currentFilePath: string): Promise<unknown> {
    runtimeInfo('📦 Loading module:', moduleName, 'from', currentFilePath);

    // モジュールパスを解決
    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) {
      throw createModuleNotFoundError(moduleName, currentFilePath);
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
        const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`);
        err.name = 'Error [ERR_FS_ENOENT]';
        throw err;
      }

      // トランスパイル済みコードと依存関係を取得（キャッシュ優先）
      const transpileResult = await this.getTranspiledCodeWithDeps(resolvedPath, fileContent);

      // デバッグ: transpileResultの内容を確認
      runtimeInfo('📝 Transpile result type:', typeof transpileResult);
      runtimeInfo('📝 Transpile result:', transpileResult);

      const { code, dependencies } = transpileResult;

      // デバッグ: codeとdependenciesの型を確認
      runtimeInfo('📝 Code type:', typeof code, 'Dependencies type:', typeof dependencies);

      // 依存関係を再帰的にロード（ビルトインモジュールは除く）
      if (dependencies && dependencies.length > 0) {
        runtimeInfo('📦 Pre-loading dependencies for', resolvedPath, ':', dependencies);
        for (const dep of dependencies) {
          try {
            // ビルトインモジュールはスキップ（node: プレフィックス付きも含む）
            if (isBuiltInModule(dep)) {
              continue;
            }

            // 依存関係を再帰的にロード
            await this.load(dep, resolvedPath);
          } catch (error) {
            runtimeWarn('⚠️ Failed to pre-load dependency:', dep, 'from', resolvedPath);
          }
        }
      }

      // すべての依存関係がロードされた後、モジュールを実行（同期実行）
      runtimeInfo('📝 About to execute module with code type:', typeof code);
      const moduleExports = this.executeModule(code, resolvedPath);

      // 実行キャッシュを更新
      this.executionCache[resolvedPath].exports = moduleExports;
      this.executionCache[resolvedPath].loaded = true;
      this.executionCache[resolvedPath].loading = false;

      // モジュール名→パスのマッピングを保存（require時の解決用）
      // パッケージ名（node_modulesから）の場合のみマッピングを保存
      if (
        !resolved.isBuiltIn &&
        moduleName &&
        !moduleName.startsWith('.') &&
        !moduleName.startsWith('/')
      ) {
        this.moduleNameMap[moduleName] = resolvedPath;
        runtimeInfo('📝 Stored module name mapping:', moduleName, '→', resolvedPath);
      }

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
   * トランスパイル済みコードと依存関係を取得
   *
   * 依存関係の事前ロードに使用する
   */
  async getTranspiledCodeWithDeps(
    filePath: string,
    content: string
  ): Promise<{ code: string; dependencies: string[] }> {
    // キャッシュをチェック
    const version = this.computeContentVersion(content);
    const cached = await this.cache.get(filePath, version);
    if (cached) {
      runtimeInfo('📦 Using transpile cache (with dependencies):', filePath);
      // デバッグ: キャッシュの内容を確認
      runtimeInfo(
        '📝 Cache structure:',
        typeof cached,
        'code type:',
        typeof cached.code,
        'deps:',
        cached.deps
      );
      return { code: cached.code, dependencies: cached.deps || [] };
    }

    // JSONファイルの場合はそのままJSオブジェクトとしてエクスポート
    if (filePath.endsWith('.json')) {
      return {
        code: `module.exports = ${content};`,
        dependencies: [],
      };
    }

    // トランスパイルが必要か判定
    const needsTranspile = this.needsTranspile(filePath, content);
    if (!needsTranspile) {
      return { code: content, dependencies: [] };
    }

    runtimeInfo('🔄 Transpiling module (extracting dependencies):', filePath);
    const isTypeScript = /\.(ts|mts|cts)$/.test(filePath);

    // TypeScriptの場合はRegistryからトランスパイラを取得
    if (isTypeScript) {
      const transpiler = runtimeRegistry.getTranspilerForFile(filePath);
      if (!transpiler) {
        throw new Error(
          `No transpiler found for ${filePath}. Please install the TypeScript runtime extension.`
        );
      }

      try {
        runtimeInfo(`🔌 Using transpiler: ${transpiler.id}`);

        const result = await transpiler.transpile(content, {
          filePath,
          isTypeScript,
        });

        const deps = result.dependencies || [];
        await this.cache.set(filePath, {
          originalPath: filePath,
          contentHash: version,
          code: result.code,
          sourceMap: result.map,
          deps,
          mtime: Date.now(),
          size: result.code.length,
        });

        return { code: result.code, dependencies: deps };
      } catch (error) {
        runtimeError(`❌ Transpiler failed: ${transpiler.id}`, error);
        throw error;
      }
    }

    // 普通のJSの場合はnormalizeCjsEsmのみ
    const result = await transpileManager.transpile({
      code: content,
      filePath,
      isTypeScript: false,
      isESModule: this.isESModule(content),
      isJSX: false,
    });

    // デバッグ: transpileManagerの結果を確認
    runtimeInfo('📝 TranspileManager result:', typeof result, result);
    runtimeInfo('📝 Result.code type:', typeof result.code);
    runtimeInfo('📝 Result.dependencies:', result.dependencies);

    // キャッシュに保存
    await this.cache.set(filePath, {
      originalPath: filePath,
      contentHash: version,
      code: result.code,
      sourceMap: result.sourceMap,
      deps: result.dependencies,
      mtime: Date.now(),
      size: result.code.length,
    });

    // transpileManager.transpile は既に { code: string, dependencies: string[] } を返すので、そのまま返す
    return result;
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
  /**
   * モジュールを実行
   */
  private globals: Record<string, any> = {};

  /**
   * グローバルオブジェクトを設定
   * NodeRuntimeからprocessなどを注入するために使用
   */
  setGlobals(globals: Record<string, any>): void {
    this.globals = globals;
  }

  /**
   * 依存関係のみを事前ロード（メインモジュールは実行しない）
   */
  async preloadDependencies(moduleName: string, currentFilePath: string): Promise<void> {
    runtimeInfo('📦 Pre-loading dependencies for entry:', moduleName);

    // モジュールパスを解決
    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) {
      throw createModuleNotFoundError(moduleName, currentFilePath);
    }

    if (resolved.isBuiltIn) {
      return;
    }

    const resolvedPath = resolved.path;

    // ファイルを読み込み
    const fileContent = await this.readFile(resolvedPath);
    if (fileContent === null) {
      const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`);
      err.name = 'Error [ERR_FS_ENOENT]';
      throw err;
    }

    // トランスパイル済みコードと依存関係を取得
    const transpileResult = await this.getTranspiledCodeWithDeps(resolvedPath, fileContent);
    const { dependencies } = transpileResult;

    // 依存関係を再帰的にロード（これらは実行される）
    if (dependencies && dependencies.length > 0) {
      runtimeInfo('📦 Pre-loading dependencies for', resolvedPath, ':', dependencies);
      for (const dep of dependencies) {
        try {
          // ビルトインモジュールはスキップ（node: プレフィックス付きも含む）
          if (isBuiltInModule(dep)) {
            continue;
          }

          await this.load(dep, resolvedPath);
        } catch (error) {
          runtimeWarn('⚠️ Failed to pre-load dependency:', dep, 'from', resolvedPath);
        }
      }
    }

    runtimeInfo('✅ Dependencies pre-loaded for:', resolvedPath);
  }

  /**
   * モジュールを実行
   */
  private executeModule(code: string, filePath: string): unknown {
    const module = { exports: {} };
    const exports = module.exports;
    const __filename = filePath;
    const __dirname = this.dirname(filePath);

    // Shebangを削除 (#!/usr/bin/env node など)
    // eval/new Function は Shebang をサポートしていないため
    if (code.startsWith('#!')) {
      code = `//${code}`; // コメントアウトして行数を維持
    }

    // require 関数を定義（同期）
    // Modules must be pre-loaded into execution cache before they can be required
    const require = (moduleName: string): any => {
      runtimeInfo('📦 require (in module):', moduleName, 'from', filePath);

      // Simple synchronous resolution for pre-loaded modules
      let resolvedPath: string | null = null;

      // Try built-in modules first (including node: prefix)
      if (isBuiltInModule(moduleName)) {
        if (this.builtinResolver) {
          const builtIn = this.builtinResolver(moduleName);
          if (builtIn) {
            runtimeInfo('✅ Built-in module resolved (via resolver):', moduleName);
            return builtIn;
          }
        }
        // If no resolver or resolver returned null, try to continue (might be polyfilled?)
        // But usually this means we can't handle it.
        runtimeWarn('⚠️ Built-in module requested but not resolved:', moduleName);
      }

      // Check if module name is in the moduleNameMap (for npm packages)
      if (this.moduleNameMap[moduleName]) {
        resolvedPath = this.moduleNameMap[moduleName];
        runtimeInfo('📝 Found in moduleNameMap:', moduleName, '→', resolvedPath);
      }
      // Resolve path based on module name
      else if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
        // Relative path
        const currentDir = this.dirname(filePath);
        const parts = currentDir.split('/').filter(Boolean);
        const relParts = moduleName.split('/').filter(Boolean);

        for (const part of relParts) {
          if (part === '..') parts.pop();
          else if (part !== '.') parts.push(part);
        }

        resolvedPath = `/${parts.join('/')}`;
      } else if (moduleName.startsWith('@/')) {
        // Alias
        resolvedPath = moduleName.replace('@/', `/projects/${this.projectName}/src/`);
      } else if (moduleName.startsWith('/')) {
        // Absolute path
        resolvedPath = moduleName;
      } else {
        // node_modules package - try to find in moduleNameMap first
        // If not in map, construct the path manually
        const isScoped = moduleName.startsWith('@');
        const packageName = isScoped
          ? moduleName.split('/').slice(0, 2).join('/')
          : moduleName.split('/')[0];
        const subPath = isScoped
          ? moduleName.split('/').slice(2).join('/')
          : moduleName.split('/').slice(1).join('/');

        resolvedPath = `/projects/${this.projectName}/node_modules/${packageName}`;
        if (subPath) {
          resolvedPath += `/${subPath}`;
        }
      }

      // Try to find in execution cache (may need extension)
      if (resolvedPath) {
        // Try exact path first
        if (this.executionCache[resolvedPath]) {
          const cached = this.executionCache[resolvedPath];
          if (cached.loaded) return cached.exports;
          if (cached.loading) {
            runtimeWarn('⚠️ Circular dependency detected:', resolvedPath);
            return cached.exports;
          }
        }

        // Try with common extensions
        const extensions = [
          '',
          '.js',
          '.mjs',
          '.ts',
          '.mts',
          '.tsx',
          '.jsx',
          '/index.js',
          '/index.ts',
        ];
        for (const ext of extensions) {
          const pathWithExt = resolvedPath + ext;
          if (this.executionCache[pathWithExt]) {
            const cached = this.executionCache[pathWithExt];
            if (cached.loaded) return cached.exports;
            if (cached.loading) {
              runtimeWarn('⚠️ Circular dependency detected:', pathWithExt);
              return cached.exports;
            }
          }
        }
      }

      // Module not found in cache - create Node.js style error
      runtimeError(`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${moduleName}'`);
      if (resolvedPath) {
        runtimeError(`  Resolved path: ${resolvedPath}`);
      }
      runtimeError(`  Required from: ${filePath}`);
      throw createModuleNotFoundError(moduleName, filePath);
    };

    // Prepare a sandboxed console that forwards to the ModuleLoader's debugConsole
    // if present, otherwise falls back to runtime logger. This console will be
    // passed into executed modules so their `console.log` calls are captured
    // by the runtime/debug UI.
    const sandboxConsole = {
      log: (...args: unknown[]) => {
        if (this.debugConsole?.log) {
          this.debugConsole.log(...args);
        } else {
          runtimeInfo(...args);
        }
      },
      error: (...args: unknown[]) => {
        if (this.debugConsole?.error) {
          this.debugConsole.error(...args);
        } else {
          runtimeError(...args);
        }
      },
      warn: (...args: unknown[]) => {
        if (this.debugConsole?.warn) {
          this.debugConsole.warn(...args);
        } else {
          runtimeWarn(...args);
        }
      },
      clear: () => {},
    };

    // グローバルオブジェクトの準備
    const process = this.globals.process || { env: {}, argv: [], cwd: () => '/' };
    const Buffer = this.globals.Buffer || { from: () => {}, alloc: () => {} };
    const setTimeout = this.globals.setTimeout || globalThis.setTimeout;
    const setInterval = this.globals.setInterval || globalThis.setInterval;
    const clearTimeout = this.globals.clearTimeout || globalThis.clearTimeout;
    const clearInterval = this.globals.clearInterval || globalThis.clearInterval;
    const global = this.globals.global || globalThis;

    // Temporarily spoof navigator for supports-color browser.js detection
    // supports-color checks globalThis.navigator.userAgentData and userAgent
    // Without this, iOS Safari returns 0 (no color) because it doesn't match Chrome/Chromium
    const originalNavigator = globalThis.navigator;
    const spoofedNavigator = {
      ...(originalNavigator || {}),
      userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
      userAgentData: {
        brands: [{ brand: 'Chromium', version: 120 }], // version as number for > 93 comparison
      },
    };

    // Apply spoofed navigator to globalThis
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: spoofedNavigator,
        configurable: true,
        writable: true,
      });
    } catch (e) {
      // If we can't modify navigator, continue anyway
    }

    // コードをラップして実行。console を受け取るようにして、モジュール内の
    // console.log 呼び出しがここで用意した sandboxConsole を使うようにする。
    // 同期実行のため async は削除
    const wrappedCode = `
      (function(module, exports, require, __filename, __dirname, console, process, Buffer, setTimeout, setInterval, clearTimeout, clearInterval, global) {
        ${code}
        return module.exports;
      })
    `;

    try {
      const executeFunc = eval(wrappedCode);
      // 同期実行
      const result = executeFunc(
        module,
        exports,
        require,
        __filename,
        __dirname,
        sandboxConsole as any,
        process,
        Buffer,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        global
      );
      return result;
    } catch (error) {
      // Minified ESM code (especially from Prettier) may have syntax errors
      // that are difficult to normalize via regex-based transformations.
      // Log the error but don't crash - allow other modules to continue.
      this.warn('⚠️  Module execution failed (non-fatal):', filePath);
      this.warn('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
      });

      // Return empty exports to allow dependent modules to at least load
      // This is especially useful for Prettier where some plugins may fail
      // but the core functionality might still work
      return module.exports || {};
    } finally {
      // Restore original navigator
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
          writable: true,
        });
      } catch (e) {
        // Ignore restoration errors
      }
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

    // MJSファイル (Always transpile .mjs as it is ESM)
    if (/\.mjs$/.test(filePath)) {
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

    return /\b(import|export)\b/.test(cleaned);
  }

  /**
   * ファイルを読み込み
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      await fileRepository.init();
      // パスを正規化して検索
      // Normalize: if FSPath under /projects/{project}, convert to AppPath; otherwise treat as AppPath
      const normalizedPath = filePath.startsWith(`/projects/${this.projectName}`)
        ? fsPathToAppPath(filePath, this.projectName)
        : toAppPath(filePath);
      const file = await fileRepository.getFileByPath(this.projectId, normalizedPath);

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
    // Use core getParentPath directly to maintain consistent semantics
    return getParentPath(filePath);
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.cache.clear();
    this.executionCache = {};
    this.moduleNameMap = {};
  }

  /**
   * モジュール名を解決（同期 require 用）
   * NodeRuntime からも使用される
   */
  resolveModuleName(moduleName: string): string | null {
    return this.moduleNameMap[moduleName] || null;
  }

  /**
   * キャッシュされたモジュールのexportsを取得
   * NodeRuntime からも使用される
   */
  getExports(resolvedPath: string): any {
    if (this.executionCache[resolvedPath]?.loaded) {
      return this.executionCache[resolvedPath].exports;
    }
    return null;
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
