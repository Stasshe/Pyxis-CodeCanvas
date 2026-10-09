import { FSError } from '@/engine/core/fs/errors';
import { ensureGitignoreContains } from '@/engine/core/fs/gitignore';
import { getParentPath, isPathWithin, posixPath, resolvePath } from '@/engine/core/fs/index';
import { NPM_CACHE_PATH } from '@/engine/core/fs/layout';
import type { FsApi } from '@/engine/core/fs/types';
import {
  analyzeDependencies,
  findOrphanedPackages,
  getRootDependencies,
} from './install/dependencyGraph';
import { type DependencyRequest, resolveDependencyPlan } from './install/dependencyResolver';
import { NpmFiles } from './install/fsFiles';
import { verifyIntegrity } from './install/integrity';
import {
  createLockfile,
  findLockedPackage,
  type PackageLock,
  parseLockfile,
  type RootManifest,
  replayLockedTree,
  rootDependencyRequests,
} from './install/lockfile';
import { NPM_NETWORK_CONCURRENCY, npmNetwork } from './install/npmNetwork';
import { RegistryClient, type RegistryVersion } from './install/registryClient';
import { type TarEntry, TarExtractor } from './install/tarExtractor';
import {
  buildDependencyTree,
  type PlacedDependency,
  parseDependencySpec,
  pruneFailedOptionalPackages,
} from './install/tree';
import type { InstallProgressCallback, InstallResult, PackageInfo } from './install/types';
import { resolveVersionSpec } from './install/versionSpec';

const PACKAGE_INSTALL_CONCURRENCY = 6;

export type { InstallProgressCallback };

interface InstalledPackage {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
}

interface InstallMarker {
  name: string;
  version: string;
  integrity?: string;
}

const INSTALL_MARKER = '.pyxis-install-complete.json';

export class NpmInstall {
  private rootPath: string;
  private files: NpmFiles;
  private registry: RegistryClient;
  private extractor = new TarExtractor();
  private onInstallProgress?: InstallProgressCallback;
  private manifests = new Map<string, Promise<InstalledPackage | null>>();
  private cacheDirectory?: Promise<void>;

  constructor(
    rootPath: string,
    private readonly fs: FsApi
  ) {
    this.rootPath = rootPath;
    this.files = new NpmFiles(fs);
    this.registry = new RegistryClient(fs);
  }

  private path(path: string): string {
    return resolvePath(this.rootPath, path);
  }

  setInstallProgressCallback(callback: InstallProgressCallback): void {
    this.onInstallProgress = callback;
  }

  async removeDirectory(dirPath: string): Promise<void> {
    await this.fs.rm(dirPath, { recursive: true, force: true });
  }

  async ensureBinsForPackage(
    packageName: string,
    packagePath = `node_modules/${packageName}`
  ): Promise<void> {
    const pkgFile = await this.files.getFile(this.path(`${packagePath}/package.json`));
    if (!pkgFile) return;
    let packageJson: InstalledPackage;
    try {
      packageJson = JSON.parse(pkgFile.content) as InstalledPackage;
    } catch (error) {
      throw new Error(`Invalid package manifest for '${packageName}': ${String(error)}`);
    }
    const binField = packageJson.bin;
    let bins: Record<string, string> = {};
    if (typeof binField === 'string' && packageJson.name)
      bins[packageJson.name.split('/').at(-1)!] = binField;
    if (typeof binField === 'object' && binField !== null) bins = binField;
    if (Object.keys(bins).length === 0) return;

    const modulesPath = packagePath.slice(
      0,
      packagePath.lastIndexOf('node_modules/') + 'node_modules'.length
    );
    const packageDirectory = this.path(packagePath);
    const packageRoot = await this.fs.realpath(packageDirectory);
    const binDirectory = this.path(`${modulesPath}/.bin`);
    await this.fs.mkdir(binDirectory, { recursive: true });
    for (const [name, relPath] of Object.entries(bins)) {
      if (!name || name === '.' || name === '..' || /[/\\]/.test(name))
        throw new Error(`Invalid bin name '${name}'`);
      const target = resolvePath(packageDirectory, relPath);
      const realTarget = await this.fs.realpath(target).then(
        path => path,
        error => {
          if (error instanceof FSError && error.code === 'ENOENT') return undefined;
          throw error;
        }
      );
      if (!realTarget) continue;
      if (!isPathWithin(realTarget, packageRoot))
        throw new Error(`Bin '${name}' escapes package directory`);
      const binPath = resolvePath(binDirectory, name);
      const linkTarget = posixPath.relative(binDirectory, target);
      await this.fs.rm(binPath, { force: true });
      await this.fs.symlink(linkTarget, binPath);
    }
  }

  async uninstallWithDependencies(packageName: string): Promise<string[]> {
    const lockPath = this.path('package-lock.json');
    if (await this.fs.exists(lockPath)) {
      const previous = parseLockfile(await this.fs.readText(lockPath));
      const manifest = JSON.parse(
        await this.fs.readText(this.path('package.json'))
      ) as RootManifest;
      await this.installDependencies(rootDependencyRequests(manifest), 'node_modules', manifest);
      const next = parseLockfile(await this.fs.readText(lockPath));
      return Object.keys(previous.packages).filter(path => path && !next.packages[path]);
    }
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
        let message = String(error);
        if (error instanceof Error) message = error.message;
        console.warn(`[npm.uninstall] Failed to remove ${pkg}:`, message);
      }
    }
    return removed;
  }

  async resolvePackageInfo(packageName: string, version = 'latest'): Promise<PackageInfo> {
    const spec = parseDependencySpec(packageName, version);
    packageName = spec.name;
    version = spec.version;
    const data = await this.registry.getPackument(packageName);
    const latest = data['dist-tags']?.latest;
    if (!data.name) throw new Error(`Invalid package data for '${packageName}'`);

    let resolvedVersion = version;
    if (data['dist-tags']?.[version]) resolvedVersion = data['dist-tags'][version];
    let versionData: RegistryVersion | undefined = data.versions[resolvedVersion];
    if (!versionData) {
      const matchedVersion = resolveVersionSpec(version, data.versions, latest);
      if (matchedVersion) {
        resolvedVersion = matchedVersion;
        versionData = data.versions[matchedVersion];
      }
    }
    if (!versionData?.dist?.tarball) {
      throw new Error(`No download URL found for '${packageName}@${resolvedVersion}'`);
    }
    return {
      name: data.name,
      version: resolvedVersion,
      dependencies: versionData.dependencies,
      optionalDependencies: versionData.optionalDependencies,
      peerDependencies: versionData.peerDependencies,
      peerDependenciesMeta: versionData.peerDependenciesMeta,
      os: versionData.os,
      cpu: versionData.cpu,
      tarball: versionData.dist.tarball,
      integrity: versionData.dist.integrity,
      bin: versionData.bin,
    };
  }

  async installDependencies(
    requests: DependencyRequest[],
    ignoreEntry = 'node_modules',
    manifest?: RootManifest
  ): Promise<InstallResult> {
    await this.ensureGitignoreEntry(ignoreEntry);
    let lock: PackageLock | undefined;
    const lockPath = this.path('package-lock.json');
    if (manifest && (await this.fs.exists(lockPath))) {
      lock = parseLockfile(await this.fs.readText(lockPath));
    }
    let plan: PlacedDependency[] | undefined;
    if (manifest && lock) plan = replayLockedTree(lock, manifest);
    if (plan && manifest) {
      const manifestRequests = rootDependencyRequests(manifest);
      const sameRequests =
        requests.length === manifestRequests.length &&
        requests.every((request, index) => {
          const candidate = manifestRequests[index];
          return candidate?.name === request.name && candidate.version === request.version;
        });
      if (!sameRequests) plan = undefined;
    }
    const replayedLock = Boolean(plan);
    if (!plan) {
      const resolved = await resolveDependencyPlan(
        requests,
        (name, version) => {
          const locked = findLockedPackage(lock, name, version);
          if (locked) return Promise.resolve(locked);
          return this.resolvePackageInfo(name, version);
        },
        NPM_NETWORK_CONCURRENCY,
        (name, version, message) =>
          console.warn(`[npm] Skipping optional dep ${name}@${version}: ${message}`)
      );
      plan = buildDependencyTree(resolved, requests);
    }
    this.registry.clearMemoryCache();
    const changedPaths = new Set<string>();
    for (const dependency of plan) {
      if (!(await this.isPackageInstalled(dependency))) changedPaths.add(dependency.path);
    }
    const pending = plan.filter(dependency => {
      let current = dependency.path;
      while (current) {
        if (changedPaths.has(current)) return true;
        const separator = current.lastIndexOf('/node_modules/');
        if (separator < 0) return false;
        current = current.slice(0, separator);
      }
      return false;
    });
    if (lock) {
      const nextPaths = new Set(plan.map(dependency => dependency.path));
      for (const path of Object.keys(lock.packages)) {
        if (path && !nextPaths.has(path))
          await this.fs.rm(this.path(path), { recursive: true, force: true });
      }
    }
    for (const dependency of pending)
      this.manifests.delete(this.path(`${dependency.path}/package.json`));
    const failures = new Set<string>();
    const depths = new Set(pending.map(placed => placed.path.split('node_modules/').length));
    for (const depth of Array.from(depths).sort((left, right) => left - right)) {
      const layer = pending.filter(placed => placed.path.split('node_modules/').length === depth);
      for (const path of await this.installPackageJobs(layer)) failures.add(path);
    }
    const skipped = pruneFailedOptionalPackages(plan, failures);
    for (const path of skipped) await this.fs.rm(this.path(path), { recursive: true, force: true });
    plan = plan.filter(dependency => !skipped.has(dependency.path));
    if (manifest) {
      const modulesPaths = new Set<string>(['node_modules']);
      for (const placed of plan)
        modulesPaths.add(
          placed.path.slice(0, placed.path.lastIndexOf('node_modules/') + 'node_modules'.length)
        );
      for (const modulesPath of modulesPaths)
        await this.fs.rm(this.path(`${modulesPath}/.bin`), { recursive: true, force: true });
    }
    for (const placed of plan) {
      if (!placed.packageInfo.bin) continue;
      await this.ensureBinsForPackage(placed.installName ?? placed.packageInfo.name, placed.path);
    }
    if (manifest && !replayedLock) {
      await this.fs.writeFile(
        lockPath,
        `${JSON.stringify(createLockfile(manifest, plan), null, 2)}\n`
      );
    }
    return {
      installed: pending.filter(dependency => !skipped.has(dependency.path)).length,
      packageCount: plan.length,
    };
  }

  async installWithDependencies(
    packageName: string,
    version = 'latest',
    options?: { ignoreEntry?: string; isDirect?: boolean }
  ): Promise<void> {
    await this.installDependencies(
      [
        {
          name: packageName,
          version,
          isDirect: options?.isDirect ?? true,
        },
      ],
      options?.ignoreEntry ?? 'node_modules'
    );
  }

  private async ensureGitignoreEntry(entry: string): Promise<void> {
    const gitignoreFile = await this.files.getFile(this.path('.gitignore'));
    const { content, changed } = ensureGitignoreContains(gitignoreFile?.content, entry);
    if (changed) await this.files.write(this.path('.gitignore'), content);
  }

  private async getManifest(path: string): Promise<InstalledPackage | null> {
    const cached = this.manifests.get(path);
    if (cached) return cached;
    const request = this.readManifest(path);
    this.manifests.set(path, request);
    request.then(undefined, () => {
      if (this.manifests.get(path) === request) this.manifests.delete(path);
    });
    return request;
  }

  private async readManifest(path: string): Promise<InstalledPackage | null> {
    const file = await this.files.getFile(path);
    if (!file) return null;
    try {
      return JSON.parse(file.content) as InstalledPackage;
    } catch {
      return null;
    }
  }

  private async isPackageInstalled(dependency: PlacedDependency): Promise<boolean> {
    const packageDirectory = this.path(dependency.path);
    const manifest = await this.getManifest(`${packageDirectory}/package.json`);
    const markerFile = await this.files.getFile(`${packageDirectory}/${INSTALL_MARKER}`);
    let marker: InstallMarker | undefined;
    if (markerFile) {
      try {
        marker = JSON.parse(markerFile.content) as InstallMarker;
      } catch {
        marker = undefined;
      }
    }
    return (
      manifest?.name === dependency.packageInfo.name &&
      manifest?.version === dependency.packageInfo.version &&
      marker?.name === dependency.packageInfo.name &&
      marker.version === dependency.packageInfo.version &&
      marker.integrity === dependency.packageInfo.integrity
    );
  }

  private async installPackageJobs(packages: PlacedDependency[]): Promise<Set<string>> {
    const queue = packages.slice();
    let failure: Error | undefined;
    const failedOptionalNames = new Set<string>();
    const runJob = async (): Promise<void> => {
      while (queue.length > 0 && !failure) {
        const dependency = queue.shift();
        if (!dependency) continue;
        const manifestPath = this.path(`${dependency.path}/package.json`);
        this.manifests.delete(manifestPath);
        try {
          if (this.onInstallProgress) {
            await this.onInstallProgress(
              dependency.packageInfo.name,
              dependency.packageInfo.version,
              dependency.isDirect
            );
          }
          await this.downloadAndInstallPackage(
            dependency.packageInfo.name,
            dependency.packageInfo.version,
            dependency.packageInfo.tarball,
            dependency.path,
            dependency.packageInfo.integrity
          );
        } catch (error) {
          if (dependency.isOptional) {
            failedOptionalNames.add(dependency.path);
            let message = String(error);
            if (error instanceof Error) message = error.message;
            console.warn(
              `[npm] Skipping optional dep ${dependency.packageInfo.name}@${dependency.packageInfo.version}: ${message}`
            );
            continue;
          }
          if (error instanceof Error) failure = error;
          else failure = new Error(String(error));
        }
      }
    };
    const workerCount = Math.min(PACKAGE_INSTALL_CONCURRENCY, queue.length);
    const workers: Promise<void>[] = [];
    for (let index = 0; index < workerCount; index += 1) workers.push(runJob());
    await Promise.all(workers);
    if (failure) throw failure;
    return failedOptionalNames;
  }

  async downloadAndInstallPackage(
    packageName: string,
    version: string,
    tarballUrl: string,
    destination = `node_modules/${packageName}`,
    integrity?: string
  ): Promise<void> {
    try {
      const cachePath = await this.getTarballCachePath(tarballUrl);
      const cached = await this.fs.exists(cachePath);
      let tarballData: Uint8Array<ArrayBuffer>;
      if (cached) {
        tarballData = toArrayBufferBytes(await this.fs.readFile(cachePath));
      } else {
        tarballData = await this.downloadTarball(tarballUrl, packageName, version);
      }
      try {
        await verifyIntegrity(tarballData, integrity);
      } catch (error) {
        if (cached) await this.fs.rm(cachePath, { force: true });
        throw error;
      }
      const packageDir = this.path(destination);
      const compressedStream = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          controller.enqueue(tarballData);
          controller.close();
        },
      });
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Gzip decompression is unavailable in this browser');
      }
      let decompressedStream: ReadableStream<Uint8Array>;
      try {
        decompressedStream = compressedStream.pipeThrough(new DecompressionStream('gzip'));
      } catch (error) {
        throw new Error(`Failed to decompress ${packageName}@${version}: ${String(error)}`);
      }
      let touchedPackage = false;
      let filesystemFailure = false;
      let packageRoot = '';
      const createdDirectories = new Set<string>();
      try {
        await this.extractor.extractFromStream(packageDir, decompressedStream, async entry => {
          try {
            if (entry.path === `${packageDir}/${INSTALL_MARKER}`)
              throw new Error('Package archive contains a reserved install marker');
            if (!touchedPackage) {
              await this.fs.rm(packageDir, { recursive: true, force: true });
              touchedPackage = true;
              await this.fs.mkdir(packageDir, { recursive: true });
              createdDirectories.add(packageDir);
              packageRoot = await this.fs.realpath(packageDir);
            }
            await this.writeTarEntry(entry, packageDir, packageRoot, createdDirectories);
          } catch (error) {
            filesystemFailure = true;
            throw error;
          }
        });
        const packageJsonPath = `${packageDir}/package.json`;
        if (!touchedPackage || !packageRoot) {
          throw new Error(`Package archive has no package.json: ${packageName}@${version}`);
        }
        await this.assertPackagePath(packageJsonPath, packageRoot);
        if (!(await this.files.getFile(packageJsonPath))) {
          throw new Error(`Package archive has no package.json: ${packageName}@${version}`);
        }
        await this.fs.writeFile(
          `${packageDir}/${INSTALL_MARKER}`,
          `${JSON.stringify({ name: packageName, version, integrity } satisfies InstallMarker)}\n`
        );
      } catch (error) {
        if (touchedPackage) await this.fs.rm(packageDir, { recursive: true, force: true });
        if (cached && !filesystemFailure) await this.fs.rm(cachePath, { force: true });
        let message = String(error);
        if (error instanceof Error) message = error.message;
        throw new Error(`Failed to extract package: ${message}`);
      }
      if (!cached) {
        await this.ensureTarballCacheDirectory();
        await this.fs.writeFile(cachePath, tarballData);
      }
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      throw new Error(`Installation failed for ${packageName}@${version}: ${message}`);
    }
  }

  private async writeTarEntry(
    entry: TarEntry,
    packageDir: string,
    packageRoot: string,
    createdDirectories: Set<string>
  ): Promise<void> {
    if (entry.type === 'directory') {
      await this.ensurePackageDirectory(entry.path, packageDir, packageRoot, createdDirectories);
      await this.assertPackagePath(entry.path, packageRoot);
      return;
    }
    await this.ensurePackageDirectory(
      getParentPath(entry.path),
      packageDir,
      packageRoot,
      createdDirectories
    );
    await this.assertPackagePath(getParentPath(entry.path), packageRoot);
    if (entry.type === 'symlink') {
      await this.fs.symlink(entry.target, entry.path);
      return;
    }
    const exists = await this.fs.lstat(entry.path).then(
      () => true,
      error => {
        if (error instanceof FSError && error.code === 'ENOENT') return false;
        throw error;
      }
    );
    if (exists) await this.assertPackagePath(entry.path, packageRoot);
    await this.fs.writeFile(entry.path, entry.content);
  }

  private async assertPackagePath(path: string, packageRoot: string): Promise<void> {
    const realPath = await this.fs.realpath(path);
    if (!isPathWithin(realPath, packageRoot))
      throw new Error(`Archive path escapes package: ${path}`);
  }

  private async ensurePackageDirectory(
    path: string,
    packageDir: string,
    packageRoot: string,
    createdDirectories: Set<string>
  ): Promise<void> {
    if (createdDirectories.has(path)) return;
    const createdPaths: string[] = [];
    let current = path;
    while (current !== packageDir && !createdDirectories.has(current)) {
      createdPaths.push(current);
      current = getParentPath(current);
    }
    for (const createdPath of createdPaths.reverse()) {
      await this.assertPackagePath(getParentPath(createdPath), packageRoot);
      const exists = await this.fs.lstat(createdPath).then(
        () => true,
        error => {
          if (error instanceof FSError && error.code === 'ENOENT') return false;
          throw error;
        }
      );
      if (exists) {
        await this.assertPackagePath(createdPath, packageRoot);
        if ((await this.fs.stat(createdPath)).type !== 'folder')
          throw new Error(`Archive directory conflicts with existing file: ${createdPath}`);
      } else {
        await this.fs.mkdir(createdPath);
        await this.assertPackagePath(createdPath, packageRoot);
      }
      createdDirectories.add(createdPath);
    }
  }

  private async downloadTarball(
    url: string,
    packageName: string,
    version: string
  ): Promise<Uint8Array<ArrayBuffer>> {
    try {
      return await npmNetwork.run(async () => {
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
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Download timeout for ${packageName}@${version}`);
      }
      let message = String(error);
      if (error instanceof Error) message = error.message;
      throw new Error(`Failed to download: ${message}`);
    }
  }

  private ensureTarballCacheDirectory(): Promise<void> {
    if (this.cacheDirectory) return this.cacheDirectory;
    const request = this.fs.mkdir(NPM_CACHE_PATH, { recursive: true });
    this.cacheDirectory = request;
    request.then(undefined, () => {
      if (this.cacheDirectory === request) this.cacheDirectory = undefined;
    });
    return request;
  }

  private async getTarballCachePath(url: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(
      ''
    );
    return resolvePath(NPM_CACHE_PATH, `${key}.tgz`);
  }
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}
