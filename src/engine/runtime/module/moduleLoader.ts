/**
 * Module Loader
 *
 */

import { posixPath } from '@/engine/core/pathUtils';
import type { RuntimeBridge } from '../bridge/client';
import { runtimeError, runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import type { BuiltInModules } from '../nodejs/builtInModule';
import { createModuleNotFoundError } from '../nodejs/nodeErrors';
import { isProcessExitSignal } from '../nodejs/processExit';
import type {
  ProcessListener,
  ProcessObject,
  RuntimeGlobal,
  RuntimeTimer,
} from '../nodejs/runtimeTypes';
import { isBuiltInModule } from './builtinModules';
import { ModuleCache } from './moduleCache';
import { ModuleCode } from './moduleCode';
import { ModuleFileSystem } from './moduleFileSystem';
import { ModuleResolver } from './moduleResolver';

interface ModuleExecutionCache {
  [key: string]: {
    exports: unknown;
    loaded: boolean;
    loading: boolean;
    code?: string;
    dependencies?: string[];
  };
}

interface CommonJsModule {
  exports: unknown;
}

interface ModuleGlobals {
  process: ProcessObject;
  Buffer: BuiltInModules['buffer']['Buffer'];
  setTimeout: (handler: ProcessListener, timeout?: number, ...args: unknown[]) => RuntimeTimer;
  setInterval: (handler: ProcessListener, timeout?: number, ...args: unknown[]) => RuntimeTimer;
  setImmediate: (handler: ProcessListener, ...args: unknown[]) => RuntimeTimer;
  clearTimeout: (timer?: RuntimeTimer) => void;
  clearInterval: (timer?: RuntimeTimer) => void;
  clearImmediate: (timer?: RuntimeTimer) => void;
  global: RuntimeGlobal;
}
/**
 * Module Loader Options
 */
export interface ModuleLoaderOptions {
  rootPath: string;
  bridge: RuntimeBridge;
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  builtinResolver?: (moduleName: string) => unknown | null;
}

/**
 * Module Loader
 */
export class ModuleLoader {
  private rootPath: string;
  private debugConsole?: ModuleLoaderOptions['debugConsole'];
  private builtinResolver?: (moduleName: string) => unknown | null;
  private cache: ModuleCache;
  private resolver: ModuleResolver;
  private executionCache: ModuleExecutionCache = {};
  private preparePromises = new Map<string, Promise<void>>();
  private readonly maxParallelPreloads = 8;
  private fileSystem: ModuleFileSystem;

  constructor(options: ModuleLoaderOptions) {
    this.rootPath = options.rootPath;
    this.debugConsole = options.debugConsole;
    this.builtinResolver = options.builtinResolver;
    this.fileSystem = new ModuleFileSystem(options.bridge);
    this.cache = new ModuleCache(this.fileSystem);
    this.resolver = new ModuleResolver(this.rootPath, this.fileSystem);
  }

  async init(): Promise<void> {
    runtimeInfo('🚀 Initializing ModuleLoader...');

    await this.cache.init();

    runtimeInfo('✅ ModuleLoader initialized');
  }

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
      const runtimeModule: CommonJsModule = {
        get exports() {
          return cached.exports;
        },
        set exports(exports) {
          cached.exports = exports;
        },
      };
      const moduleExports = this.executeModule(cached.code, resolvedPath, runtimeModule);
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
   *
   */
  async getTranspiledCodeWithDeps(
    filePath: string,
    content: string
  ): Promise<{ code: string; dependencies: string[] }> {
    const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(filePath);
    const isESModule = ModuleCode.isESModule(content);
    const version = await ModuleCode.contentVersion(
      JSON.stringify({ filePath, content, isTypeScript, isESModule })
    );
    const cached = await this.cache.get(filePath, version);
    if (cached) {
      runtimeInfo('📦 Using transpile cache (with dependencies):', filePath);
      runtimeInfo(
        '📝 Cache structure:',
        typeof cached,
        'code type:',
        typeof cached.code,
        'deps:',
        cached.deps
      );
      const dependencies = Array.from(
        new Set([...(cached.deps || []), ...ModuleCode.requireDependencies(cached.code)])
      );
      return { code: cached.code, dependencies };
    }

    if (filePath.endsWith('.json')) {
      return {
        code: `module.exports = ${content};`,
        dependencies: [],
      };
    }

    const needsTranspile = ModuleCode.needsTranspile(filePath, content);
    if (!needsTranspile) {
      return {
        code: content,
        dependencies: [...ModuleCode.requireDependencies(content)],
      };
    }

    runtimeInfo('🔄 Transpiling module (extracting dependencies):', filePath);
    const result = await this.fileSystem.transpile(content, filePath, isTypeScript, isESModule);
    const dependencies = result.dependencies;

    await this.cache.set(filePath, {
      contentHash: version,
      code: result.code,
      deps: dependencies,
    });

    return { ...result, dependencies };
  }

  private globals: ModuleGlobals | null = null;

  setGlobals(globals: ModuleGlobals): void {
    this.globals = globals;
  }

  async preloadDependencies(moduleName: string, currentFilePath: string): Promise<void> {
    runtimeInfo('📦 Pre-loading dependencies for entry:', moduleName);

    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) {
      throw createModuleNotFoundError(moduleName, currentFilePath);
    }

    if (resolved.isBuiltIn) {
      return;
    }

    const resolvedPath = resolved.path;

    const fileContent = await this.readFile(resolvedPath);
    if (fileContent === null) {
      const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`);
      err.name = 'Error [ERR_FS_ENOENT]';
      throw err;
    }

    const transpileResult = await this.getTranspiledCodeWithDeps(resolvedPath, fileContent);
    const { dependencies } = transpileResult;

    if (dependencies && dependencies.length > 0) {
      runtimeInfo('📦 Pre-loading dependencies for', resolvedPath, ':', dependencies);
      const prepareStack = new Set<string>([resolvedPath]);
      await this.runWithConcurrency(
        Array.from(new Set(dependencies)),
        this.maxParallelPreloads,
        async dep => {
          try {
            if (isBuiltInModule(dep)) {
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

  private executeModule(code: string, filePath: string, module: CommonJsModule): unknown {
    if (!this.globals) throw new Error('Runtime globals were not initialized.');
    const runtimeGlobals = this.globals;
    const exports = module.exports;
    const __filename = filePath;
    const __dirname = posixPath.dirname(filePath);

    if (code.startsWith('#!')) {
      code = `//${code}`; // Preserve line numbers while disabling the shebang.
    }

    // Modules must be pre-loaded into execution cache before they can be required
    const require = (moduleName: string): unknown => this.requireSync(moduleName, filePath);

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
      clear: () => runtimeGlobals.global.console.clear(),
    };

    const process = runtimeGlobals.process;
    const Buffer = runtimeGlobals.Buffer;
    if (!Buffer) {
      throw new Error('Buffer global was not initialized');
    }
    const setTimeout = runtimeGlobals.setTimeout;
    const setInterval = runtimeGlobals.setInterval;
    const setImmediate = runtimeGlobals.setImmediate;
    const clearTimeout = runtimeGlobals.clearTimeout;
    const clearInterval = runtimeGlobals.clearInterval;
    const clearImmediate = runtimeGlobals.clearImmediate;
    const global = runtimeGlobals.global;
    if (!global) {
      throw new Error('Runtime global was not initialized');
    }
    global.process = process;
    global.Buffer = Buffer;
    global.global = global;
    global.globalThis = global;

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
      console.warn('[moduleLoader.ts] caught non-fatal error', e);
      // If we can't modify navigator, continue anyway
    }

    const asyncLoadFn = this.asyncLoad.bind(this);
    const wrappedCode = `
      (function(module, exports, require, __filename, __dirname, console, __injected_process, __injected_Buffer, __injected_setTimeout, __injected_setInterval, __injected_setImmediate, __injected_clearTimeout, __injected_clearInterval, __injected_clearImmediate, __injected_global, __injected_asyncLoad) {
        var process = __injected_process;
        var Buffer = __injected_Buffer;
        var setTimeout = __injected_setTimeout;
        var setInterval = __injected_setInterval;
        var setImmediate = __injected_setImmediate;
        var clearTimeout = __injected_clearTimeout;
        var clearInterval = __injected_clearInterval;
        var clearImmediate = __injected_clearImmediate;
        var global = __injected_global;
        var globalThis = __injected_global;
        var define = undefined;
        var window = undefined;
        var __pyxisImport = function(s) { return __injected_asyncLoad(s, __filename); };
        ${code}
        return module.exports;
      })
    `;

    try {
      const indirectEval = globalThis.eval;
      const executeFunc = indirectEval(wrappedCode);
      const result = executeFunc(
        module,
        exports,
        require,
        __filename,
        __dirname,
        sandboxConsole,
        process,
        Buffer,
        setTimeout,
        setInterval,
        setImmediate,
        clearTimeout,
        clearInterval,
        clearImmediate,
        global,
        asyncLoadFn
      );
      return result;
    } catch (error) {
      if (isProcessExitSignal(error)) {
        throw error;
      }
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
        console.warn('[moduleLoader.ts] caught non-fatal error', e);
        // Ignore restoration errors
      }
    }
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await this.fileSystem.readFile(filePath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      this.error('❌ Failed to read file:', filePath, error);
      throw error;
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.executionCache = {};
    this.preparePromises.clear();
  }

  requireSync(moduleName: string, currentFilePath: string): unknown {
    if (isBuiltInModule(moduleName)) {
      const builtIn = this.builtinResolver?.(moduleName);
      if (builtIn !== null && builtIn !== undefined) return builtIn;
    }

    const resolved = this.resolver.resolveSync(moduleName, currentFilePath);
    if (!resolved) throw createModuleNotFoundError(moduleName, currentFilePath);
    if (resolved.isBuiltIn) return this.builtinResolver?.(moduleName) ?? null;

    let cached = this.executionCache[resolved.path];
    if (!cached) {
      const content = this.fileSystem.readFileSync(resolved.path);
      let code = content;
      let dependencies: string[] = [];
      if (resolved.path.endsWith('.json')) {
        code = `module.exports = ${content};`;
      } else if (ModuleCode.needsTranspile(resolved.path, content)) {
        const result = this.fileSystem.transpileSync(content, resolved.path);
        code = result.code;
        dependencies = result.dependencies;
      } else {
        dependencies = ModuleCode.requireDependencies(content);
      }
      cached = { exports: {}, loaded: false, loading: false, code, dependencies };
      this.executionCache[resolved.path] = cached;
    }
    return this.executePreparedModule(resolved.path);
  }

  async asyncLoad(moduleName: string, currentFilePath: string): Promise<unknown> {
    if (isBuiltInModule(moduleName)) {
      if (this.builtinResolver) {
        const result = this.builtinResolver(moduleName);
        if (result !== null) return result;
      }
      return null;
    }

    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) throw createModuleNotFoundError(moduleName, currentFilePath);
    if (resolved.isBuiltIn) {
      return this.builtinResolver?.(moduleName) ?? null;
    }

    const resolvedPath = resolved.path;
    if (this.executionCache[resolvedPath]?.code) {
      return this.executePreparedModule(resolvedPath);
    }

    runtimeInfo('🔄 Async loading module (not pre-loaded):', resolvedPath);
    const prepared = await this.prepareModule(moduleName, currentFilePath);
    if (prepared.__isBuiltIn) {
      return this.builtinResolver?.(moduleName) ?? null;
    }
    return this.executePreparedModule(prepared.resolvedPath);
  }

  private error(...args: unknown[]): void {
    this.debugConsole?.error(...args);
  }
}
