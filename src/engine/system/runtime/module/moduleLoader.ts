/**
 * Module Loader
 *
 */

import { posixPath } from '@/engine/core/paths';
import type { RuntimeBridge } from '../bridge/client';
import { runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import { pathToFileURL } from '../nodejs/modules/urlModule';
import { createModuleNotFoundError } from '../nodejs/nodeErrors';
import { isProcessExitSignal } from '../nodejs/processExit';
import { isBuiltInModule } from './builtinModules';
import {
  type ModuleAnalysis,
  ModuleCode,
  type ModuleDependency,
  type ModuleFormat,
  type ModuleKind,
} from './moduleCode';
import { ModuleEvaluation } from './moduleEvaluation';
import {
  type CommonJsModule,
  executeModule,
  type ModuleLoaderReturn,
  type RuntimeRequire,
} from './moduleExecution';
import { ModuleFileSystem } from './moduleFileSystem';
import { ModuleResolver, type ResolveResult } from './moduleResolver';

interface ModuleExecutionEntry {
  exports: unknown;
  loaded: boolean;
  loading: boolean;
  code: string;
  format: ModuleFormat;
  namespace: Record<string, unknown> | null;
  analysis: ModuleAnalysis;
}

interface ModuleExecutionCache {
  [key: string]: ModuleExecutionEntry;
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
  private readonly modules: Record<string, CommonJsModule> = Object.create(null);
  private mainModule: CommonJsModule | undefined;
  private readonly extensions: RuntimeRequire['extensions'] = {
    '.js': (module, filename) => {
      const cached = this.ensurePreparedSync(filename);
      module._compile(cached.code, filename);
    },
    '.json': (module, filename) => {
      module.exports = JSON.parse(this.fileSystem.readFileSync(filename));
    },
    '.node': () => {
      throw new Error('Native Node.js addons are not supported.');
    },
  };
  private preparePromises = new Map<string, Promise<void>>();
  private readonly maxParallelPreloads = 8;
  private fileSystem: ModuleFileSystem;
  private readonly evaluation: ModuleEvaluation;
  private readonly trackIO: ModuleLoaderOptions['trackIO'];

  constructor(options: ModuleLoaderOptions) {
    this.debugConsole = options.debugConsole;
    this.builtinResolver = options.builtinResolver;
    this.trackIO = options.trackIO;
    this.fileSystem = new ModuleFileSystem(options.bridge);
    this.resolver = new ModuleResolver(options.rootPath, this.fileSystem, () =>
      Object.keys(this.extensions)
    );
    this.evaluation = new ModuleEvaluation(
      path => {
        const entry = this.ensurePreparedSync(path);
        return { format: entry.format, ...entry.analysis };
      },
      (specifier, parent) => this.importPath(specifier, parent),
      path => this.evaluateAsyncModule(path)
    );
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
      throw createModuleNotFoundError(moduleName, currentFilePath, kind);
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

    this.executionCache[resolvedPath] = this.createExecutionEntry(code, format);

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
      const runtimeModule = this.getModule(resolvedPath);
      if (cached.format === 'commonjs') {
        const extension = posixPath.extname(resolvedPath);
        const handler = this.extensions[extension] ?? this.extensions['.js'];
        handler(runtimeModule, resolvedPath);
      } else {
        runtimeModule._compile(cached.code, resolvedPath);
      }
      const moduleExports = runtimeModule.exports;
      cached.exports = moduleExports;
      cached.loaded = true;
      runtimeModule.loaded = true;
      cached.loading = false;
      return moduleExports;
    } catch (error) {
      delete this.executionCache[resolvedPath];
      delete this.modules[resolvedPath];
      for (const parent of Object.values(this.modules)) {
        parent.children = parent.children.filter(child => child.filename !== resolvedPath);
      }
      throw error;
    }
  }

  /**
   *
   */
  async getTranspiledCodeWithDeps(
    filePath: string,
    content: string,
    forceCommonJs = false
  ): Promise<{ code: string; dependencies: ModuleDependency[]; format: ModuleFormat }> {
    if (filePath.endsWith('.json')) {
      return {
        code: `module.exports = ${content};`,
        dependencies: [],
        format: 'commonjs',
      };
    }

    const analysis = ModuleCode.analyze(content, filePath);
    let type = await this.resolver.packageType(filePath);
    if (forceCommonJs) type = 'commonjs';
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

  async preloadDependencies(
    moduleName: string,
    currentFilePath: string,
    entrySource?: string
  ): Promise<string> {
    runtimeInfo('📦 Pre-loading dependencies for entry:', moduleName);

    let resolved: ResolveResult | null;
    if (entrySource === undefined) {
      resolved = await this.resolver.resolve(moduleName, currentFilePath);
    } else {
      resolved = { path: moduleName, isBuiltIn: false, isNodeModule: false };
    }
    if (!resolved) {
      throw createModuleNotFoundError(moduleName, currentFilePath);
    }

    if (resolved.isBuiltIn) {
      throw new Error('A built-in module cannot be an entry file.');
    }

    const resolvedPath = resolved.path;

    const fileContent = entrySource ?? (await this.readFile(resolvedPath));
    if (fileContent === null) {
      const err = new Error(`ENOENT: no such file or directory, open '${resolvedPath}'`);
      err.name = 'Error [ERR_FS_ENOENT]';
      throw err;
    }

    const transpileResult = await this.getTranspiledCodeWithDeps(
      resolvedPath,
      fileContent,
      entrySource !== undefined
    );
    const { code, dependencies, format } = transpileResult;
    this.executionCache[resolvedPath] = this.createExecutionEntry(code, format);

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

  async realpath(path: string): Promise<string> {
    return this.fileSystem.realpath(path);
  }

  createMainModule(filePath: string): CommonJsModule {
    this.executionCache[filePath].loading = true;
    const module = this.getModule(filePath);
    module.id = '.';
    this.mainModule = module;
    return module;
  }

  completeMainModule(filePath: string): void {
    const cached = this.executionCache[filePath];
    cached.loaded = true;
    cached.loading = false;
    this.getModule(filePath).loaded = true;
  }

  private getModule(filePath: string): CommonJsModule {
    const existing = this.modules[filePath];
    if (existing) return existing;
    const cached = this.executionCache[filePath];
    const paths = this.modulePaths(filePath);
    const module: CommonJsModule = {
      get exports() {
        return cached.exports;
      },
      set exports(value) {
        cached.exports = value;
      },
      id: filePath,
      filename: filePath,
      path: posixPath.dirname(filePath),
      paths,
      parent: null,
      children: [],
      loaded: cached.loaded,
      require: this.createRequire(filePath),
      _compile: (content, filename) =>
        executeModule(content, filename, module, this, cached.format),
    };
    this.modules[filePath] = module;
    return module;
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
    for (const path of Object.keys(this.modules)) delete this.modules[path];
    this.mainModule = undefined;
    this.resolver.clearCache();
    this.evaluation.clear();
  }

  requireSync(moduleName: string, currentFilePath: string, kind: ModuleKind = 'require'): unknown {
    if (
      kind === 'require' &&
      isBuiltInModule(moduleName) &&
      !moduleName.startsWith('node:') &&
      this.modules[moduleName]
    ) {
      return this.modules[moduleName].exports;
    }
    if (isBuiltInModule(moduleName)) {
      const builtIn = this.resolveBuiltin(moduleName);
      if (kind === 'import') return this.builtinNamespace(moduleName, builtIn);
      return builtIn;
    }

    const resolved = this.resolver.resolveSync(moduleName, currentFilePath, kind);
    if (!resolved) throw createModuleNotFoundError(moduleName, currentFilePath, kind);
    if (resolved.isBuiltIn) {
      const builtIn = this.resolveBuiltin(resolved.path);
      if (kind === 'import') return this.builtinNamespace(resolved.path, builtIn);
      return builtIn;
    }

    const runtimeModule = this.modules[resolved.path];
    if (
      kind === 'require' &&
      runtimeModule &&
      this.executionCache[resolved.path]?.format !== 'module'
    ) {
      this.attachChild(currentFilePath, runtimeModule);
      return runtimeModule.exports;
    }
    const prepared = this.executionCache[resolved.path];
    if (
      !runtimeModule &&
      prepared?.format === 'commonjs' &&
      (prepared.loaded || prepared.loading)
    ) {
      delete this.executionCache[resolved.path];
    }
    const cached = this.ensurePreparedSync(resolved.path);
    if (kind === 'require' && this.evaluation.hasAsyncModule(resolved.path)) {
      throw Object.assign(
        new Error(`require() cannot load an ESM graph with top-level await: ${resolved.path}`),
        {
          code: 'ERR_REQUIRE_ASYNC_MODULE',
        }
      );
    }
    const child = this.getModule(resolved.path);
    this.attachChild(currentFilePath, child);
    const exports = this.executePreparedModule(resolved.path);
    if (kind === 'import') return this.importNamespace(exports, cached);
    if (
      cached.format === 'module' &&
      exports !== null &&
      typeof exports === 'object' &&
      'module.exports' in exports &&
      Object.hasOwn(exports, 'module.exports')
    ) {
      return exports['module.exports'];
    }
    return exports;
  }

  private attachChild(parentPath: string, child: CommonJsModule): void {
    const parent = this.modules[parentPath];
    if (parent && !parent.children.includes(child)) {
      parent.children.push(child);
      if (!child.parent && child.id !== '.') child.parent = parent;
    }
  }

  private resolveBuiltin(name: string): ModuleLoaderReturn {
    const result = this.builtinResolver?.(name);
    if (result === null || result === undefined) {
      throw Object.assign(new Error(`Node.js builtin '${name}' is not supported.`), {
        code: 'ERR_UNKNOWN_BUILTIN_MODULE',
      });
    }
    return result;
  }

  resolveImport(specifier: string, parent: string): string {
    if (
      /^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier) ||
      specifier.startsWith('.') ||
      specifier.startsWith('/')
    ) {
      const url = new URL(specifier, pathToFileURL(parent));
      if (url.protocol === 'file:' && /%2f|%5c/i.test(url.pathname)) {
        throw Object.assign(new TypeError(`Invalid module specifier '${specifier}'.`), {
          code: 'ERR_INVALID_MODULE_SPECIFIER',
        });
      }
      return url.href;
    }
    const resolved = this.resolver.resolveSync(specifier, parent, 'import');
    if (!resolved) throw createModuleNotFoundError(specifier, parent, 'import');
    if (resolved.isBuiltIn) {
      if (resolved.path.startsWith('node:')) return resolved.path;
      return `node:${resolved.path}`;
    }
    return pathToFileURL(resolved.path).href;
  }

  createRequire(filePath: string): RuntimeRequire {
    const resolve = Object.assign(
      (specifier: string, options?: { paths?: string[] }) => {
        let paths: string[] | undefined;
        if (!isBuiltInModule(specifier) && options && typeof options === 'object') {
          if (options.paths !== undefined) {
            if (!Array.isArray(options.paths)) {
              throw Object.assign(new TypeError('The "options.paths" argument must be an array.'), {
                code: 'ERR_INVALID_ARG_VALUE',
              });
            }
            if (options.paths.some(path => typeof path !== 'string')) {
              throw Object.assign(new TypeError('The "options.paths" entries must be strings.'), {
                code: 'ERR_INVALID_ARG_TYPE',
              });
            }
            const cwd = globalThis.process.cwd();
            paths = options.paths.map(path => posixPath.resolve(cwd, path));
          }
        }
        const resolved = this.resolver.resolveSync(specifier, filePath, 'require', paths);
        if (!resolved) throw createModuleNotFoundError(specifier, filePath, 'require');
        return resolved.path;
      },
      {
        paths: (specifier: string) => {
          if (isBuiltInModule(specifier)) return null;
          if (specifier.startsWith('.') || specifier.startsWith('/')) {
            return [posixPath.dirname(filePath)];
          }
          return this.modulePaths(filePath);
        },
      }
    );
    const require = Object.assign((specifier: string) => this.requireSync(specifier, filePath), {
      resolve,
      cache: this.modules,
      extensions: this.extensions,
      main: this.mainModule,
    });
    Object.defineProperty(require, 'main', { get: () => this.mainModule });
    return require;
  }

  private modulePaths(filePath: string): string[] {
    const paths: string[] = [];
    let directory = posixPath.dirname(filePath);
    while (true) {
      if (posixPath.basename(directory) !== 'node_modules') {
        paths.push(posixPath.join(directory, 'node_modules'));
      }
      if (directory === '/') return paths;
      directory = posixPath.dirname(directory);
    }
  }

  private createExecutionEntry(code: string, format: ModuleFormat): ModuleExecutionEntry {
    return {
      exports: {},
      loaded: false,
      loading: false,
      code,
      format,
      namespace: null,
      analysis: ModuleCode.analyze(code),
    };
  }

  private ensurePreparedSync(path: string): ModuleExecutionEntry {
    let cached = this.executionCache[path];
    if (!cached) {
      const content = this.fileSystem.readFileSync(path);
      let code = content;
      let format: ModuleFormat = 'commonjs';
      if (path.endsWith('.json')) {
        code = `module.exports = ${content};`;
      } else {
        const analysis = ModuleCode.analyze(content, path);
        const type = this.resolver.packageTypeSync(path);
        format = ModuleCode.format(path, analysis, type);
        this.validateFormat(path, analysis.hasEsmSyntax, format);
        if (ModuleCode.needsTranspile(path, analysis, type)) {
          const result = this.fileSystem.transpileSync(content, path);
          code = result.code;
        }
      }
      cached = this.createExecutionEntry(code, format);
      this.executionCache[path] = cached;
    }
    return cached;
  }

  private importPath(specifier: string, parent: string): string | null {
    const resolved = this.resolver.resolveSync(specifier, parent, 'import');
    if (!resolved) throw createModuleNotFoundError(specifier, parent, 'import');
    if (resolved.isBuiltIn) return null;
    return resolved.path;
  }

  isEsmEntry(path: string): boolean {
    return this.executionCache[path].format === 'module';
  }

  async executeEsmEntry(path: string): Promise<void> {
    await this.evaluateImport(path);
  }

  private async evaluateImport(path: string): Promise<void> {
    const pending = this.evaluation.pending(path);
    if (pending) {
      await pending;
    } else if (this.evaluation.hasAsyncModule(path)) {
      await this.evaluation.evaluate(path);
    } else {
      this.executePreparedModule(path);
    }
  }

  private async evaluateAsyncModule(path: string): Promise<void> {
    const cached = this.ensurePreparedSync(path);
    if (cached.loaded) return;
    if (cached.format === 'commonjs') {
      this.executePreparedModule(path);
      return;
    }
    cached.loading = true;
    for (const specifier of cached.analysis.staticImports) {
      const dependency = this.importPath(specifier, path);
      if (dependency) {
        // Sibling module bodies start while earlier dependencies are suspended.
        // The import expression observes errors; this listener owns the eager start.
        void this.evaluation.evaluate(dependency).catch(() => {});
      }
    }
    const module = this.getModule(path);
    try {
      await executeModule(cached.code, path, module, this, cached.format, true, specifier =>
        this.loadStaticImport(specifier, path)
      );
      cached.loaded = true;
      module.loaded = true;
    } finally {
      cached.loading = false;
    }
  }

  private async loadStaticImport(
    specifier: string,
    parent: string
  ): Promise<ModuleExecutionEntry['exports']> {
    const path = this.importPath(specifier, parent);
    if (path === null) return this.requireSync(specifier, parent, 'import');
    const cached = this.ensurePreparedSync(path);
    if (cached.loading && this.evaluation.hasPath(path, parent)) {
      return this.importNamespace(cached.exports, cached);
    }
    await this.evaluateImport(path);
    return this.importNamespace(cached.exports, cached);
  }

  asyncLoad(specifier: string | URL, currentFilePath: string): Promise<unknown> {
    return this.trackIO(this.loadImport(specifier, currentFilePath));
  }

  private async loadImport(specifier: string | URL, currentFilePath: string): Promise<unknown> {
    const moduleName = `${specifier}`;
    if (isBuiltInModule(moduleName)) {
      return this.builtinNamespace(moduleName, this.resolveBuiltin(moduleName));
    }

    const resolved = await this.resolver.resolve(moduleName, currentFilePath, 'import');
    if (!resolved) throw createModuleNotFoundError(moduleName, currentFilePath, 'import');
    if (resolved.isBuiltIn) {
      return this.builtinNamespace(resolved.path, this.resolveBuiltin(resolved.path));
    }

    const prepared = await this.prepareModule(moduleName, currentFilePath, new Set(), 'import');
    if (prepared.__isBuiltIn) {
      return this.builtinNamespace(prepared.moduleName, this.resolveBuiltin(prepared.moduleName));
    }
    await this.evaluateImport(prepared.resolvedPath);
    const cached = this.executionCache[prepared.resolvedPath];
    return this.importNamespace(cached.exports, cached);
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
        analysis: ModuleCode.analyze(''),
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
