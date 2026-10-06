import { resolvePath } from '@/engine/core/fs';
import { NPM_CACHE_PATH } from '@/engine/core/fs/layout';
import type { FsApi } from '@/engine/core/fs/types';
import { ensureGitignoreContains } from '@/engine/core/gitignore';
import { transpileManager } from '@/engine/runtime/transpiler/transpileManager';

import { BatchFileWriter } from './install/batchWriter';
import {
  analyzeDependencies,
  findOrphanedPackages,
  getRootDependencies,
} from './install/dependencyGraph';
import { type NpmFile, NpmFiles } from './install/fsFiles';
import { TarExtractor } from './install/tarExtractor';
import type { ExtractedFileMap, InstallProgressCallback, PackageInfo } from './install/types';
import { resolveVersionSpec, satisfiesVersionSpec } from './install/versionUtils';

export type { InstallProgressCallback };

interface InstalledPackage {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
}

interface RegistryPackage {
  name?: string;
  'dist-tags'?: { latest?: string };
  versions: Record<string, RegistryVersion>;
}

interface RegistryVersion {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  dist?: { tarball?: string };
}

export class NpmInstall {
  private rootPath: string;
  private writer: BatchFileWriter;
  private files: NpmFiles;
  private extractor = new TarExtractor();
  private onInstallProgress?: InstallProgressCallback;
  private installingPackages: Set<string> = new Set();

  constructor(
    rootPath: string,
    private readonly fs: FsApi
  ) {
    this.rootPath = rootPath;
    this.files = new NpmFiles(fs);
    this.writer = new BatchFileWriter(fs);
  }

  private path(path: string): string {
    return resolvePath(this.rootPath, path);
  }

  setInstallProgressCallback(callback: InstallProgressCallback): void {
    this.onInstallProgress = callback;
  }

  startBatchProcessing(): void {
    this.writer.start();
  }

  async finishBatchProcessing(): Promise<void> {
    await this.writer.finish();
  }

  async removeDirectory(dirPath: string): Promise<void> {
    await this.fs.rm(dirPath, { recursive: true, force: true });
  }

  async ensureBinsForPackage(packageName: string): Promise<void> {
    try {
      const pkgFile = await this.files.getFile(
        this.path(`node_modules/${packageName}/package.json`)
      );
      if (!pkgFile?.content) return;
      let pj: InstalledPackage;
      try {
        pj = JSON.parse(pkgFile.content) as InstalledPackage;
      } catch {
        return;
      }

      const binField = pj.bin;
      let bins: Record<string, string> = {};
      if (typeof binField === 'string' && pj.name) bins[pj.name] = binField;
      else if (typeof binField === 'object' && binField !== null) bins = binField;
      if (Object.keys(bins).length === 0) return;

      await this.writer.execute(this.path('node_modules/.bin'), 'folder');
      for (const [name, relPath] of Object.entries(bins)) {
        try {
          const rel = String(relPath).replace(/^\.\//, '').replace(/^\/+/, '');
          const shim = [
            '#!/usr/bin/env node',
            `// shim for ${packageName} bin: ${name}`,
            'try {',
            `  require('../${packageName}/${rel}');`,
            '} catch (e) {',
            "  if (e && typeof e === 'object' && e.__pyxisProcessExit === true) throw e;",
            `  console.error('Failed to run ${name}:', e?.message ?? e);`,
            '  process.exit(1);',
            '}',
          ].join('\n');
          await this.writer.execute(this.path(`node_modules/.bin/${name}`), 'file', shim);
        } catch {}
      }
    } catch {}
  }

  async uninstallWithDependencies(packageName: string): Promise<string[]> {
    const snapshotFiles = await this.fs.walk(this.path('node_modules')).catch(() => []);
    const graph = await analyzeDependencies(this.fs, this.rootPath);
    const rootDeps = await getRootDependencies(this.fs, this.rootPath);
    const orphaned = findOrphanedPackages(packageName, graph, rootDeps);

    const toRemove = [packageName, ...orphaned];
    const removed: string[] = [];

    for (const pkg of toRemove) {
      try {
        const packagePath = this.path(`node_modules/${pkg}`);
        const exists = snapshotFiles.some(
          file => file.path === packagePath || file.path.startsWith(`${packagePath}/`)
        );
        if (!exists) continue;
        await this.removeDirectory(packagePath);
        removed.push(pkg);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[npm.uninstall] Failed to remove ${pkg}:`, message);
      }
    }
    return removed;
  }

  private async fetchPackageInfo(packageName: string, version = 'latest'): Promise<PackageInfo> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) throw new Error(`Package '${packageName}' not found`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as RegistryPackage;
      if (!data.name || !data['dist-tags']?.latest) {
        throw new Error(`Invalid package data for '${packageName}'`);
      }

      let rawVersion = version;
      if (version === 'latest') rawVersion = data['dist-tags'].latest ?? '';
      let resolvedKey = rawVersion;
      let versionData = data.versions[rawVersion];

      if (!versionData) {
        const resolved = resolveVersionSpec(rawVersion, data.versions);
        if (resolved) {
          resolvedKey = resolved;
          versionData = data.versions[resolved];
        }
      }

      if (!versionData?.dist?.tarball) {
        throw new Error(`No download URL found for '${packageName}@${rawVersion}'`);
      }

      return {
        name: data.name,
        version: resolvedKey,
        dependencies: versionData.dependencies || {},
        optionalDependencies: versionData.optionalDependencies || {},
        tarball: versionData.dist.tarball,
      };
    } catch (error) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout for package '${packageName}'`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch package info: ${message}`);
    }
  }

  private async isPackageInstalled(
    packageName: string,
    version: string,
    snapshotFiles?: NpmFile[]
  ): Promise<boolean> {
    try {
      const pkgPath = `node_modules/${packageName}/package.json`;
      let pkgFile: NpmFile | undefined;
      if (snapshotFiles) pkgFile = snapshotFiles.find(file => file.path === this.path(pkgPath));
      else pkgFile = await this.files.getFile(this.path(pkgPath));
      if (!pkgFile) return false;
      const pj = JSON.parse(pkgFile.content) as InstalledPackage;
      if (pj.version !== version) return false;
      return this.areDependenciesInstalled(pj.dependencies || {}, snapshotFiles);
    } catch {
      return false;
    }
  }

  private async areDependenciesInstalled(
    dependencies: Record<string, string>,
    snapshotFiles?: NpmFile[]
  ): Promise<boolean> {
    for (const [depName, depSpec] of Object.entries(dependencies)) {
      const depPath = `node_modules/${depName}/package.json`;
      let depFile: NpmFile | undefined;
      if (snapshotFiles) depFile = snapshotFiles.find(file => file.path === this.path(depPath));
      else depFile = await this.files.getFile(this.path(depPath));
      if (!depFile) return false;
      try {
        const depPackageJson = JSON.parse(depFile.content) as InstalledPackage;
        if (!depPackageJson.version || !satisfiesVersionSpec(depPackageJson.version, depSpec)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  private isConcreteVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version);
  }

  async installWithDependencies(
    packageName: string,
    version = 'latest',
    options?: { ignoreEntry?: string; isDirect?: boolean }
  ): Promise<void> {
    const packageKey = `${packageName}@${version}`;
    const isDirect = options?.isDirect ?? true;

    if (this.installingPackages.has(packageKey)) return;

    const snapshotFiles = await this.files
      .getPackageFiles(this.path('node_modules'))
      .catch(() => []);
    const gitignoreFile = await this.files.getFile(this.path('.gitignore'));

    // .gitignore に node_modules を追加
    try {
      const entry = options?.ignoreEntry ?? 'node_modules';
      const { content: newContent, changed } = ensureGitignoreContains(
        gitignoreFile?.content,
        entry
      );
      if (changed) {
        await this.files.write(this.path('.gitignore'), newContent);
      }
    } catch {}

    if (
      this.isConcreteVersion(version) &&
      (await this.isPackageInstalled(packageName, version, snapshotFiles))
    ) {
      return;
    }

    try {
      this.installingPackages.add(packageKey);

      const pkgInfo = await this.fetchPackageInfo(packageName, version);
      if (await this.isPackageInstalled(packageName, pkgInfo.version, snapshotFiles)) {
        return;
      }

      if (this.onInstallProgress)
        await this.onInstallProgress(packageName, pkgInfo.version, isDirect);

      const requiredDepEntries = Object.entries(pkgInfo.dependencies || {});
      const optionalDepEntries = Object.entries(pkgInfo.optionalDependencies || {}).filter(
        ([depName]) => !(pkgInfo.dependencies || {})[depName]
      );

      const BATCH = 3;
      for (let i = 0; i < requiredDepEntries.length; i += BATCH) {
        await Promise.all(
          requiredDepEntries
            .slice(i, i + BATCH)
            .map(([depName, depVer]) =>
              this.installWithDependencies(depName, depVer, { isDirect: false })
            )
        );
      }

      for (let i = 0; i < optionalDepEntries.length; i += BATCH) {
        await Promise.all(
          optionalDepEntries.slice(i, i + BATCH).map(async ([depName, depVer]) => {
            try {
              await this.installWithDependencies(depName, depVer, { isDirect: false });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.warn(`[npm] Skipping optional dep ${depName}@${depVer}:`, message);
            }
          })
        );
      }

      await this.downloadAndInstallPackage(packageName, pkgInfo.version, pkgInfo.tarball);
    } catch (error) {
      console.error(`[npm] Failed to install ${packageKey}:`, error);
      throw error;
    } finally {
      this.installingPackages.delete(packageKey);
    }
  }

  async downloadAndInstallPackage(
    packageName: string,
    version = 'latest',
    tarballUrl?: string
  ): Promise<void> {
    try {
      const tgzUrl =
        tarballUrl ?? `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`;
      const cachePath = await this.getTarballCachePath(tgzUrl);
      const cached = await this.fs.exists(cachePath);
      let tarballData: Uint8Array;
      if (cached) {
        tarballData = await this.fs.readFile(cachePath);
      } else {
        tarballData = await this.downloadTarball(tgzUrl, packageName, version);
      }
      const packageDir = this.path(`node_modules/${packageName}`);
      let extractedFiles: ExtractedFileMap;
      try {
        if (typeof ReadableStream !== 'undefined') {
          const tarballBuffer = new ArrayBuffer(tarballData.byteLength);
          const tarballChunk = new Uint8Array(tarballBuffer);
          tarballChunk.set(tarballData);
          const compressedStream = new ReadableStream<Uint8Array<ArrayBuffer>>({
            start: controller => {
              controller.enqueue(tarballChunk);
              controller.close();
            },
          });
          let decompressedStream: ReadableStream<Uint8Array>;
          if (typeof DecompressionStream !== 'undefined') {
            try {
              decompressedStream = compressedStream.pipeThrough(new DecompressionStream('gzip'));
            } catch {
              decompressedStream = this.extractor.createPakoDecompressedStream(compressedStream);
            }
          } else {
            decompressedStream = this.extractor.createPakoDecompressedStream(compressedStream);
          }
          extractedFiles = await this.extractor.extractFromStream(packageDir, decompressedStream);
        } else {
          const tarballBuffer = new ArrayBuffer(tarballData.byteLength);
          new Uint8Array(tarballBuffer).set(tarballData);
          extractedFiles = await this.extractor.extractFromBuffer(packageDir, tarballBuffer);
        }
      } catch (error) {
        if (cached) await this.fs.rm(cachePath, { recursive: false, force: true });
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to extract package: ${message}`);
      }
      if (!cached) {
        await this.fs.mkdir(NPM_CACHE_PATH, { recursive: true });
        await this.fs.writeFile(cachePath, tarballData);
      }

      await this.writer.execute(packageDir, 'folder');
      const foldersToCreate: string[] = [];
      const filesToCreate: Array<{ path: string; content: string | Uint8Array }> = [];

      for (const [relPath, fileInfo] of extractedFiles) {
        const fullPath = `${packageDir}/${relPath}`;
        if (fileInfo.isDirectory) {
          foldersToCreate.push(fullPath);
        } else {
          let content = fileInfo.content ?? '';
          if (fullPath.endsWith('.mjs') && typeof content === 'string' && content) {
            const result = await transpileManager.transpile({
              code: content,
              filePath: fullPath,
              isESModule: true,
            });
            content = result.code;
          }
          filesToCreate.push({ path: fullPath, content });
        }
      }
      for (const path of foldersToCreate) await this.writer.execute(path, 'folder');
      for (const file of filesToCreate) this.writer.enqueueFile(file.path, file.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Installation failed for ${packageName}@${version}: ${message}`);
    }
  }

  private async downloadTarball(
    url: string,
    packageName: string,
    version: string
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/octet-stream' },
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Package '${packageName}@${version}' not found`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Download timeout for ${packageName}@${version}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to download: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async getTarballCachePath(url: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(
      ''
    );
    return resolvePath(NPM_CACHE_PATH, `${key}.tgz`);
  }
}
