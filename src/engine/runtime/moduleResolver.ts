/**
 * [NEW ARCHITECTURE] Module Resolver
 *
 * ## 役割
 * - モジュールパスの解決（Node.js互換）
 * - 相対パス、node_modules、エイリアスの解決
 * - package.jsonの解析とエントリーポイント決定
 */

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
  async resolve(
    moduleName: string,
    currentFilePath: string
  ): Promise<ResolveResult | null> {
    console.log('🔍 Resolving module:', moduleName, 'from', currentFilePath);

    // 1. ビルトインモジュール
    if (this.isBuiltInModule(moduleName)) {
      return {
        path: moduleName,
        isBuiltIn: true,
        isNodeModule: false,
      };
    }

    // 2. 相対パス (./, ../)
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

    // 3. エイリアス (@/)
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
    const nodeModulePath = await this.resolveNodeModules(moduleName);
    if (nodeModulePath) {
      return {
        path: nodeModulePath.path,
        packageJson: nodeModulePath.packageJson,
        isBuiltIn: false,
        isNodeModule: true,
      };
    }

    console.warn('⚠️ Module not found:', moduleName);
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
    moduleName: string
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

    console.log('📦 Resolving node_modules:', { packageName, subPath });

    // package.jsonを読み込み
    const packageJsonPath = `${this.projectDir}/node_modules/${packageName}/package.json`;
    const packageJson = await this.loadPackageJson(packageJsonPath);

    if (!packageJson) {
      console.warn('⚠️ package.json not found:', packageJsonPath);
      return this.tryFallbackPaths(packageName, subPath);
    }

    // サブパス指定あり
    if (subPath) {
      // exportsフィールドをチェック
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

    // パッケージルート - エントリーポイントを解決
    const entryPoint = packageJson.module || packageJson.main || 'index.js';
    const fullPath = `${this.projectDir}/node_modules/${packageName}/${entryPoint}`;
    const finalPath = await this.addExtensionIfNeeded(fullPath);

    if (finalPath) {
      return { path: finalPath, packageJson };
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
    if (typeof exports === 'string') {
      return exports;
    }

    // 完全一致
    if (exports[subPath]) {
      const value = exports[subPath];
      if (typeof value === 'string') {
        return value;
      }
      // import/require条件
      if (typeof value === 'object' && value !== null) {
        return (value as any).import || (value as any).require || (value as any).default || null;
      }
    }

    // . (デフォルト)
    if (subPath === '.' && exports['.']) {
      const value = exports['.'];
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'object' && value !== null) {
        return (value as any).import || (value as any).require || (value as any).default || null;
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
      const normalizedPath = this.normalizePath(path);
      const file = files.find((f) => this.normalizePath(f.path) === normalizedPath);

      if (!file) {
        return null;
      }

      const packageJson: PackageJson = JSON.parse(file.content);
      this.packageJsonCache.set(path, packageJson);
      return packageJson;
    } catch (error) {
      console.warn('⚠️ Failed to load package.json:', path, error);
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
      const normalizedPath = this.normalizePath(path);
      const exists = files.some((f) => this.normalizePath(f.path) === normalizedPath);

      this.fileCache.set(path, exists);
      return exists;
    } catch (error) {
      this.fileCache.set(path, false);
      return false;
    }
  }

  /**
   * パスを正規化
   */
  private normalizePath(filePath: string): string {
    let normalized = filePath;

    // /projects/xxx/ を削除
    if (normalized.startsWith(this.projectDir)) {
      normalized = normalized.slice(this.projectDir.length);
    }

    // 先頭の / を確保
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }

    // 末尾の / を削除
    if (normalized.endsWith('/') && normalized !== '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
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
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/') || '/';
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.packageJsonCache.clear();
    this.fileCache.clear();
  }
}
