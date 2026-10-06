/**
 * Module Resolver
 *
 */

import { normalizePath, posixPath } from '@/engine/core/pathUtils';
import { runtimeError, runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import { isBuiltInModule } from './builtinModules';
import type { ModuleFileSystem } from './moduleFileSystem';

export interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  type?: 'module' | 'commonjs';
  exports?: Record<string, unknown> | string;
  imports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ResolveResult {
  path: string;
  packageJson?: PackageJson;
  isBuiltIn: boolean;
  isNodeModule: boolean;
}

/**
 * Module Resolver
 */
export class ModuleResolver {
  private rootPath: string;
  private fileSystem: ModuleFileSystem;
  private packageJsonCache: Map<string, PackageJson> = new Map();
  private fileCache: Map<string, boolean> = new Map(); // Cache successful file checks.

  constructor(rootPath: string, fileSystem: ModuleFileSystem) {
    this.rootPath = normalizePath(rootPath);
    this.fileSystem = fileSystem;
  }

  async resolve(moduleName: string, currentFilePath: string): Promise<ResolveResult | null> {
    moduleName = this.normalizeSpecifier(moduleName);
    runtimeInfo('🔍 Resolving module:', moduleName, 'from', currentFilePath);

    if (isBuiltInModule(moduleName)) {
      return {
        path: moduleName,
        isBuiltIn: true,
        isNodeModule: false,
      };
    }

    if (moduleName.startsWith('#')) {
      const resolved = await this.resolvePackageImports(moduleName, currentFilePath);
      if (resolved) {
        return {
          path: resolved.path,
          isBuiltIn: false,
          isNodeModule: true,
          packageJson: resolved.packageJson,
        };
      }
    }

    if (moduleName.startsWith('/')) {
      const finalPath = await this.addExtensionIfNeeded(moduleName);
      if (finalPath) {
        return {
          path: finalPath,
          isBuiltIn: false,
          isNodeModule: false,
        };
      }
    }

    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      const currentDir = posixPath.dirname(currentFilePath);
      const resolved = posixPath.resolve(currentDir, moduleName);
      const finalPath = await this.addExtensionIfNeeded(resolved);

      if (finalPath) {
        return {
          path: finalPath,
          isBuiltIn: false,
          isNodeModule: false,
        };
      }
    }

    if (moduleName.startsWith('@/')) {
      const resolved = posixPath.resolve(this.rootPath, 'src', moduleName.slice(2));
      const finalPath = await this.addExtensionIfNeeded(resolved);

      if (finalPath) {
        return {
          path: finalPath,
          isBuiltIn: false,
          isNodeModule: false,
        };
      }
    }

    // 6. node_modules
    const nodeModulePath = await this.resolveNodeModules(moduleName, currentFilePath);
    if (nodeModulePath) {
      return {
        path: nodeModulePath.path,
        packageJson: nodeModulePath.packageJson,
        isBuiltIn: false,
        isNodeModule: true,
      };
    }

    runtimeWarn('⚠️ Module not found:', moduleName);
    return null;
  }

  resolveSync(moduleName: string, currentFilePath: string): ResolveResult | null {
    const specifier = this.normalizeSpecifier(moduleName);
    if (isBuiltInModule(specifier)) {
      return { path: specifier, isBuiltIn: true, isNodeModule: false };
    }

    if (specifier.startsWith('#')) {
      const packageDirectory = this.findPackageRootSync(currentFilePath);
      let packageJson: PackageJson | null = null;
      if (packageDirectory) {
        packageJson = this.loadPackageJsonSync(posixPath.join(packageDirectory, 'package.json'));
      }
      let target: string | null = null;
      if (packageJson?.imports) target = this.resolveImports(packageJson.imports, specifier);
      if (target) {
        if (!packageDirectory || !packageJson) return null;
        const resolved = this.addExtensionIfNeededSync(posixPath.resolve(packageDirectory, target));
        if (resolved) {
          return { path: resolved, packageJson, isBuiltIn: false, isNodeModule: false };
        }
      }
    }

    if (specifier.startsWith('/') || specifier.startsWith('./') || specifier.startsWith('../')) {
      let base = posixPath.dirname(currentFilePath);
      if (specifier.startsWith('/')) base = '/';
      let candidate = specifier;
      if (!specifier.startsWith('/')) candidate = posixPath.resolve(base, specifier);
      const path = this.addExtensionIfNeededSync(candidate);
      if (path) return { path, isBuiltIn: false, isNodeModule: false };
    }

    let candidate = specifier;
    if (specifier.startsWith('@/')) {
      candidate = posixPath.resolve(this.rootPath, 'src', specifier.slice(2));
    }
    if (candidate.startsWith('/')) {
      const path = this.addExtensionIfNeededSync(candidate);
      if (path) return { path, isBuiltIn: false, isNodeModule: false };
    }

    const packageResult = this.resolveNodeModulesSync(specifier, currentFilePath);
    if (packageResult) return packageResult;
    return null;
  }

  private resolveNodeModulesSync(specifier: string, currentFilePath: string): ResolveResult | null {
    const [packageName, ...subPathParts] = this.splitPackageSpecifier(specifier);
    if (!packageName) return null;
    const subPath = subPathParts.join('/');
    let directory = posixPath.dirname(currentFilePath);

    while (true) {
      const packageDirectory = posixPath.resolve(directory, 'node_modules', packageName);
      const packageJson = this.loadPackageJsonSync(
        posixPath.join(packageDirectory, 'package.json')
      );
      if (packageJson) {
        if (packageJson.exports) {
          let exportKey = '.';
          if (subPath) exportKey = `./${subPath}`;
          const entry = this.resolveExports(packageJson.exports, exportKey);
          if (!entry) return null;
          const targetPath = posixPath.resolve(packageDirectory, entry);
          if (this.fileSystem.statSync(targetPath)?.type === 'file') {
            return { path: targetPath, packageJson, isBuiltIn: false, isNodeModule: true };
          }
          return null;
        }

        let entry = subPath;
        if (!subPath) entry = packageJson.main || packageJson.module || 'index.js';
        const target = this.addExtensionIfNeededSync(posixPath.resolve(packageDirectory, entry));
        if (target) return { path: target, packageJson, isBuiltIn: false, isNodeModule: true };
        if (subPath) return null;
      }

      if (!packageJson) {
        let firstFallback = `${packageDirectory}/index.js`;
        if (subPath) firstFallback = `${packageDirectory}/${subPath}`;
        const fallbackPaths = [
          firstFallback,
          `${packageDirectory}/dist/index.js`,
          `${packageDirectory}/lib/index.js`,
          `${packageDirectory}/src/index.js`,
        ];
        for (const path of fallbackPaths) {
          const target = this.addExtensionIfNeededSync(path);
          if (target) return { path: target, isBuiltIn: false, isNodeModule: true };
        }
      }

      if (directory === '/') break;
      directory = posixPath.dirname(directory);
    }
    return null;
  }

  private splitPackageSpecifier(specifier: string): string[] {
    const parts = specifier.split('/');
    if (specifier.startsWith('@')) return [parts.slice(0, 2).join('/'), ...parts.slice(2)];
    return parts;
  }

  private loadPackageJsonSync(path: string): PackageJson | null {
    const cached = this.packageJsonCache.get(path);
    if (cached) return cached;
    const content = this.fileSystem.readOptionalFileSync(path);
    if (content === null) return null;
    const packageJson = JSON.parse(content) as PackageJson;
    this.packageJsonCache.set(path, packageJson);
    return packageJson;
  }

  private addExtensionIfNeededSync(path: string): string | null {
    const extensions = ['', '.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.tsx', '.jsx', '.json'];
    for (const extension of extensions) {
      const candidate = `${path}${extension}`;
      if (this.fileSystem.statSync(candidate)?.type === 'file') return candidate;
    }
    for (const extension of ['index.js', 'index.cjs', 'index.mjs', 'index.ts', 'index.json']) {
      const candidate = posixPath.join(path, extension);
      if (this.fileSystem.statSync(candidate)?.type === 'file') return candidate;
    }
    return null;
  }

  private normalizeSpecifier(moduleName: string): string {
    if (!moduleName.startsWith('file://')) {
      return moduleName;
    }

    try {
      const url = new URL(moduleName);
      return decodeURIComponent(url.pathname);
    } catch {
      return moduleName.replace(/^file:\/\/\/?/, '/').replace(/[?#].*$/, '');
    }
  }

  private async resolveNodeModules(
    moduleName: string,
    currentFilePath: string
  ): Promise<{ path: string; packageJson?: PackageJson } | null> {
    // Validate module name is not empty
    if (!moduleName || moduleName.trim() === '') {
      runtimeWarn('⚠️ Empty module name provided');
      return null;
    }

    let packageName: string;
    let subPath = '';

    if (moduleName.startsWith('@')) {
      const parts = moduleName.split('/');
      if (parts.length < 2) {
        runtimeWarn('⚠️ Invalid scoped package name:', moduleName);
        return null;
      }
      packageName = `${parts[0]}/${parts[1]}`;
      subPath = parts.slice(2).join('/');
    } else {
      const parts = moduleName.split('/');
      packageName = parts[0];
      if (!packageName) {
        runtimeWarn('⚠️ Invalid package name:', moduleName);
        return null;
      }
      subPath = parts.slice(1).join('/');
    }

    runtimeInfo('📦 Resolving node_modules:', { packageName, subPath });

    const packageDirectories = this.getNodeModuleDirectories(
      packageName,
      posixPath.dirname(currentFilePath)
    );
    let packageDirectory = '';
    let packageJson: PackageJson | null = null;
    for (const directory of packageDirectories) {
      const candidate = posixPath.join(directory, 'package.json');
      packageJson = await this.loadPackageJson(candidate);
      if (packageJson) {
        packageDirectory = directory;
        break;
      }
    }

    if (!packageJson) {
      for (const directory of packageDirectories) {
        const fallback = await this.tryFallbackPathsAt(directory, subPath);
        if (fallback) return fallback;
      }
      return null;
    }

    if (packageJson.exports) {
      let exportKey = '.';
      if (subPath) exportKey = `./${subPath}`;
      const exportPath = this.resolveExports(packageJson.exports, exportKey);
      if (!exportPath) return null;
      const fullPath = posixPath.resolve(packageDirectory, exportPath);
      if (await this.fileExists(fullPath)) return { path: fullPath, packageJson };
      return null;
    }

    if (subPath) {
      const directPath = posixPath.resolve(packageDirectory, subPath);
      const finalPath = await this.addExtensionIfNeeded(directPath);
      if (finalPath) {
        return { path: finalPath, packageJson };
      }
    }

    let entryPoint = packageJson.main || packageJson.module || 'index.js';
    if (entryPoint.startsWith('./')) {
      entryPoint = entryPoint.slice(2);
    }
    runtimeInfo('📦 Entry point:', entryPoint, 'for', packageName);
    const fullPath = posixPath.resolve(packageDirectory, entryPoint);
    const finalPath = await this.addExtensionIfNeeded(fullPath);

    if (finalPath) {
      runtimeInfo('✅ Resolved:', finalPath);
      return { path: finalPath, packageJson };
    }

    runtimeWarn('⚠️ Entry point not found, trying fallback');
    for (const directory of packageDirectories) {
      const fallback = await this.tryFallbackPathsAt(directory, subPath);
      if (fallback) return fallback;
    }
    return null;
  }

  private async resolvePackageImports(
    moduleName: string,
    currentFilePath: string
  ): Promise<{ path: string; packageJson?: PackageJson } | null> {
    runtimeInfo('📦 Resolving package imports:', moduleName, 'from', currentFilePath);

    const packageJson = await this.findPackageJson(currentFilePath);
    if (!packageJson) {
      runtimeWarn('⚠️ No package.json found for:', currentFilePath);
      return null;
    }

    if (!packageJson.imports) {
      runtimeWarn('⚠️ No imports field in package.json');
      return null;
    }

    const imports = packageJson.imports as Record<string, unknown>;
    const importPath = this.resolveImports(imports, moduleName);

    if (!importPath) {
      runtimeWarn('⚠️ Import not found in package.json:', moduleName);
      return null;
    }

    runtimeInfo('📦 Import resolved:', moduleName, '→', importPath);

    const packageDir = await this.findPackageRoot(currentFilePath);
    if (!packageDir) return null;

    runtimeInfo('📦 Package dir:', packageDir);
    const resolved = posixPath.resolve(packageDir, importPath);
    runtimeInfo('📦 Resolved path:', resolved);
    const finalPath = await this.addExtensionIfNeeded(resolved);

    if (finalPath) {
      runtimeInfo('✅ Final path:', finalPath);
      return { path: finalPath, packageJson };
    }

    runtimeWarn('⚠️ Failed to resolve import path:', resolved);
    return null;
  }

  private async findPackageJson(filePath: string): Promise<PackageJson | null> {
    let currentDir = posixPath.dirname(filePath);

    if (currentDir.includes('/node_modules/')) {
      // /new/node_modules/chalk/source/index.js
      // → /new/node_modules/chalk/package.json
      const match = currentDir.match(/^(.*\/node_modules\/[^/]+)/);
      if (match) {
        const packageDir = match[1];
        const packageJsonPath = posixPath.join(packageDir, 'package.json');
        return await this.loadPackageJson(packageJsonPath);
      }
    }

    while (currentDir !== '/' && currentDir !== this.rootPath) {
      const packageJsonPath = posixPath.join(currentDir, 'package.json');
      const packageJson = await this.loadPackageJson(packageJsonPath);
      if (packageJson) {
        return packageJson;
      }
      currentDir = posixPath.dirname(currentDir);
    }

    return null;
  }

  private async findPackageRoot(filePath: string): Promise<string | null> {
    let directory = posixPath.dirname(filePath);
    while (true) {
      const packageJson = await this.loadPackageJson(posixPath.join(directory, 'package.json'));
      if (packageJson) return directory;
      if (directory === '/') return null;
      directory = posixPath.dirname(directory);
    }
  }

  private findPackageRootSync(filePath: string): string | null {
    let directory = posixPath.dirname(filePath);
    while (true) {
      const packageJson = this.loadPackageJsonSync(posixPath.join(directory, 'package.json'));
      if (packageJson) return directory;
      if (directory === '/') return null;
      directory = posixPath.dirname(directory);
    }
  }

  private resolveImports(imports: Record<string, unknown>, subPath: string): string | null {
    if (imports[subPath]) {
      return this.resolveConditionalTarget(imports[subPath]);
    }

    for (const key of Object.keys(imports)) {
      if (key.endsWith('/*')) {
        const prefix = key.slice(0, -2);
        if (subPath.startsWith(prefix)) {
          const remainder = subPath.slice(prefix.length);
          const value = imports[key];
          if (typeof value === 'string') {
            return value.replace('*', remainder);
          }
        }
      }
    }

    return null;
  }

  private resolveConditionalTarget(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const resolved = this.resolveConditionalTarget(entry);
        if (resolved) return resolved;
      }
      return null;
    }

    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const obj = value as Record<string, unknown>;
    for (const condition of ['require', 'node', 'default', 'import']) {
      if (condition in obj) {
        const resolved = this.resolveConditionalTarget(obj[condition]);
        if (resolved) return resolved;
      }
    }

    for (const [condition, target] of Object.entries(obj)) {
      if (condition === 'types' || condition.startsWith('.')) continue;
      const resolved = this.resolveConditionalTarget(target);
      if (resolved) return resolved;
    }

    return null;
  }

  private resolveExports(
    exports: Record<string, unknown> | string,
    subPath: string
  ): string | null {
    if (typeof exports === 'string') {
      if (subPath === '.') return exports;
      return null;
    }

    if (subPath in exports) return this.resolveConditionalTarget(exports[subPath]);

    if (subPath === '.') {
      if ('.' in exports) return this.resolveConditionalTarget(exports['.']);
      if (!Object.keys(exports).some(key => key.startsWith('.'))) {
        return this.resolveConditionalTarget(exports);
      }
    }

    const patterns = Object.keys(exports)
      .filter(key => key.includes('*'))
      .sort((left, right) => right.length - left.length);
    for (const pattern of patterns) {
      const wildcard = pattern.indexOf('*');
      const prefix = pattern.slice(0, wildcard);
      const suffix = pattern.slice(wildcard + 1);
      if (!subPath.startsWith(prefix) || !subPath.endsWith(suffix)) continue;
      const matched = subPath.slice(prefix.length, subPath.length - suffix.length);
      const target = this.resolveConditionalTarget(exports[pattern]);
      if (target) return target.replace('*', matched);
    }

    return null;
  }

  private async tryFallbackPathsAt(
    packageDirectory: string,
    subPath: string
  ): Promise<{ path: string; packageJson?: PackageJson } | null> {
    const fallbackPaths: string[] = [];
    if (subPath) fallbackPaths.push(posixPath.resolve(packageDirectory, subPath));
    if (!subPath) fallbackPaths.push(posixPath.join(packageDirectory, 'index.js'));
    fallbackPaths.push(posixPath.join(packageDirectory, 'dist/index.js'));
    fallbackPaths.push(posixPath.join(packageDirectory, 'lib/index.js'));
    fallbackPaths.push(posixPath.join(packageDirectory, 'src/index.js'));

    for (const fallbackPath of fallbackPaths) {
      const finalPath = await this.addExtensionIfNeeded(fallbackPath);
      if (finalPath) {
        return { path: finalPath };
      }
    }

    return null;
  }

  private async loadPackageJson(path: string): Promise<PackageJson | null> {
    if (this.packageJsonCache.has(path)) {
      return this.packageJsonCache.get(path) ?? null;
    }

    const content = await this.fileSystem.readPackageJson(path);
    if (content === null) return null;
    const packageJson: PackageJson = JSON.parse(content);
    this.packageJsonCache.set(path, packageJson);
    return packageJson;
  }

  private async addExtensionIfNeeded(filePath: string): Promise<string | null> {
    if (/\.(js|mjs|cjs|ts|mts|cts|tsx|jsx|json)$/.test(filePath)) {
      if (await this.fileExists(filePath)) {
        return filePath;
      }
      return null;
    }

    if (await this.fileExists(filePath)) {
      return filePath;
    }

    const extensions = ['.js', '.cjs', '.mjs', '.ts', '.mts', '.tsx', '.jsx', '.json'];
    for (const ext of extensions) {
      const pathWithExt = filePath + ext;
      if (await this.fileExists(pathWithExt)) {
        return pathWithExt;
      }
    }

    const indexPaths = [
      posixPath.join(filePath, 'index.js'),
      posixPath.join(filePath, 'index.cjs'),
      posixPath.join(filePath, 'index.mjs'),
      posixPath.join(filePath, 'index.ts'),
      posixPath.join(filePath, 'index.mts'),
      posixPath.join(filePath, 'index.tsx'),
    ];

    for (const indexPath of indexPaths) {
      if (await this.fileExists(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  private async fileExists(path: string): Promise<boolean> {
    if (this.fileCache.has(path)) {
      return this.fileCache.get(path) ?? false;
    }

    try {
      const stat = await this.fileSystem.stat(path);
      const exists = stat?.type === 'file';

      if (exists) this.fileCache.set(path, true);
      return exists;
    } catch (error) {
      runtimeError('Failed to inspect module path:', path, error);
      throw error;
    }
  }

  private getNodeModuleDirectories(packageName: string, startDirectory: string): string[] {
    const directories: string[] = [];
    let current = startDirectory;
    while (true) {
      directories.push(posixPath.resolve(current, 'node_modules', packageName));
      if (current === '/') return directories;
      current = posixPath.dirname(current);
    }
  }

  clearCache(): void {
    this.packageJsonCache.clear();
    this.fileCache.clear();
  }
}
