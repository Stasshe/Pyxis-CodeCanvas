import { normalizePath, posixPath } from '@/engine/core/pathUtils';
import type { FsStat } from '../bridge/protocol';
import { isBuiltInModule } from './builtinModules';
import type { ModuleKind } from './moduleCode';
import type { ModuleFileSystem } from './moduleFileSystem';

export type PackageTarget = string | number | boolean | null | PackageTarget[] | PackageConditions;
export interface PackageConditions {
  [key: string]: PackageTarget;
}
export interface PackageJson {
  name?: string;
  main?: string;
  type?: 'module' | 'commonjs';
  exports?: PackageTarget;
  imports?: PackageConditions;
}
export interface ResolveResult {
  path: string;
  packageJson?: PackageJson;
  isBuiltIn: boolean;
  isNodeModule: boolean;
}
interface PackageScope {
  directory: string;
  packageJson: PackageJson;
}
type Lookup = { kind: 'stat' | 'package'; path: string };
type LookupValue = FsStat | PackageJson | null;
type Resolution<T> = Generator<Lookup, T, LookupValue>;

/** One resolution algorithm serves async preparation and synchronous require. */
export class ModuleResolver {
  private readonly rootPath: string;
  private readonly packageJsonCache = new Map<string, PackageJson>();
  private readonly packagePromises = new Map<string, Promise<PackageJson | null>>();
  private readonly resolutions = new Map<string, ResolveResult>();

  constructor(
    rootPath: string,
    private readonly fileSystem: ModuleFileSystem
  ) {
    this.rootPath = normalizePath(rootPath);
  }

  async resolve(
    specifier: string,
    currentFilePath: string,
    kind: ModuleKind = 'require'
  ): Promise<ResolveResult | null> {
    const key = this.resolutionKey(specifier, currentFilePath, kind);
    const cached = this.resolutions.get(key);
    if (cached) return cached;
    const resolved = await this.runAsync(this.resolveModule(specifier, currentFilePath, kind));
    if (resolved) {
      if (!resolved.isBuiltIn) resolved.path = await this.fileSystem.realpath(resolved.path);
      this.resolutions.set(key, resolved);
    }
    return resolved;
  }

  resolveSync(
    specifier: string,
    currentFilePath: string,
    kind: ModuleKind = 'require'
  ): ResolveResult | null {
    const key = this.resolutionKey(specifier, currentFilePath, kind);
    const cached = this.resolutions.get(key);
    if (cached) return cached;
    const resolved = this.runSync(this.resolveModule(specifier, currentFilePath, kind));
    if (resolved) {
      if (!resolved.isBuiltIn) resolved.path = this.fileSystem.realpathSync(resolved.path);
      this.resolutions.set(key, resolved);
    }
    return resolved;
  }

  async packageType(filePath: string): Promise<PackageJson['type']> {
    return (await this.runAsync(this.packageScope(filePath)))?.packageJson.type;
  }

  packageTypeSync(filePath: string): PackageJson['type'] {
    return this.runSync(this.packageScope(filePath))?.packageJson.type;
  }

  private resolutionKey(specifier: string, path: string, kind: ModuleKind): string {
    return JSON.stringify([kind, posixPath.dirname(path), specifier]);
  }

  private *resolveModule(
    specifier: string,
    currentFilePath: string,
    kind: ModuleKind
  ): Resolution<ResolveResult | null> {
    if (isBuiltInModule(specifier))
      return { path: specifier, isBuiltIn: true, isNodeModule: false };
    if (!specifier) return null;
    if (specifier.startsWith('file:')) {
      if (kind !== 'import') return null;
      const url = new URL(specifier);
      if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) return null;
      const encodedPath = url.pathname.toLowerCase();
      if (encodedPath.includes('%2f') || encodedPath.includes('%5c')) {
        throw this.packageError(
          'ERR_INVALID_MODULE_SPECIFIER',
          `Invalid encoded separator in ${specifier}.`
        );
      }
      specifier = decodeURIComponent(url.pathname);
    }
    if (specifier.startsWith('#'))
      return yield* this.packageImport(specifier, currentFilePath, kind);
    if (specifier.startsWith('@/'))
      specifier = posixPath.resolve(this.rootPath, 'src', specifier.slice(2));
    if (specifier.startsWith('/') || specifier.startsWith('./') || specifier.startsWith('../')) {
      const path = posixPath.resolve(posixPath.dirname(currentFilePath), specifier);
      let resolved: string | null;
      if (kind === 'import') resolved = yield* this.exactFile(path);
      else resolved = yield* this.fileOrDirectory(path);
      if (!resolved) return null;
      return { path: resolved, isBuiltIn: false, isNodeModule: false };
    }

    const parts = specifier.split('/');
    let packageName = parts.shift() || '';
    if (packageName.startsWith('@')) {
      const name = parts.shift();
      if (!name) return null;
      packageName += `/${name}`;
    }
    if (packageName.startsWith('.') || packageName.includes('%') || packageName.includes('\\'))
      return null;
    const subpath = parts.join('/');
    const scope = yield* this.packageScope(currentFilePath);
    if (scope?.packageJson.name === packageName && scope.packageJson.exports !== undefined) {
      return yield* this.packageEntry(scope.directory, scope.packageJson, subpath, kind);
    }
    let directory = posixPath.dirname(currentFilePath);
    while (true) {
      if (posixPath.basename(directory) !== 'node_modules') {
        const packageDirectory = posixPath.join(directory, 'node_modules', packageName);
        const packageJson = yield* this.readPackage(
          posixPath.join(packageDirectory, 'package.json')
        );
        if (packageJson)
          return yield* this.packageEntry(packageDirectory, packageJson, subpath, kind);
        const stat = yield* this.stat(packageDirectory);
        if (stat?.type === 'directory') {
          const target = posixPath.join(packageDirectory, subpath);
          let path: string | null;
          if (subpath && kind === 'import') path = yield* this.exactFile(target);
          else if (subpath) path = yield* this.fileOrDirectory(target);
          else path = yield* this.directoryEntry(packageDirectory, null);
          if (!path) return null;
          return { path, isBuiltIn: false, isNodeModule: true };
        }
      }
      if (directory === '/') return null;
      directory = posixPath.dirname(directory);
    }
  }

  private *packageEntry(
    directory: string,
    packageJson: PackageJson,
    subpath: string,
    kind: ModuleKind
  ): Resolution<ResolveResult | null> {
    let path: string | null = null;
    if (packageJson.exports !== undefined) {
      let key = '.';
      if (subpath) key = `./${subpath}`;
      const target = this.packageMap(packageJson.exports, key, kind, false);
      if (!target) return null;
      path = yield* this.exactFile(this.packageTargetPath(directory, target));
    } else if (subpath) {
      const target = posixPath.join(directory, subpath);
      if (kind === 'import') path = yield* this.exactFile(target);
      else path = yield* this.fileOrDirectory(target);
    } else {
      path = yield* this.directoryEntry(directory, packageJson);
    }
    if (!path) return null;
    return { path, packageJson, isBuiltIn: false, isNodeModule: true };
  }

  private *packageImport(
    specifier: string,
    currentFilePath: string,
    kind: ModuleKind
  ): Resolution<ResolveResult | null> {
    const scope = yield* this.packageScope(currentFilePath);
    if (!scope?.packageJson.imports) return null;
    const target = this.packageMap(scope.packageJson.imports, specifier, kind, true);
    if (!target) return null;
    if (!target.startsWith('./')) {
      return yield* this.resolveModule(
        target,
        posixPath.join(scope.directory, 'package.json'),
        kind
      );
    }
    const path = yield* this.exactFile(this.packageTargetPath(scope.directory, target));
    if (!path) return null;
    return { path, packageJson: scope.packageJson, isBuiltIn: false, isNodeModule: false };
  }

  private *packageScope(filePath: string): Resolution<PackageScope | null> {
    let directory = posixPath.dirname(filePath);
    while (posixPath.basename(directory) !== 'node_modules') {
      const packageJson = yield* this.readPackage(posixPath.join(directory, 'package.json'));
      if (packageJson) return { directory, packageJson };
      if (directory === '/') break;
      directory = posixPath.dirname(directory);
    }
    return null;
  }

  private *fileOrDirectory(path: string): Resolution<string | null> {
    const stat = yield* this.stat(path);
    if (stat?.type === 'file') return path;
    for (const extension of ['.js', '.json', '.node']) {
      const found = yield* this.exactFile(`${path}${extension}`);
      if (found) return found;
    }
    if (stat?.type !== 'directory') return null;
    const packageJson = yield* this.readPackage(posixPath.join(path, 'package.json'));
    return yield* this.directoryEntry(path, packageJson);
  }

  private *file(path: string): Resolution<string | null> {
    for (const extension of ['', '.js', '.json', '.node']) {
      const found = yield* this.exactFile(`${path}${extension}`);
      if (found) return found;
    }
    return null;
  }

  private *directoryEntry(
    directory: string,
    packageJson: PackageJson | null
  ): Resolution<string | null> {
    if (packageJson?.main) {
      const target = posixPath.resolve(directory, packageJson.main);
      const file = yield* this.file(target);
      if (file) return file;
      const index = yield* this.index(target);
      if (index) return index;
    }
    return yield* this.index(directory);
  }

  private *index(directory: string): Resolution<string | null> {
    for (const extension of ['.js', '.json', '.node']) {
      const file = yield* this.exactFile(posixPath.join(directory, `index${extension}`));
      if (file) return file;
    }
    return null;
  }

  private *exactFile(path: string): Resolution<string | null> {
    if ((yield* this.stat(path))?.type === 'file') return path;
    return null;
  }

  private *stat(path: string): Resolution<FsStat | null> {
    return (yield { kind: 'stat', path }) as FsStat | null;
  }

  private *readPackage(path: string): Resolution<PackageJson | null> {
    return (yield { kind: 'package', path }) as PackageJson | null;
  }

  private packageMap(
    map: PackageTarget,
    key: string,
    kind: ModuleKind,
    isImports: boolean
  ): string | null | undefined {
    if (map === null) return null;
    if (typeof map === 'number' || typeof map === 'boolean') {
      throw this.packageError('ERR_INVALID_PACKAGE_TARGET', `Invalid package target: ${map}`);
    }
    if (typeof map === 'string' || Array.isArray(map)) {
      if (key !== '.') return undefined;
      return this.conditionalTarget(map, kind, isImports);
    }
    const keys = Object.keys(map);
    const subpaths = keys.some(item => item.startsWith('.'));
    if (!isImports && subpaths && keys.some(item => !item.startsWith('.'))) {
      throw this.packageError(
        'ERR_INVALID_PACKAGE_CONFIG',
        'Exports cannot mix subpaths and conditions.'
      );
    }
    if (!isImports && !subpaths) {
      if (key !== '.') return undefined;
      return this.conditionalTarget(map, kind, false);
    }
    if (Object.hasOwn(map, key) && !key.includes('*'))
      return this.conditionalTarget(map[key], kind, isImports);
    const patterns = keys
      .filter(item => item.includes('*'))
      .sort((left, right) => {
        const prefixDifference = right.indexOf('*') - left.indexOf('*');
        if (prefixDifference) return prefixDifference;
        return right.length - left.length;
      });
    for (const pattern of patterns) {
      const wildcard = pattern.indexOf('*');
      if (pattern.indexOf('*', wildcard + 1) !== -1) continue;
      const prefix = pattern.slice(0, wildcard);
      const suffix = pattern.slice(wildcard + 1);
      if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < pattern.length) continue;
      const matched = key.slice(prefix.length, key.length - suffix.length);
      this.validateSegments(matched);
      const target = this.conditionalTarget(map[pattern], kind, isImports);
      if (typeof target === 'string') return target.replaceAll('*', matched);
      return target;
    }
    return undefined;
  }

  private conditionalTarget(
    target: PackageTarget,
    kind: ModuleKind,
    isImports: boolean
  ): string | null | undefined {
    if (target === null) return null;
    if (typeof target === 'number' || typeof target === 'boolean') {
      throw this.packageError('ERR_INVALID_PACKAGE_TARGET', `Invalid package target: ${target}`);
    }
    if (typeof target === 'string') {
      if (target.startsWith('./')) {
        this.validateSegments(target.slice(2));
        return target;
      }
      if (
        isImports &&
        !target.startsWith('../') &&
        !target.startsWith('/') &&
        !target.includes(':')
      )
        return target;
      throw this.packageError('ERR_INVALID_PACKAGE_TARGET', `Invalid package target: ${target}`);
    }
    if (Array.isArray(target)) {
      let lastError: Error | undefined;
      for (const entry of target) {
        try {
          const resolved = this.conditionalTarget(entry, kind, isImports);
          if (resolved !== undefined) return resolved;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            error.code !== 'ERR_INVALID_PACKAGE_TARGET'
          )
            throw error;
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      return null;
    }
    for (const [condition, value] of Object.entries(target)) {
      const index = Number(condition);
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < 2 ** 32 - 1 &&
        String(index) === condition
      ) {
        throw this.packageError(
          'ERR_INVALID_PACKAGE_CONFIG',
          `Numeric package condition: ${condition}`
        );
      }
      if (
        condition === 'default' ||
        condition === 'node' ||
        condition === 'module-sync' ||
        condition === kind
      ) {
        const resolved = this.conditionalTarget(value, kind, isImports);
        if (resolved !== undefined) return resolved;
      }
    }
    return undefined;
  }

  private validateSegments(path: string): void {
    const decoded = decodeURIComponent(path).replaceAll('\\', '/');
    for (const segment of decoded.split('/')) {
      if (
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.toLowerCase() === 'node_modules'
      ) {
        throw this.packageError(
          'ERR_INVALID_PACKAGE_TARGET',
          `Invalid package target segment: ${segment}`
        );
      }
    }
  }

  private packageTargetPath(directory: string, target: string): string {
    return posixPath.resolve(directory, target);
  }

  private packageError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
  }

  private async runAsync<T>(resolution: Resolution<T>): Promise<T> {
    let step = resolution.next();
    while (!step.done) {
      const request = step.value;
      let value: LookupValue;
      if (request.kind === 'stat') value = await this.fileSystem.stat(request.path);
      else value = await this.loadPackage(request.path);
      step = resolution.next(value);
    }
    return step.value;
  }

  private runSync<T>(resolution: Resolution<T>): T {
    let step = resolution.next();
    while (!step.done) {
      const request = step.value;
      let value: LookupValue;
      if (request.kind === 'stat') value = this.fileSystem.statSync(request.path);
      else {
        value = this.packageJsonCache.get(request.path) || null;
        if (!value) {
          const content = this.fileSystem.readOptionalFileSync(request.path);
          if (content !== null) {
            const packageJson: PackageJson = JSON.parse(content);
            this.packageJsonCache.set(request.path, packageJson);
            value = packageJson;
          }
        }
      }
      step = resolution.next(value);
    }
    return step.value;
  }

  private async loadPackage(path: string): Promise<PackageJson | null> {
    const cached = this.packageJsonCache.get(path);
    if (cached) return cached;
    const pending = this.packagePromises.get(path);
    if (pending) return pending;
    const read = async () => {
      const content = await this.fileSystem.readPackageJson(path);
      if (content === null) return null;
      const packageJson: PackageJson = JSON.parse(content);
      this.packageJsonCache.set(path, packageJson);
      return packageJson;
    };
    const promise = read();
    this.packagePromises.set(path, promise);
    try {
      return await promise;
    } finally {
      this.packagePromises.delete(path);
    }
  }

  clearCache(): void {
    this.packageJsonCache.clear();
    this.resolutions.clear();
  }
}
