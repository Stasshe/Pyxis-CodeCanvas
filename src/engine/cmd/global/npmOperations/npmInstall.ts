import { fileRepository } from '@/engine/core/fileRepository';
import { ensureGitignoreContains } from '@/engine/core/gitignore';
import { transformEsmToCjs } from '@/engine/runtime/transpiler/esmTransformer';

import { BatchFileWriter } from './install/batchWriter';
import { analyzeDependencies, findOrphanedPackages, getRootDependencies } from './install/dependencyGraph';
import { TarExtractor } from './install/tarExtractor';
import type { InstallProgressCallback, PackageInfo } from './install/types';
import { resolveVersion, resolveVersionSpec } from './install/versionUtils';

export type { InstallProgressCallback };

export class NpmInstall {
  private projectId: string;
  private writer: BatchFileWriter;
  private extractor = new TarExtractor();
  private onInstallProgress?: InstallProgressCallback;
  private installedPackages: Map<string, string> = new Map();
  private installingPackages: Set<string> = new Set();

  constructor(projectId: string, skipLoadingInstalledPackages = false) {
    this.projectId = projectId;
    this.writer = new BatchFileWriter(projectId);
    if (!skipLoadingInstalledPackages) {
      this.loadInstalledPackages().catch(err => {
        console.warn('[npm.constructor] Failed to load installed packages:', err.message);
      });
    }
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

  private async loadInstalledPackages(snapshotFiles?: Array<any>): Promise<void> {
    try {
      const files =
        snapshotFiles ?? (await fileRepository.getFilesByPrefix(this.projectId, '/node_modules/'));
      for (const f of files.filter(
        (f: any) => f.path.startsWith('/node_modules/') && f.path.endsWith('package.json')
      )) {
        try {
          const pj = JSON.parse(f.content);
          if (pj.name && pj.version) this.installedPackages.set(pj.name, pj.version);
        } catch {}
      }
    } catch (error) {
      console.warn('[npm.loadInstalledPackages] Error:', error);
    }
  }

  async removeDirectory(dirPath: string): Promise<void> {
    const normalized = dirPath.replace(/\/+$/, '');
    const folder = await fileRepository.getFileByPath(this.projectId, normalized);
    if (folder) await fileRepository.deleteFile(folder.id);

    const remaining = await fileRepository.getFilesByPrefix(this.projectId, normalized + '/');
    for (const file of remaining) {
      try { await fileRepository.deleteFile(file.id); } catch {}
    }
  }

  async ensureBinsForPackage(packageName: string): Promise<void> {
    try {
      const pkgFile = await fileRepository.getFileByPath(
        this.projectId,
        `/node_modules/${packageName}/package.json`
      );
      if (!pkgFile?.content) return;
      let pj: any;
      try { pj = JSON.parse(pkgFile.content); } catch { return; }

      const binField = pj.bin;
      let bins: Record<string, string> = {};
      if (typeof binField === 'string' && pj.name) bins[pj.name] = binField;
      else if (typeof binField === 'object' && binField !== null) bins = binField;
      if (Object.keys(bins).length === 0) return;

      await this.writer.execute('/node_modules/.bin', 'folder');
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
          await this.writer.execute(`/node_modules/.bin/${name}`, 'file', shim);
        } catch {}
      }
    } catch {}
  }

  async uninstallWithDependencies(packageName: string): Promise<string[]> {
    const snapshotFiles = await fileRepository.getProjectFiles(this.projectId);
    const graph = await analyzeDependencies(this.projectId, snapshotFiles);
    const rootDeps = await getRootDependencies(this.projectId, snapshotFiles);
    const orphaned = findOrphanedPackages(packageName, graph, rootDeps);

    const toRemove = [packageName, ...orphaned];
    const removed: string[] = [];

    for (const pkg of toRemove) {
      try {
        const prefix = `/node_modules/${pkg}/`;
        const exists = snapshotFiles.some(
          (f: any) => f.path === `/node_modules/${pkg}` || f.path.startsWith(prefix)
        );
        if (!exists) continue;
        await this.removeDirectory(`/node_modules/${pkg}`);
        await this.writer.execute(`/node_modules/${pkg}`, 'delete');
        removed.push(pkg);
      } catch (error) {
        console.warn(`[npm.uninstall] Failed to remove ${pkg}:`, (error as Error).message);
      }
    }
    return removed;
  }

  private async fetchPackageInfo(packageName: string, version = 'latest'): Promise<PackageInfo> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) throw new Error(`Package '${packageName}' not found`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.name || !data['dist-tags']?.latest) {
        throw new Error(`Invalid package data for '${packageName}'`);
      }

      const rawVersion = version === 'latest' ? data['dist-tags'].latest : version;
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
        tarball: versionData.dist.tarball,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout for package '${packageName}'`);
      }
      throw new Error(`Failed to fetch package info: ${(error as Error).message}`);
    }
  }

  private async isPackageInstalled(
    packageName: string,
    version: string,
    snapshotFiles?: Array<any>
  ): Promise<boolean> {
    try {
      const pkgFile = snapshotFiles
        ? snapshotFiles.find((f: any) => f.path === `/node_modules/${packageName}/package.json`)
        : await fileRepository.getFileByPath(
            this.projectId,
            `/node_modules/${packageName}/package.json`
          );
      if (!pkgFile) return false;
      const pj = JSON.parse(pkgFile.content);
      if (pj.version !== version) return false;
      return this.areDependenciesInstalled(pj.dependencies || {}, snapshotFiles);
    } catch {
      return false;
    }
  }

  private async areDependenciesInstalled(
    dependencies: Record<string, string>,
    snapshotFiles?: Array<any>
  ): Promise<boolean> {
    for (const [depName, depSpec] of Object.entries(dependencies)) {
      const depVersion = resolveVersion(depSpec);
      const depFile = snapshotFiles
        ? snapshotFiles.find((f: any) => f.path === `/node_modules/${depName}/package.json`)
        : await fileRepository.getFileByPath(
            this.projectId,
            `/node_modules/${depName}/package.json`
          );
      if (!depFile) return false;
      try {
        if (JSON.parse(depFile.content).version !== depVersion) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  async installWithDependencies(
    packageName: string,
    version = 'latest',
    options?: { ignoreEntry?: string; isDirect?: boolean }
  ): Promise<void> {
    const resolvedVersion = resolveVersion(version);
    const packageKey = `${packageName}@${resolvedVersion}`;
    const isDirect = options?.isDirect ?? true;

    if (this.installingPackages.has(packageKey)) return;

    const nodeFiles = await fileRepository.getFilesByPrefix(this.projectId, '/node_modules/');
    const packageFile = await fileRepository.getFileByPath(this.projectId, '/package.json');
    const gitignoreFile = await fileRepository.getFileByPath(this.projectId, '/.gitignore');
    const snapshotFiles = [packageFile, gitignoreFile, ...(nodeFiles || [])].filter(Boolean as any);

    // .gitignore に node_modules を追加
    try {
      const gitignoreEntry = snapshotFiles.find((f: any) => f?.path === '/.gitignore');
      const entry = options?.ignoreEntry ?? 'node_modules';
      const { content: newContent, changed } = ensureGitignoreContains(
        gitignoreEntry?.content,
        entry
      );
      if (changed) {
        await fileRepository.createFile(this.projectId, '/.gitignore', newContent, 'file');
      }
    } catch {}

    if (await this.isPackageInstalled(packageName, resolvedVersion, snapshotFiles)) {
      this.installedPackages.set(packageName, resolvedVersion);
      return;
    }

    try {
      this.installingPackages.add(packageKey);
      if (this.onInstallProgress) await this.onInstallProgress(packageName, resolvedVersion, isDirect);

      const pkgInfo = await this.fetchPackageInfo(packageName, resolvedVersion);
      const depEntries = Object.entries(pkgInfo.dependencies || {});

      const BATCH = 3;
      for (let i = 0; i < depEntries.length; i += BATCH) {
        await Promise.all(
          depEntries.slice(i, i + BATCH).map(async ([depName, depVer]) => {
            try {
              await this.installWithDependencies(depName, resolveVersion(depVer), { isDirect: false });
            } catch (error) {
              console.warn(
                `[npm] Failed to install dep ${depName}@${depVer}:`,
                (error as Error).message
              );
            }
          })
        );
      }

      await this.downloadAndInstallPackage(packageName, pkgInfo.version, pkgInfo.tarball);
      this.installedPackages.set(packageName, pkgInfo.version);
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

      let tarballResponse: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        tarballResponse = await fetch(tgzUrl, {
          signal: controller.signal,
          headers: { Accept: 'application/octet-stream' },
        });
        clearTimeout(timeoutId);
        if (!tarballResponse.ok) {
          if (tarballResponse.status === 404) throw new Error(`Package '${packageName}@${version}' not found`);
          throw new Error(`HTTP ${tarballResponse.status}: ${tarballResponse.statusText}`);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Download timeout for ${packageName}@${version}`);
        }
        throw new Error(`Failed to download: ${(error as Error).message}`);
      }

      const packageDir = `/node_modules/${packageName}`;
      let extractedFiles;
      try {
        if (tarballResponse.body && typeof ReadableStream !== 'undefined') {
          let decompressedStream: ReadableStream<Uint8Array>;
          if ((globalThis as any).DecompressionStream) {
            try {
              decompressedStream = tarballResponse.body.pipeThrough(
                new (globalThis as any).DecompressionStream('gzip')
              );
            } catch {
              decompressedStream = this.extractor.createPakoDecompressedStream(tarballResponse.body);
            }
          } else {
            decompressedStream = this.extractor.createPakoDecompressedStream(tarballResponse.body);
          }
          extractedFiles = await this.extractor.extractFromStream(packageDir, decompressedStream);
        } else {
          extractedFiles = await this.extractor.extractFromBuffer(
            packageDir,
            await tarballResponse.arrayBuffer()
          );
        }
      } catch (error) {
        try { await this.removeDirectory(packageDir); } catch {}
        throw new Error(`Failed to extract package: ${(error as Error).message}`);
      }

      try {
        await this.writer.execute(packageDir, 'folder');

        const foldersToCreate: string[] = [];
        const filesToCreate: Array<{ projectId: string; path: string; content: string; type: string }> = [];

        for (const [relPath, fileInfo] of extractedFiles) {
          const fullPath = `${packageDir}/${relPath}`;
          if (fileInfo.isDirectory) {
            foldersToCreate.push(fullPath);
          } else {
            let content = fileInfo.content || '';
            if (fullPath.endsWith('.mjs') && content) {
              content = await transformEsmToCjs(content, fullPath);
            }
            filesToCreate.push({ projectId: this.projectId, path: fullPath, content, type: 'file' });
          }
        }

        if (this.writer.isBatchActive) {
          await Promise.all(foldersToCreate.map(p => this.writer.execute(p, 'folder')));
          for (const f of filesToCreate) this.writer.enqueueFile(f.path, f.content);
        } else {
          await Promise.all(
            foldersToCreate.map(p =>
              fileRepository.createFile(this.projectId, p, '', 'folder').catch(err => {
                console.warn(`[npm] Failed to create folder ${p}:`, err);
              })
            )
          );
          const BATCH_SIZE = 500;
          for (let i = 0; i < filesToCreate.length; i += BATCH_SIZE) {
            const batch = filesToCreate.slice(i, i + BATCH_SIZE);
            try {
              await fileRepository.createFilesBulk(this.projectId, batch as any, true);
            } catch {
              await Promise.all(
                batch.map(b =>
                  fileRepository.createFile(this.projectId, b.path, b.content, 'file').catch(() => {})
                )
              );
            }
          }
        }
      } catch (error) {
        console.warn(`[npm] Failed to sync to IndexedDB:`, (error as Error).message);
      }
    } catch (error) {
      throw new Error(`Installation failed for ${packageName}@${version}: ${(error as Error).message}`);
    }
  }
}
