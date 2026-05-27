/**
 * Module Loader
 *
 * ## 役割
 * - モジュールの読み込みと実行
 * - トランスパイル処理の調整
 * - キャッシュとの連携
 * - 循環参照の検出
 */

import { fileRepository } from '@/engine/core/fileRepository';
import { fsPathToAppPath, getParentPath, toAppPath } from '@/engine/core/pathUtils';
import type { RuntimeCacheMount } from '@/engine/runtime/storage/RuntimeCacheMount';
import { runtimeRegistry } from '../core/RuntimeRegistry';
import { runtimeError, runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import { createModuleNotFoundError } from '../nodejs/nodeErrors';
import { isProcessExitSignal } from '../nodejs/processExit';
import { transpileManager } from '../transpiler/transpileManager';
import { isBuiltInModule } from './builtinModules';
import { ModuleCache } from './moduleCache';
import { ModuleResolver } from './moduleResolver';

/**
 * モジュール実行キャッシュ（循環参照対策）
 */
interface ModuleExecutionCache {
  [key: string]: {
    exports: unknown;
    loaded: boolean;
    loading: boolean;
    code?: string;
    dependencies?: string[];
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
  cacheMount: RuntimeCacheMount;
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
  private preparePromises = new Map<string, Promise<void>>();
  private readonly maxParallelPreloads = 8;

  constructor(options: ModuleLoaderOptions) {
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.projectDir = `/projects/${this.projectName}`;
    this.debugConsole = options.debugConsole;
    this.builtinResolver = options.builtinResolver;

    this.cache = new ModuleCache(this.projectId, this.projectName, options.cacheMount);
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

    const prepared = await this.prepareModule(moduleName, currentFilePath);
    if (prepared.__isBuiltIn) {
      runtimeInfo('✅ Built-in module:', moduleName);
      return prepared;
    }

    try {
      const moduleExports = this.executePreparedModule(prepared.resolvedPath);
      runtimeInfo('✅ Module loaded:', prepared.resolvedPath);
      return moduleExports;
    } catch (error) {
      delete this.executionCache[prepared.resolvedPath];
      runtimeError('❌ Failed to load module:', prepared.resolvedPath, error);
      throw error;
    }
  }

  private async prepareModule(
    moduleName: string,
    currentFilePath: string,
    prepareStack: Set<string> = new Set()
  ): Promise<
    { __isBuiltIn: true; moduleName: string } | { __isBuiltIn: false; resolvedPath: string }
  > {
    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) {
      throw createModuleNotFoundError(moduleName, currentFilePath);
    }

    if (resolved.isBuiltIn) {
      return { __isBuiltIn: true, moduleName };
    }

    const resolvedPath = resolved.path;
    const existing = this.executionCache[resolvedPath];
    if (existing?.code) {
      return { __isBuiltIn: false, resolvedPath };
    }

    if (prepareStack.has(resolvedPath)) {
      runtimeWarn('⚠️ Circular dependency detected during preload:', resolvedPath);
      return { __isBuiltIn: false, resolvedPath };
    }

    const pendingPrepare = this.preparePromises.get(resolvedPath);
    if (pendingPrepare) {
      await pendingPrepare;
      return { __isBuiltIn: false, resolvedPath };
    }

    const preparePromise = this.prepareResolvedModule(resolvedPath, moduleName, prepareStack);
    this.preparePromises.set(resolvedPath, preparePromise);

    try {
      await preparePromise;
    } finally {
      this.preparePromises.delete(resolvedPath);
    }

    return { __isBuiltIn: false, resolvedPath };
  }

  private async prepareResolvedModule(
    resolvedPath: string,
    moduleName: string,
    prepareStack: Set<string>
  ): Promise<void> {
    const existing = this.executionCache[resolvedPath];
    if (existing?.code) {
      return;
    }

    if (!existing) {
      this.executionCache[resolvedPath] = {
        exports: {},
        loaded: false,
        loading: false,
      };
    }

    const fileContent = await this.readFile(resolvedPath);
    if (fileContent === null) {
      const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`);
      err.name = 'Error [ERR_FS_ENOENT]';
      throw err;
    }

    const transpileResult = await this.getTranspiledCodeWithDeps(resolvedPath, fileContent);
    const { code, dependencies } = transpileResult;

    runtimeInfo('📝 Code type:', typeof code, 'Dependencies type:', typeof dependencies);

    this.executionCache[resolvedPath].code = code;
    this.executionCache[resolvedPath].dependencies = dependencies;

    if (moduleName && !moduleName.startsWith('.') && !moduleName.startsWith('/')) {
      this.moduleNameMap[moduleName] = resolvedPath;
      runtimeInfo('📝 Stored module name mapping:', moduleName, '→', resolvedPath);
    }

    if (dependencies && dependencies.length > 0) {
      runtimeInfo('📦 Preparing dependencies for', resolvedPath, ':', dependencies);
      const nextStack = new Set(prepareStack);
      nextStack.add(resolvedPath);
      await this.runWithConcurrency(
        Array.from(new Set(dependencies)),
        this.maxParallelPreloads,
        async dep => {
          try {
            if (isBuiltInModule(dep)) {
              return;
            }
            if (this.isOptionalDependency(dep, resolvedPath)) {
              runtimeInfo('ℹ️ Skipping optional dependency preload:', dep, 'from', resolvedPath);
              return;
            }
            await this.prepareModule(dep, resolvedPath, nextStack);
          } catch (error) {
            if (isProcessExitSignal(error)) {
              throw error;
            }
            runtimeWarn('⚠️ Failed to pre-load dependency:', dep, 'from', resolvedPath);
          }
        }
      );
    }
  }

  private executePreparedModule(resolvedPath: string): unknown {
    const cached = this.executionCache[resolvedPath];
    if (!cached) {
      throw new Error(`Module not prepared: ${resolvedPath}`);
    }

    if (cached.loaded) {
      runtimeInfo('📦 Using execution cache:', resolvedPath);
      return cached.exports;
    }

    if (cached.loading) {
      runtimeWarn('⚠️ Circular dependency detected:', resolvedPath);
      return cached.exports;
    }

    if (!cached.code) {
      throw new Error(`Prepared module is missing transpiled code: ${resolvedPath}`);
    }

    cached.loading = true;
    try {
      runtimeInfo('📝 About to execute module with code type:', typeof cached.code);
      const moduleExports = this.executeModule(cached.code, resolvedPath);
      cached.exports = moduleExports;
      cached.loaded = true;
      cached.loading = false;
      return moduleExports;
    } catch (error) {
      cached.loading = false;
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
      const dependencies = Array.from(
        new Set([
          ...(cached.deps || []),
          ...this.extractRequireDeps(cached.code),
          ...(await this.extractTemplateRequireDeps(filePath, cached.code)),
        ])
      );
      return { code: cached.code, dependencies };
    }

    // JSONファイルの場合はそのままJSオブジェクトとしてエクスポート
    if (filePath.endsWith('.json')) {
      return {
        code: `module.exports = ${content};`,
        dependencies: [],
      };
    }

    // node_modules 配下の .mjs は install 時に esbuild で CJS 変換済みのはず。
    // isESModule() はテンプレートリテラル等で誤検知するため、node_modules では無条件にスキップ。
    // node_modules 外の .mjs (ユーザーコード) のみ isESModule で判定する。
    if (filePath.endsWith('.mjs')) {
      const isNodeModule = filePath.includes('/node_modules/');
      if (isNodeModule || !this.isESModule(content)) {
        const deps = [
          ...this.extractRequireDeps(content),
          ...(await this.extractTemplateRequireDeps(filePath, content)),
        ];
        await this.cache.set(filePath, {
          originalPath: filePath,
          contentHash: version,
          code: content,
          deps,
          mtime: Date.now(),
          size: content.length,
        });
        return { code: content, dependencies: deps };
      }
    }

    // トランスパイルが必要か判定
    const needsTranspile = this.needsTranspile(filePath, content);
    if (!needsTranspile) {
      return {
        code: content,
        dependencies: [
          ...this.extractRequireDeps(content),
          ...(await this.extractTemplateRequireDeps(filePath, content)),
        ],
      };
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

        const deps = [
          ...(result.dependencies || []),
          ...(await this.extractTemplateRequireDeps(filePath, result.code)),
        ];
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

    // 普通のJS/ESMの場合はesbuildでCJSへ変換
    const result = await transpileManager.transpile({
      code: content,
      filePath,
      isTypeScript: false,
      isESModule: this.isESModule(content),
      isJSX: false,
    });

    const dependencies = [
      ...(result.dependencies || []),
      ...(await this.extractTemplateRequireDeps(filePath, result.code)),
    ];

    // キャッシュに保存
    await this.cache.set(filePath, {
      originalPath: filePath,
      contentHash: version,
      code: result.code,
      sourceMap: result.sourceMap,
      deps: dependencies,
      mtime: Date.now(),
      size: result.code.length,
    });

    // transpileManager.transpile は既に { code: string, dependencies: string[] } を返すので、そのまま返す
    return { ...result, dependencies };
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

    // 依存関係を再帰的に準備（実行は require 時まで遅延）
    if (dependencies && dependencies.length > 0) {
      runtimeInfo('📦 Pre-loading dependencies for', resolvedPath, ':', dependencies);
      const prepareStack = new Set<string>([resolvedPath]);
      await this.runWithConcurrency(
        Array.from(new Set(dependencies)),
        this.maxParallelPreloads,
        async dep => {
          try {
            // ビルトインモジュールはスキップ（node: プレフィックス付きも含む）
            if (isBuiltInModule(dep)) {
              return;
            }
            if (this.isOptionalDependency(dep, resolvedPath)) {
              runtimeInfo('ℹ️ Skipping optional dependency preload:', dep, 'from', resolvedPath);
              return;
            }

            await this.prepareModule(dep, resolvedPath, prepareStack);
          } catch (error) {
            if (isProcessExitSignal(error)) {
              throw error;
            }
            runtimeWarn('⚠️ Failed to pre-load dependency:', dep, 'from', resolvedPath);
          }
        }
      );
    }

    runtimeInfo('✅ Dependencies pre-loaded for:', resolvedPath);
  }

  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) continue;
        await worker(item);
      }
    });

    await Promise.all(workers);
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
          return this.executePreparedModule(resolvedPath);
        }

        // Try with common extensions
        const extensions = [
          '',
          '.js',
          '.cjs',
          '.mjs',
          '.ts',
          '.mts',
          '.tsx',
          '.jsx',
          '.json',
          '/index.js',
          '/index.cjs',
          '/index.ts',
        ];
        for (const ext of extensions) {
          const pathWithExt = resolvedPath + ext;
          if (this.executionCache[pathWithExt]) {
            return this.executePreparedModule(pathWithExt);
          }
        }
      }

      if (!this.isOptionalDependency(moduleName, filePath)) {
        runtimeWarn(`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${moduleName}'`);
        if (resolvedPath) {
          runtimeWarn(`  Resolved path: ${resolvedPath}`);
        }
        runtimeWarn(`  Required from: ${filePath}`);
      }
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

    // コードをラップして実行。
    // パラメータ名を __injected_* にすることで、モジュール内の
    // `const process = ...` や `var Buffer = ...` との名前衝突を防ぐ。
    // asyncLoad は動的 import() のフォールバックに使用（pre-load 外のモジュール対応）
    const asyncLoadFn = this.asyncLoad.bind(this);
    const wrappedCode = `
      (function(module, exports, require, __filename, __dirname, console, __injected_process, __injected_Buffer, __injected_setTimeout, __injected_setInterval, __injected_clearTimeout, __injected_clearInterval, __injected_global, __injected_asyncLoad) {
        var process = __injected_process;
        var Buffer = __injected_Buffer;
        var setTimeout = __injected_setTimeout;
        var setInterval = __injected_setInterval;
        var clearTimeout = __injected_clearTimeout;
        var clearInterval = __injected_clearInterval;
        var global = __injected_global;
        var define = undefined;
        var window = undefined;
        var __pyxisImport = function(s) { return __injected_asyncLoad(s, __filename); };
        ${code}
        return module.exports;
      })
    `;

    try {
      const executeFunc = eval(wrappedCode);
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
        global,
        asyncLoadFn
      );
      return result;
    } catch (error) {
      if (isProcessExitSignal(error)) {
        throw error;
      }
      // ERR_MODULE_NOT_FOUND は本当にモジュールが見つからないエラーなので再スローする
      // これを飲み込むと require が失敗しても空 exports で動いてしまい、
      // テストが偽の成功になる
      if (error instanceof Error && error.name === 'Error [ERR_MODULE_NOT_FOUND]') {
        runtimeWarn('❌ Module not found during execution:', filePath);
        runtimeWarn('Error details:', error.message);
        throw error;
      }

      runtimeWarn('❌ Module execution failed:', filePath);
      runtimeWarn(
        'Error details:',
        error instanceof Error ? `${error.name}: ${error.message}` : String(JSON.stringify(error))
      );
      throw error;
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
  /**
   * CJSコードからrequire()の依存関係を抽出（シンプルregex版）
   * esbuild変換済みCJSコードにのみ使用する。
   */
  private extractRequireDeps(content: string): string[] {
    const deps = new Set<string>();
    const extractFrom = (re: RegExp) => {
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const dep = m[2];
        if (/[{}<>]/.test(dep)) continue;
        deps.add(dep);
      }
    };
    extractFrom(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g);
    extractFrom(/\b__pyxisImport\s*\(\s*(['"])([^'"]+)\1\s*\)/g);
    return Array.from(deps);
  }

  private async extractTemplateRequireDeps(filePath: string, content: string): Promise<string[]> {
    const deps = new Set<string>();
    const patterns = [
      /\brequire\s*\(\s*`([^`$]+)\$\{[^`]+}([^`]*)`\s*\)/g,
      /\b__pyxisImport\s*\(\s*`([^`$]+)\$\{[^`]+}([^`]*)`\s*\)/g,
    ];

    for (const re of patterns) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const [, prefix, suffix] = match;
        if (!prefix || prefix.includes('${') || suffix.includes('${')) continue;
        if (!prefix.startsWith('./') && !prefix.startsWith('../')) continue;

        const slashIndex = prefix.lastIndexOf('/');
        if (slashIndex < 0) continue;

        const dirPart = prefix.slice(0, slashIndex + 1);
        const filePrefix = prefix.slice(slashIndex + 1);
        const currentDir = this.dirname(filePath);
        const fsDir = this.resolveRelativePath(currentDir, dirPart);
        const appDir = fsPathToAppPath(fsDir, this.projectName).replace(/\/+$/, '');

        try {
          const files = await fileRepository.getFilesByPrefix(this.projectId, `${appDir}/`);
          for (const file of files) {
            if (file.type !== 'file') continue;
            const name = file.path.slice(appDir.length + 1);
            if (name.includes('/')) continue;
            if (!name.startsWith(filePrefix) || !name.endsWith(suffix)) continue;
            deps.add(`${dirPart}${name}`);
          }
        } catch (error) {
          runtimeWarn('⚠️ Failed to expand template require deps:', filePath, error);
        }
      }
    }

    return Array.from(deps);
  }

  private resolveRelativePath(basePath: string, relativePath: string): string {
    const parts = basePath.split('/').filter(Boolean);
    const relParts = relativePath.split('/').filter(Boolean);

    for (const part of relParts) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }

    return `/${parts.join('/')}`;
  }

  private isOptionalDependency(moduleName: string, fromPath: string): boolean {
    if (moduleName === 'supports-color' && fromPath.includes('/node_modules/debug/src/node.js')) {
      return true;
    }

    if (
      (moduleName === 'jiti' || moduleName === 'jiti/package.json') &&
      fromPath.includes('/node_modules/eslint/lib/config/config-loader.js')
    ) {
      return true;
    }

    return false;
  }

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

    // dynamic import は eval 実行系でそのまま扱えないため変換する
    if (/\bimport\s*\(/.test(content)) {
      return true;
    }

    // prettier などの dynamic import hack も変換対象
    if (
      /new\s+Function\s*\(\s*(['"])module\1\s*,\s*(['"])return\s+import\(module\)\2\s*\)/.test(
        content
      )
    ) {
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
      // Normalize using pathUtils: convert FSPath to AppPath (handles fallback internally)
      const normalizedPath = fsPathToAppPath(filePath, this.projectName);
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
    this.preparePromises.clear();
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
    if (this.executionCache[resolvedPath]) {
      return this.executePreparedModule(resolvedPath);
    }
    return null;
  }

  /**
   * 非同期でモジュールをロード（動的 import() 変換用）
   * pre-load 済みでない場合は IndexedDB から非同期ロードする
   */
  async asyncLoad(moduleName: string, currentFilePath: string): Promise<unknown> {
    if (isBuiltInModule(moduleName)) {
      if (this.builtinResolver) {
        const result = this.builtinResolver(moduleName);
        if (result !== null) return result;
      }
      return null;
    }

    // まずsync resolveで済む場合（execution cache済み）
    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) throw createModuleNotFoundError(moduleName, currentFilePath);
    if (resolved.isBuiltIn) {
      return this.builtinResolver?.(moduleName) ?? null;
    }

    const resolvedPath = resolved.path;
    if (this.executionCache[resolvedPath]?.code) {
      return this.executePreparedModule(resolvedPath);
    }

    // キャッシュにない → IndexedDB から動的ロード
    runtimeInfo('🔄 Async loading module (not pre-loaded):', resolvedPath);
    const prepared = await this.prepareModule(moduleName, currentFilePath);
    if (prepared.__isBuiltIn) {
      return this.builtinResolver?.(moduleName) ?? null;
    }
    return this.executePreparedModule(prepared.resolvedPath);
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
