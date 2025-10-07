/**
 * [NEW ARCHITECTURE] Module Resolver
 *
 * ## 役割
 * - モジュールパスの解決（Node.js互換）
 * - 相対パス、node_modules、エイリアスの解決
 * - package.jsonの解析とエントリーポイント決定
 */

import { normalizePath, dirname } from './pathUtils';
import { runtimeInfo, runtimeWarn, runtimeError } from './runtimeLogger';

import { fileRepository } from '@/engine/core/fileRepository';

/**
 * パッケージ情報
 */
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

/**
 * 解決結果
 */
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
  private projectId: string;
  private projectName: string;
  private projectDir: string;
  private packageJsonCache: Map<string, PackageJson> = new Map();
  private fileCache: Map<string, boolean> = new Map(); // ファイル存在チェックキャッシュ

  constructor(projectId: string, projectName: string) {
    this.projectId = projectId;
    this.projectName = projectName;
    this.projectDir = `/projects/${projectName}`;
  }

  /**
   * モジュールパスを解決
   */
  async resolve(moduleName: string, currentFilePath: string): Promise<ResolveResult | null> {
    runtimeInfo('🔍 Resolving module:', moduleName, 'from', currentFilePath);

    // 1. ビルトインモジュール
    if (this.isBuiltInModule(moduleName)) {
      return {
        path: moduleName,
        isBuiltIn: true,
        isNodeModule: false,
      };
    }

    // 2. Package imports (#で始まる)
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

    // 3. 相対パス (./, ../)
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      const currentDir = this.dirname(currentFilePath);
      const resolved = this.resolvePath(currentDir, moduleName);
      const finalPath = await this.addExtensionIfNeeded(resolved);

      if (finalPath) {
        return {
          path: finalPath,
          isBuiltIn: false,
          isNodeModule: false,
        };
      }
    }

    // 4. エイリアス (@/)
    if (moduleName.startsWith('@/')) {
      const resolved = moduleName.replace('@/', `${this.projectDir}/src/`);
      const finalPath = await this.addExtensionIfNeeded(resolved);

      if (finalPath) {
        return {
          path: finalPath,
          isBuiltIn: false,
          isNodeModule: false,
        };
      }
    }

    // 4. node_modules
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

  /**
   * ビルトインモジュールかどうかを判定
   */
  private isBuiltInModule(moduleName: string): boolean {
    const builtIns = [
      'fs',
      'fs/promises',
      'path',
      'os',
      'util',
      'http',
      'https',
      'buffer',
      'readline',
      'crypto',
      'stream',
      'events',
      'url',
      'querystring',
      'assert',
      'child_process',
      'cluster',
      'dgram',
      'dns',
      'domain',
      'net',
      'tls',
      'tty',
      'zlib',
    ];

    return builtIns.includes(moduleName);
  }

  /**
   * node_modulesからモジュールを解決
   */
  private async resolveNodeModules(
    moduleName: string,
    currentFilePath?: string
  ): Promise<{ path: string; packageJson?: PackageJson } | null> {
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

    runtimeInfo('📦 Resolving node_modules:', { packageName, subPath });

    // package.jsonを読み込み
    const packageJsonPath = `${this.projectDir}/node_modules/${packageName}/package.json`;
    runtimeInfo('🔍 Looking for package.json at:', packageJsonPath);

    const packageJson = await this.loadPackageJson(packageJsonPath);

    if (!packageJson) {
      runtimeWarn('⚠️ package.json not found:', packageJsonPath);

      // デバッグ: node_modulesにどんなファイルがあるか確認
      try {
        const files = await fileRepository.getProjectFiles(this.projectId);
        const nodeModuleFiles = files.filter(f =>
          f.path.startsWith('/node_modules/' + packageName)
        );
        runtimeInfo(`📁 Found ${nodeModuleFiles.length} files for ${packageName}`);
        runtimeInfo(
          'Files:',
          nodeModuleFiles.map(f => `${f.path} (type: ${f.type})`)
        );
      } catch (e) {
        runtimeError('Failed to list files:', e);
      }

      return this.tryFallbackPaths(packageName, subPath);
    }

    // サブパス指定あり
    if (subPath) {
      // exportsフィールドをチェック（存在すれば優先）
      if (packageJson.exports) {
        const exportPath = this.resolveExports(packageJson.exports, `./${subPath}`);
        if (exportPath) {
          const fullPath = `${this.projectDir}/node_modules/${packageName}/${exportPath}`;
          if (await this.fileExists(fullPath)) {
            return { path: fullPath, packageJson };
          }
        }
      }

      // 直接パス
      const directPath = `${this.projectDir}/node_modules/${packageName}/${subPath}`;
      const finalPath = await this.addExtensionIfNeeded(directPath);
      if (finalPath) {
        return { path: finalPath, packageJson };
      }
    }

    // package.json.exports があれば、パッケージルートは exports['.'] を優先して解決する
    if (packageJson.exports) {
      const exportRoot = this.resolveExports(packageJson.exports, '.');
      if (exportRoot) {
        const fullPath = `${this.projectDir}/node_modules/${packageName}/${exportRoot}`;
        const finalPath = await this.addExtensionIfNeeded(fullPath);
        if (finalPath) return { path: finalPath, packageJson };
      }
    }

    // パッケージルート - エントリーポイントを解決（exports が無ければ main/module を使う）
    let entryPoint = packageJson.module || packageJson.main || 'index.js';
    // ./ プレフィックスを削除
    if (entryPoint.startsWith('./')) {
      entryPoint = entryPoint.slice(2);
    }
    runtimeInfo('📦 Entry point:', entryPoint, 'for', packageName);
    const fullPath = `${this.projectDir}/node_modules/${packageName}/${entryPoint}`;
    const finalPath = await this.addExtensionIfNeeded(fullPath);

    if (finalPath) {
      runtimeInfo('✅ Resolved:', finalPath);
      return { path: finalPath, packageJson };
    }

    runtimeWarn('⚠️ Entry point not found, trying fallback');
    return this.tryFallbackPaths(packageName, subPath);
  }

  /**
   * package.jsonのimportsフィールドを解決 (#で始まるモジュール)
   */
  private async resolvePackageImports(
    moduleName: string,
    currentFilePath: string
  ): Promise<{ path: string; packageJson?: PackageJson } | null> {
    runtimeInfo('📦 Resolving package imports:', moduleName, 'from', currentFilePath);

    // 現在のファイルが属するパッケージのpackage.jsonを探す
    const packageJson = await this.findPackageJson(currentFilePath);
    if (!packageJson) {
      runtimeWarn('⚠️ No package.json found for:', currentFilePath);
      return null;
    }

    // importsフィールドをチェック
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

    // 相対パスを絶対パスに変換（パッケージルートから）
    let packageDir = dirname(currentFilePath);

    // node_modules内のファイルの場合、パッケージルートを取得
    if (packageDir.includes('/node_modules/')) {
      const match = packageDir.match(/^(.*\/node_modules\/[^/]+)/);
      if (match) {
        packageDir = match[1];
      }
    }

    runtimeInfo('📦 Package dir:', packageDir);
    const resolved = this.resolvePath(packageDir, importPath);
    runtimeInfo('📦 Resolved path:', resolved);
    const finalPath = await this.addExtensionIfNeeded(resolved);

    if (finalPath) {
      runtimeInfo('✅ Final path:', finalPath);
      return { path: finalPath, packageJson };
    }

    runtimeWarn('⚠️ Failed to resolve import path:', resolved);
    return null;
  }

  /**
   * 現在のファイルが属するパッケージのpackage.jsonを探す
   */
  private async findPackageJson(filePath: string): Promise<PackageJson | null> {
    let currentDir = dirname(filePath);

    // node_modules内のファイルの場合、そのパッケージのpackage.jsonを探す
    if (currentDir.includes('/node_modules/')) {
      // /projects/new/node_modules/chalk/source/index.js
      // → /projects/new/node_modules/chalk/package.json
      const match = currentDir.match(/^(.*\/node_modules\/[^/]+)/);
      if (match) {
        const packageDir = match[1];
        const packageJsonPath = `${packageDir}/package.json`;
        return await this.loadPackageJson(packageJsonPath);
      }
    }

    // プロジェクトルートまで遡る
    while (currentDir !== '/' && currentDir !== this.projectDir) {
      const packageJsonPath = `${currentDir}/package.json`;
      const packageJson = await this.loadPackageJson(packageJsonPath);
      if (packageJson) {
        return packageJson;
      }
      currentDir = dirname(currentDir);
    }

    return null;
  }

  /**
   * importsフィールドを解決
   */
  private resolveImports(imports: Record<string, unknown>, subPath: string): string | null {
    // Exact match first
    const exact = imports[subPath];
    if (exact !== undefined) {
      if (typeof exact === 'string') return exact;
      if (typeof exact === 'object' && exact !== null) {
        const obj = exact as Record<string, unknown>;
        // prefer require -> import -> default
        return (obj.require as string) || (obj.import as string) || (obj.default as string) || null;
      }
    }

    // Wildcard matches (longest prefix wins)
    const wildcardKeys = Object.keys(imports).filter(k => k.endsWith('/*'));
    // sort by prefix length desc
    wildcardKeys.sort((a, b) => b.length - a.length);
    for (const key of wildcardKeys) {
      const prefix = key.slice(0, -2);
      if (subPath.startsWith(prefix)) {
        const remainder = subPath.slice(prefix.length);
        const value = imports[key];
        if (typeof value === 'string') return value.replace('*', remainder);
        if (typeof value === 'object' && value !== null) {
          const obj = value as Record<string, unknown>;
          const resolved =
            (obj.require as string) || (obj.import as string) || (obj.default as string);
          if (resolved) return resolved.replace('*', remainder);
        }
      }
    }

    return null;
  }

  /**
   * exportsフィールドを解決
   */
  private resolveExports(
    exports: Record<string, unknown> | string,
    subPath: string
  ): string | null {
    // If exports is a string, treat as main entry
    if (typeof exports === 'string') {
      return exports.replace(/^\.\//, '');
    }

    // Normalize subPath: accept '.' or './' prefixed values
    let sp = subPath;
    if (sp === './' || sp === '') sp = '.';
    if (sp.startsWith('./')) sp = sp.slice(1); // './foo' -> '/foo' style; we'll match keys as given

    // Exact match first
    if ((exports as any)[sp] !== undefined) {
      const value = (exports as any)[sp];
      if (typeof value === 'string') return value.replace(/^\.\//, '');
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        return (obj.require as string) || (obj.import as string) || (obj.default as string) || null;
      }
    }

    // Try '.' default export
    if ((sp === '.' || sp === '/.') && (exports as any)['.'] !== undefined) {
      const value = (exports as any)['.'];
      if (typeof value === 'string') return value.replace(/^\.\//, '');
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        return (obj.require as string) || (obj.import as string) || (obj.default as string) || null;
      }
    }

    // Wildcard/pattern matches: keys ending with '/*' or patterns with trailing '/'
    const exportKeys = Object.keys(exports as any).filter(k => typeof k === 'string');
    // prefer longer keys (more specific)
    exportKeys.sort((a, b) => b.length - a.length);
    for (const key of exportKeys) {
      if (!key.includes('*') && !key.endsWith('/*')) continue;
      if (key.endsWith('/*')) {
        const prefix = key.slice(0, -2);
        if (sp.startsWith(prefix)) {
          const remainder = sp.slice(prefix.length);
          const value = (exports as any)[key];
          if (typeof value === 'string') return value.replace('*', remainder).replace(/^\.\//, '');
          if (typeof value === 'object' && value !== null) {
            const obj = value as Record<string, unknown>;
            const resolved =
              (obj.require as string) || (obj.import as string) || (obj.default as string);
            if (resolved) return resolved.replace('*', remainder).replace(/^\.\//, '');
          }
        }
      }
    }

    return null;
  }

  /**
   * フォールバックパスを試す
   */
  private async tryFallbackPaths(
    packageName: string,
    subPath: string
  ): Promise<{ path: string; packageJson?: PackageJson } | null> {
    const fallbackPaths = [
      subPath
        ? `${this.projectDir}/node_modules/${packageName}/${subPath}`
        : `${this.projectDir}/node_modules/${packageName}/index.js`,
      `${this.projectDir}/node_modules/${packageName}/dist/index.js`,
      `${this.projectDir}/node_modules/${packageName}/lib/index.js`,
      `${this.projectDir}/node_modules/${packageName}/src/index.js`,
    ];

    for (const fallbackPath of fallbackPaths) {
      const finalPath = await this.addExtensionIfNeeded(fallbackPath);
      if (finalPath) {
        return { path: finalPath };
      }
    }

    return null;
  }

  /**
   * package.jsonを読み込み
   */
  private async loadPackageJson(path: string): Promise<PackageJson | null> {
    // キャッシュをチェック
    if (this.packageJsonCache.has(path)) {
      return this.packageJsonCache.get(path)!;
    }

    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const normalizedPath = normalizePath(path, this.projectName);
      runtimeInfo('🔍 Normalized path:', path, '→', normalizedPath);

      // デバッグ: 比較を詳細に
      const file = files.find(f => {
        const normalizedFilePath = normalizePath(f.path, this.projectName);
        const match = normalizedFilePath === normalizedPath;
        if (f.path.includes('package.json') && f.path.includes('chalk')) {
          runtimeInfo('Comparing:', normalizedFilePath, '===', normalizedPath, '→', match);
        }
        return match;
      });

      if (!file) {
        runtimeWarn('❌ File not found. Searched for:', normalizedPath);
        runtimeInfo(
          'Available package.json files:',
          files
            .filter(f => f.path.includes('package.json') && f.path.includes('chalk'))
            .map(f => ({
              path: f.path,
              normalized: normalizePath(f.path, this.projectName),
            }))
        );
        return null;
      }

      const packageJson: PackageJson = JSON.parse(file.content);
      this.packageJsonCache.set(path, packageJson);
      return packageJson;
    } catch (error) {
      runtimeWarn('⚠️ Failed to load package.json:', path, error);
      return null;
    }
  }

  /**
   * 拡張子が必要な場合に追加
   */
  private async addExtensionIfNeeded(filePath: string): Promise<string | null> {
    // 既に拡張子がある場合
    if (/\.(js|mjs|cjs|ts|mts|cts|tsx|jsx|json)$/.test(filePath)) {
      if (await this.fileExists(filePath)) {
        return filePath;
      }
      return null;
    }

    // 拡張子を試す順序
    const extensions = ['.js', '.mjs', '.ts', '.mts', '.tsx', '.jsx', '.json'];
    for (const ext of extensions) {
      const pathWithExt = filePath + ext;
      if (await this.fileExists(pathWithExt)) {
        return pathWithExt;
      }
    }

    // index.jsを試す
    const indexPaths = [
      `${filePath}/index.js`,
      `${filePath}/index.mjs`,
      `${filePath}/index.ts`,
      `${filePath}/index.mts`,
      `${filePath}/index.tsx`,
    ];

    for (const indexPath of indexPaths) {
      if (await this.fileExists(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  /**
   * ファイルが存在するかチェック
   */
  private async fileExists(path: string): Promise<boolean> {
    // キャッシュをチェック
    if (this.fileCache.has(path)) {
      return this.fileCache.get(path)!;
    }

    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const normalizedPath = normalizePath(path, this.projectName);
      const exists = files.some(f => normalizePath(f.path, this.projectName) === normalizedPath);

      this.fileCache.set(path, exists);
      return exists;
    } catch (error) {
      this.fileCache.set(path, false);
      return false;
    }
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
    return dirname(filePath);
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.packageJsonCache.clear();
    this.fileCache.clear();
  }
}
