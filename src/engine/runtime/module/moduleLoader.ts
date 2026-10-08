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
import { createRuntimeFunction } from './dynamicFunction';
import {
  ModuleCode,
  type ModuleDependency,
  type ModuleFormat,
  type ModuleKind,
} from './moduleCode';
import { ModuleFileSystem } from './moduleFileSystem';
import { ModuleResolver } from './moduleResolver';

interface ModuleExecutionEntry {
  exports: unknown;
  loaded: boolean;
  loading: boolean;
  code: string;
  format: ModuleFormat;
  namespace: Record<string, unknown> | null;
}

interface ModuleExecutionCache {
  [key: string]: ModuleExecutionEntry;
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
  trackIO: <T>(promise: Promise<T>) => Promise<T>;
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
  private debugConsole?: ModuleLoaderOptions['debugConsole'];
  private builtinResolver?: (moduleName: string) => unknown | null;
  private resolver: ModuleResolver;
  private executionCache: ModuleExecutionCache = {};
  private preparePromises = new Map<string, Promise<void>>();
  private readonly maxParallelPreloads = 8;
  private fileSystem: ModuleFileSystem;
  private readonly trackIO: ModuleLoaderOptions['trackIO'];

  constructor(options: ModuleLoaderOptions) {
    this.debugConsole = options.debugConsole;
    this.builtinResolver = options.builtinResolver;
    this.trackIO = options.trackIO;
    this.fileSystem = new ModuleFileSystem(options.bridge);
    this.resolver = new ModuleResolver(options.rootPath, this.fileSystem);
  }

  private async prepareModule(
    moduleName: string,
    currentFilePath: string,
    prepareStack: Set<string> = new Set(),
    kind: ModuleKind = 'require'
  ): Promise<
    { __isBuiltIn: true; moduleName: string } | { __isBuiltIn: false; resolvedPath: string }
  > {
    const resolved = await this.resolver.resolve(moduleName, currentFilePath, kind);
    if (!resolved) {
      throw createModuleNotFoundError(moduleName, currentFilePath);
    }

    if (resolved.isBuiltIn) {
      return { __isBuiltIn: true, moduleName: resolved.path };
    }

    const resolvedPath = resolved.path;
    const existing = this.executionCache[resolvedPath];
    if (existing?.code !== undefined) {
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

    const preparePromise = this.prepareResolvedModule(resolvedPath, prepareStack);
    this.preparePromises.set(resolvedPath, preparePromise);

    try {
      await preparePromise;
    } catch (error) {
      delete this.executionCache[resolvedPath];
      throw error;
    } finally {
      this.preparePromises.delete(resolvedPath);
    }

    return { __isBuiltIn: false, resolvedPath };
  }

  private async prepareResolvedModule(
    resolvedPath: string,
    prepareStack: Set<string>
  ): Promise<void> {
    const existing = this.executionCache[resolvedPath];
    if (existing?.code !== undefined) {
      return;
    }

    const fileContent = await this.readFile(resolvedPath);
    if (fileContent === null) {
      const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`);
      err.name = 'Error [ERR_FS_ENOENT]';
      throw err;
    }

    const transpileResult = await this.getTranspiledCodeWithDeps(resolvedPath, fileContent);
    const { code, dependencies, format } = transpileResult;

    runtimeInfo('📝 Code type:', typeof code, 'Dependencies type:', typeof dependencies);

    this.executionCache[resolvedPath] = {
      exports: {},
      loaded: false,
      loading: false,
      code,
      format,
      namespace: null,
    };

    if (dependencies && dependencies.length > 0) {
      runtimeInfo('📦 Preparing dependencies for', resolvedPath, ':', dependencies);
      const nextStack = new Set(prepareStack);
      nextStack.add(resolvedPath);
      await this.runWithConcurrency(dependencies, this.maxParallelPreloads, async dep => {
        try {
          if (isBuiltInModule(dep.specifier)) {
            return;
          }
          await this.prepareModule(dep.specifier, resolvedPath, nextStack, dep.kind);
        } catch (error) {
          if (isProcessExitSignal(error)) {
            throw error;
          }
          runtimeWarn('⚠️ Failed to pre-load dependency:', dep.specifier, 'from', resolvedPath);
        }
      });
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
  ): Promise<{ code: string; dependencies: ModuleDependency[]; format: ModuleFormat }> {
    if (filePath.endsWith('.json')) {
      return {
        code: `module.exports = ${content};`,
        dependencies: [],
        format: 'commonjs',
      };
    }

    const analysis = ModuleCode.analyze(content, filePath);
    const type = await this.resolver.packageType(filePath);
    const format = ModuleCode.format(filePath, analysis, type);
    this.validateFormat(filePath, analysis.hasEsmSyntax, format);
    const needsTranspile = ModuleCode.needsTranspile(filePath, analysis, type);
    if (!needsTranspile) {
      return {
        code: content,
        dependencies: analysis.dependencies,
        format,
      };
    }

    runtimeInfo('🔄 Transpiling module (extracting dependencies):', filePath);
    const result = await this.fileSystem.transpile(
      content,
      filePath,
      ModuleCode.isTypeScript(filePath)
    );
    return { ...result, format };
  }

  private globals: ModuleGlobals | null = null;

  setGlobals(globals: ModuleGlobals): void {
    this.globals = globals;
  }

  async preloadDependencies(moduleName: string, currentFilePath: string): Promise<string> {
    runtimeInfo('📦 Pre-loading dependencies for entry:', moduleName);

    const resolved = await this.resolver.resolve(moduleName, currentFilePath);
    if (!resolved) {
      throw createModuleNotFoundError(moduleName, currentFilePath);
    }

    if (resolved.isBuiltIn) {
      throw new Error('A built-in module cannot be an entry file.');
    }

    const resolvedPath = resolved.path;

    const fileContent = await this.readFile(resolvedPath);
    if (fileContent === null) {
      const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`);
      err.name = 'Error [ERR_FS_ENOENT]';
      throw err;
    }

    const transpileResult = await this.getTranspiledCodeWithDeps(resolvedPath, fileContent);
    const { code, dependencies } = transpileResult;

    if (dependencies && dependencies.length > 0) {
      runtimeInfo('📦 Pre-loading dependencies for', resolvedPath, ':', dependencies);
      const prepareStack = new Set<string>([resolvedPath]);
      await this.runWithConcurrency(dependencies, this.maxParallelPreloads, async dep => {
        try {
          if (isBuiltInModule(dep.specifier)) {
            return;
          }

          await this.prepareModule(dep.specifier, resolvedPath, prepareStack, dep.kind);
        } catch (error) {
          if (isProcessExitSignal(error)) {
            throw error;
          }
          runtimeWarn('⚠️ Failed to pre-load dependency:', dep.specifier, 'from', resolvedPath);
        }
      });
    }

    runtimeInfo('✅ Dependencies pre-loaded for:', resolvedPath);
    return code;
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
    const requireImport = (moduleName: string): unknown =>
      this.requireSync(moduleName, filePath, 'import');

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
    const runtimeFunction = createRuntimeFunction(specifier => this.asyncLoad(specifier, filePath));
    const wrappedCode = `
      (function(module, exports, require, __filename, __dirname, console, process, Buffer, setTimeout, setInterval, setImmediate, clearTimeout, clearInterval, clearImmediate, global, __injected_asyncLoad, __pyxisRequireImport, Function) {
        const globalThis = global;
        const define = undefined;
        const window = undefined;
        const __pyxisRequireCommonJs = require;
        var __pyxisImport = function(s) { return __injected_asyncLoad(s, __filename); };
        return (function() {
          ${code}
          return module.exports;
        }).call(exports);
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
        asyncLoadFn,
        requireImport,
        runtimeFunction
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
    this.executionCache = {};
    this.preparePromises.clear();
    this.resolver.clearCache();
  }

  requireSync(moduleName: string, currentFilePath: string, kind: ModuleKind = 'require'): unknown {
    if (isBuiltInModule(moduleName)) {
      const builtIn = this.builtinResolver?.(moduleName);
      if (builtIn !== null && builtIn !== undefined) {
        if (kind === 'import') return this.builtinNamespace(moduleName, builtIn);
        return builtIn;
      }
    }

    const resolved = this.resolver.resolveSync(moduleName, currentFilePath, kind);
    if (!resolved) throw createModuleNotFoundError(moduleName, currentFilePath);
    if (resolved.isBuiltIn) {
      const builtIn = this.builtinResolver?.(resolved.path) ?? null;
      if (kind === 'import') return this.builtinNamespace(resolved.path, builtIn);
      return builtIn;
    }

    let cached = this.executionCache[resolved.path];
    if (!cached) {
      const content = this.fileSystem.readFileSync(resolved.path);
      let code = content;
      let format: ModuleFormat = 'commonjs';
      if (resolved.path.endsWith('.json')) {
        code = `module.exports = ${content};`;
      } else {
        const analysis = ModuleCode.analyze(content, resolved.path);
        const type = this.resolver.packageTypeSync(resolved.path);
        format = ModuleCode.format(resolved.path, analysis, type);
        this.validateFormat(resolved.path, analysis.hasEsmSyntax, format);
        if (ModuleCode.needsTranspile(resolved.path, analysis, type)) {
          const result = this.fileSystem.transpileSync(content, resolved.path);
          code = result.code;
        }
      }
      cached = { exports: {}, loaded: false, loading: false, code, format, namespace: null };
      this.executionCache[resolved.path] = cached;
    }
    const exports = this.executePreparedModule(resolved.path);
    if (kind === 'import') return this.importNamespace(exports, cached);
    return exports;
  }

  asyncLoad(moduleName: string, currentFilePath: string): Promise<unknown> {
    return this.trackIO(this.loadImport(moduleName, currentFilePath));
  }

  private async loadImport(moduleName: string, currentFilePath: string): Promise<unknown> {
    if (isBuiltInModule(moduleName)) {
      if (this.builtinResolver) {
        const result = this.builtinResolver(moduleName);
        if (result !== null) return this.builtinNamespace(moduleName, result);
      }
      return null;
    }

    const resolved = await this.resolver.resolve(moduleName, currentFilePath, 'import');
    if (!resolved) throw createModuleNotFoundError(moduleName, currentFilePath);
    if (resolved.isBuiltIn) {
      return this.builtinNamespace(resolved.path, this.builtinResolver?.(resolved.path) ?? null);
    }

    const resolvedPath = resolved.path;
    if (this.executionCache[resolvedPath]?.code !== undefined) {
      return this.importNamespace(
        this.executePreparedModule(resolvedPath),
        this.executionCache[resolvedPath]
      );
    }

    runtimeInfo('🔄 Async loading module (not pre-loaded):', resolvedPath);
    const prepared = await this.prepareModule(moduleName, currentFilePath, new Set(), 'import');
    if (prepared.__isBuiltIn) {
      return this.builtinNamespace(
        prepared.moduleName,
        this.builtinResolver?.(prepared.moduleName) ?? null
      );
    }
    return this.importNamespace(
      this.executePreparedModule(prepared.resolvedPath),
      this.executionCache[prepared.resolvedPath]
    );
  }

  private importNamespace(exports: unknown, cached: ModuleExecutionEntry): unknown {
    if (cached.format === 'module') return exports;
    if (cached.namespace) return cached.namespace;
    const namespace: Record<string, unknown> = Object.create(null);
    if (exports !== null && (typeof exports === 'object' || typeof exports === 'function')) {
      Object.assign(namespace, exports);
    }
    namespace.default = exports;
    Object.defineProperty(namespace, '__esModule', { value: true, enumerable: false });
    cached.namespace = namespace;
    return namespace;
  }

  private builtinNamespace(name: string, exports: unknown): unknown {
    let key = name;
    if (!key.startsWith('node:')) key = `node:${key}`;
    let cached = this.executionCache[key];
    if (!cached) {
      cached = {
        exports,
        loaded: true,
        loading: false,
        code: '',
        format: 'commonjs',
        namespace: null,
      };
      this.executionCache[key] = cached;
    }
    return this.importNamespace(exports, cached);
  }

  private error(...args: unknown[]): void {
    this.debugConsole?.error(...args);
  }

  private validateFormat(filePath: string, hasEsmSyntax: boolean, format: ModuleFormat): void {
    const extension = posixPath.extname(filePath);
    if (extension === '.node') throw new Error('Native Node.js addons are not supported.');
    if (hasEsmSyntax && format === 'commonjs') {
      throw new SyntaxError(`ES module syntax is not allowed in CommonJS file '${filePath}'.`);
    }
  }
}
