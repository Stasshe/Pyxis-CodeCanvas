/**
 * npmInstall_new.ts - 新アーキテクチャ版NPMパッケージインストーラー
 *
 * NEW ARCHITECTURE:
 * - IndexedDB (fileRepository) が単一の真実の情報源
 * - npm操作は IndexedDB のみを更新
 * - GitFileSystem (lightning-fs) への同期は不要（node_modulesは.gitignoreで除外）
 * - fileRepository.createFile() を使用して自動的に管理
 */

import pako from 'pako';
import tarStream from 'tar-stream';
import { fileRepository } from '@/engine/core/fileRepository';

interface PackageInfo {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  tarball: string;
}

export class NpmInstall {
  private projectName: string;
  private projectId: string;

  // バッチ処理用のキュー
  private fileOperationQueue: Array<{
    path: string;
    type: 'file' | 'folder' | 'delete';
    content?: string;
  }> = [];
  private batchProcessing = false;

  // インストール済みパッケージを追跡するためのマップ
  private installedPackages: Map<string, string> = new Map();
  // 現在インストール処理中のパッケージ（循環依存回避）
  private installingPackages: Set<string> = new Set();

  constructor(
    projectName: string,
    projectId: string,
    skipLoadingInstalledPackages: boolean = false
  ) {
    this.projectName = projectName;
    this.projectId = projectId;

    // 既存のインストール済みパッケージを非同期で読み込み（スキップオプション付き）
    if (!skipLoadingInstalledPackages) {
      this.loadInstalledPackages().catch(error => {
        console.warn(`[npm.constructor] Failed to load installed packages: ${error.message}`);
      });
    }
  }

  // バッチ処理を開始
  startBatchProcessing(): void {
    this.batchProcessing = true;
    this.fileOperationQueue = [];
    console.log('[npmInstall] Started batch processing mode');
  }

  // バッチ処理を終了し、キューをフラッシュ
  async finishBatchProcessing(): Promise<void> {
    if (!this.batchProcessing) {
      return;
    }

    console.log(
      `[npmInstall] Finishing batch processing, ${this.fileOperationQueue.length} operations queued`
    );

    // キューに溜まった操作を並列実行（適度な並列度で）
    const BATCH_SIZE = 5;
    for (let i = 0; i < this.fileOperationQueue.length; i += BATCH_SIZE) {
      const batch = this.fileOperationQueue.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async op => {
          try {
            if (op.type === 'folder') {
              await fileRepository.createFile(this.projectId, op.path, '', 'folder');
            } else if (op.type === 'file') {
              await fileRepository.createFile(this.projectId, op.path, op.content || '', 'file');
            } else if (op.type === 'delete') {
              const files = await fileRepository.getProjectFiles(this.projectId);
              const fileToDelete = files.find(f => f.path === op.path);
              if (fileToDelete) {
                await fileRepository.deleteFile(fileToDelete.id);
              }
            }
          } catch (error) {
            console.warn(`[npmInstall] Failed to execute operation for ${op.path}:`, error);
          }
        })
      );
    }

    this.batchProcessing = false;
    this.fileOperationQueue = [];
    console.log('[npmInstall] Batch processing completed');
  }

  // ファイル操作を実行（バッチモード対応）
  private async executeFileOperation(
    path: string,
    type: 'file' | 'folder' | 'delete',
    content?: string
  ): Promise<void> {
    if (this.batchProcessing) {
      // バッチモードの場合はキューに追加
      this.fileOperationQueue.push({ path, type, content });
    } else {
      // 通常モードの場合は即座に実行
      if (type === 'folder') {
        await fileRepository.createFile(this.projectId, path, '', 'folder');
      } else if (type === 'file') {
        await fileRepository.createFile(this.projectId, path, content || '', 'file');
      } else if (type === 'delete') {
        const files = await fileRepository.getProjectFiles(this.projectId);
        const fileToDelete = files.find(f => f.path === path);
        if (fileToDelete) {
          await fileRepository.deleteFile(fileToDelete.id);
        }
      }
    }
  }

  // 既存のインストール済みパッケージを読み込む
  private async loadInstalledPackages(): Promise<void> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const nodeModulesFiles = files.filter(f => f.path.startsWith('/node_modules/') && f.path.endsWith('package.json'));
      for (const file of nodeModulesFiles) {
        try {
          const packageJson = JSON.parse(file.content);
          if (packageJson.name && packageJson.version) {
            this.installedPackages.set(packageJson.name, packageJson.version);
            console.log(
              `[npm.loadInstalledPackages] Found installed package: ${packageJson.name}@${packageJson.version}`
            );
          }
        } catch {
          // package.jsonの読み取りに失敗した場合はスキップ
        }
      }
      console.log(
        `[npm.loadInstalledPackages] Loaded ${this.installedPackages.size} installed packages`
      );
    } catch (error) {
      console.warn(`[npm.loadInstalledPackages] Error loading installed packages: ${error}`);
    }
  }

  async removeDirectory(dirPath: string): Promise<void> {
    // IndexedDB上でディレクトリ配下のファイルを全て削除
    const files = await fileRepository.getProjectFiles(this.projectId);
    const targets = files.filter(f => f.path === dirPath || f.path.startsWith(dirPath + '/'));
    for (const file of targets) {
      await fileRepository.deleteFile(file.id);
    }
  }

  // 全インストール済みパッケージの依存関係を分析
  private async analyzeDependencies(): Promise<
    Map<string, { dependencies: string[]; dependents: string[] }>
  > {
    const dependencyGraph = new Map<string, { dependencies: string[]; dependents: string[] }>();
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const nodeModulesFiles = files.filter(f => f.path.startsWith('/node_modules/') && f.path.endsWith('package.json'));
      // まず全パッケージをマップに登録
      for (const file of nodeModulesFiles) {
        try {
          const packageJson = JSON.parse(file.content);
          if (packageJson.name) {
            dependencyGraph.set(packageJson.name, { dependencies: [], dependents: [] });
          }
        } catch {}
      }
      // 各パッケージの依存関係を読み取り
      for (const file of nodeModulesFiles) {
        try {
          const packageJson = JSON.parse(file.content);
          const dependencies = Object.keys(packageJson.dependencies || {});
          const packageInfo = dependencyGraph.get(packageJson.name);
          if (packageInfo) {
            packageInfo.dependencies = dependencies;
            // 逆方向の依存関係も記録
            for (const dep of dependencies) {
              const depInfo = dependencyGraph.get(dep);
              if (depInfo) {
                depInfo.dependents.push(packageJson.name);
              }
            }
          }
        } catch {}
      }
      console.log(`[npm.analyzeDependencies] Analyzed ${dependencyGraph.size} packages`);
      return dependencyGraph;
    } catch (error) {
      console.warn(`[npm.analyzeDependencies] Error analyzing dependencies: ${error}`);
      return new Map();
    }
  }

  // ルートpackage.jsonから直接依存しているパッケージを取得
  private async getRootDependencies(): Promise<Set<string>> {
    const rootDeps = new Set<string>();
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const packageFile = files.find(f => f.path === '/package.json');
      if (!packageFile) return rootDeps;
      const packageJson = JSON.parse(packageFile.content);
      const dependencies = Object.keys(packageJson.dependencies || {});
      const devDependencies = Object.keys(packageJson.devDependencies || {});
      [...dependencies, ...devDependencies].forEach(dep => rootDeps.add(dep));
      console.log(`[npm.getRootDependencies] Found ${rootDeps.size} root dependencies`);
    } catch (error) {
      console.warn(`[npm.getRootDependencies] Error reading root dependencies: ${error}`);
    }
    return rootDeps;
  }

  // 削除可能なパッケージを再帰的に検索
  private findOrphanedPackages(
    packageToRemove: string,
    dependencyGraph: Map<string, { dependencies: string[]; dependents: string[] }>,
    rootDependencies: Set<string>
  ): string[] {
    const toRemove = new Set<string>([packageToRemove]);
    const processed = new Set<string>();

    // ルート依存関係は削除しない
    if (rootDependencies.has(packageToRemove)) {
      console.log(
        `[npm.findOrphanedPackages] ${packageToRemove} is a root dependency, not removing`
      );
      return [];
    }

    // 削除候補をキューで処理
    const queue = [packageToRemove];

    while (queue.length > 0) {
      const currentPkg = queue.shift()!;

      if (processed.has(currentPkg)) continue;
      processed.add(currentPkg);

      const pkgInfo = dependencyGraph.get(currentPkg);
      if (!pkgInfo) continue;

      // このパッケージの依存関係をチェック
      for (const dependency of pkgInfo.dependencies) {
        // ルート依存関係はスキップ
        if (rootDependencies.has(dependency)) continue;

        // 既に削除対象の場合はスキップ
        if (toRemove.has(dependency)) continue;

        const depInfo = dependencyGraph.get(dependency);
        if (!depInfo) continue;

        // この依存関係に依存している他のパッケージをチェック
        const otherDependents = depInfo.dependents.filter(
          dep =>
            !toRemove.has(dep) && // 削除対象でない
            dependencyGraph.has(dep) // 実際に存在する
        );

        // 他に依存者がいない場合は孤立パッケージ
        if (otherDependents.length === 0) {
          console.log(
            `[npm.findOrphanedPackages] ${dependency} will be orphaned, adding to removal list`
          );
          toRemove.add(dependency);
          queue.push(dependency);
        } else {
          console.log(
            `[npm.findOrphanedPackages] ${dependency} still has dependents: ${otherDependents.join(', ')}`
          );
        }
      }
    }

    // 最初に指定されたパッケージ以外を返す
    const orphaned = Array.from(toRemove).filter(pkg => pkg !== packageToRemove);
    console.log(
      `[npm.findOrphanedPackages] Found ${orphaned.length} orphaned packages: ${orphaned.join(', ')}`
    );

    return orphaned;
  }

  // 依存関係を含めてパッケージを削除
  async uninstallWithDependencies(packageName: string): Promise<string[]> {
    console.log(`[npm.uninstallWithDependencies] Analyzing dependencies for ${packageName}`);

    // 依存関係グラフを構築
    const dependencyGraph = await this.analyzeDependencies();
    const rootDependencies = await this.getRootDependencies();

    // 削除可能なパッケージを特定
    const orphanedPackages = this.findOrphanedPackages(
      packageName,
      dependencyGraph,
      rootDependencies
    );

    // メインパッケージと孤立したパッケージを削除
    const packagesToRemove = [packageName, ...orphanedPackages];
    const removedPackages: string[] = [];

    for (const pkg of packagesToRemove) {
      try {
        // IndexedDB上でパッケージが存在するかチェック
        const files = await fileRepository.getProjectFiles(this.projectId);
        const exists = files.some(f => f.path.startsWith(`/node_modules/${pkg}`));
        if (!exists) {
          console.log(`[npm.uninstallWithDependencies] Package ${pkg} not found, skipping`);
          continue;
        }

        // パッケージを削除
        await this.removeDirectory(`/node_modules/${pkg}`);
        removedPackages.push(pkg);

        // IndexedDBから削除（念のため）
        await this.executeFileOperation(`/node_modules/${pkg}`, 'delete');

        console.log(`[npm.uninstallWithDependencies] Removed ${pkg}`);
      } catch (error) {
        console.warn(
          `[npm.uninstallWithDependencies] Failed to remove ${pkg}: ${(error as Error).message}`
        );
      }
    }

    return removedPackages;
  }

  // NPMレジストリからパッケージ情報を取得
  private async fetchPackageInfo(
    packageName: string,
    version: string = 'latest'
  ): Promise<PackageInfo> {
    try {
      const packageUrl = `https://registry.npmjs.org/${packageName}`;
      console.log(`[npm.fetchPackageInfo] Fetching package info from: ${packageUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒タイムアウト

      const response = await fetch(packageUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Package '${packageName}' not found in npm registry`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // 必要なデータが存在するかチェック
      if (!data.name || !data['dist-tags'] || !data['dist-tags'].latest) {
        throw new Error(`Invalid package data for '${packageName}'`);
      }

      const targetVersion = version === 'latest' ? data['dist-tags'].latest : version;
      const versionData = data.versions[targetVersion];

      if (!versionData || !versionData.dist || !versionData.dist.tarball) {
        throw new Error(`No download URL found for '${packageName}@${targetVersion}'`);
      }

      return {
        name: data.name,
        version: targetVersion,
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

  // セマンティックバージョンを解析して実際のバージョンを決定
  private resolveVersion(versionSpec: string): string {
    // ^1.0.0 -> 1.0.0, ~1.0.0 -> 1.0.0, 1.0.0 -> 1.0.0
    return versionSpec.replace(/^[\^~]/, '');
  }

  // パッケージが既にインストールされているかチェック（依存関係も含めて）
  private async isPackageInstalled(packageName: string, version: string): Promise<boolean> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const packageFile = files.find(f => f.path === `/node_modules/${packageName}/package.json`);
      if (!packageFile) return false;
      const packageJson = JSON.parse(packageFile.content);
      if (packageJson.version === version) {
        return await this.areDependenciesInstalled(packageJson.dependencies || {});
      }
      return false;
    } catch {
      return false;
    }
  }

  // 依存関係が全てインストールされているかチェック
  private async areDependenciesInstalled(dependencies: Record<string, string>): Promise<boolean> {
    const dependencyEntries = Object.entries(dependencies);
    if (dependencyEntries.length === 0) {
      return true;
    }
    const files = await fileRepository.getProjectFiles(this.projectId);
    for (const [depName, depVersionSpec] of dependencyEntries) {
      const depVersion = this.resolveVersion(depVersionSpec);
      const depPackageFile = files.find(f => f.path === `/node_modules/${depName}/package.json`);
      if (!depPackageFile) return false;
      try {
        const depPackageJson = JSON.parse(depPackageFile.content);
        if (depPackageJson.version !== depVersion) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  // 依存関係を再帰的にインストール
  async installWithDependencies(packageName: string, version: string = 'latest'): Promise<void> {
    const resolvedVersion = this.resolveVersion(version);
    const packageKey = `${packageName}@${resolvedVersion}`;

    // 循環依存の検出
    if (this.installingPackages.has(packageKey)) {
      console.log(
        `[npm.installWithDependencies] Circular dependency detected for ${packageKey}, skipping`
      );
      return;
    }

    // ファイルシステムでのインストール状況をチェック（毎回チェック）
    if (await this.isPackageInstalled(packageName, resolvedVersion)) {
      console.log(
        `[npm.installWithDependencies] ${packageKey} with all dependencies already correctly installed, skipping`
      );
      this.installedPackages.set(packageName, resolvedVersion);
      return;
    }

    // メモリ上のキャッシュもチェックするが、ファイルシステムチェックを優先
    if (this.installedPackages.has(packageName)) {
      const installedVersion = this.installedPackages.get(packageName);
      if (installedVersion === resolvedVersion) {
        // メモリ上では一致しているが、ファイルシステムチェックで不一致だった場合は再インストール
        console.log(
          `[npm.installWithDependencies] ${packageKey} cached but dependencies missing, reinstalling`
        );
      }
    }

    try {
      // インストール処理中マークに追加
      this.installingPackages.add(packageKey);

      console.log(`[npm.installWithDependencies] Installing ${packageKey}...`);

      // パッケージ情報を取得
      const packageInfo = await this.fetchPackageInfo(packageName, resolvedVersion);

      // 依存関係を先にインストール
      const dependencies = packageInfo.dependencies || {};
      const dependencyEntries = Object.entries(dependencies);

      if (dependencyEntries.length > 0) {
        console.log(
          `[npm.installWithDependencies] Installing ${dependencyEntries.length} dependencies for ${packageKey}`
        );

        // 依存関係を並列でインストール（適度な並列度で制限）
        const DEPENDENCY_BATCH_SIZE = 3;
        for (let i = 0; i < dependencyEntries.length; i += DEPENDENCY_BATCH_SIZE) {
          const batch = dependencyEntries.slice(i, i + DEPENDENCY_BATCH_SIZE);
          await Promise.all(
            batch.map(async ([depName, depVersion]) => {
              try {
                await this.installWithDependencies(depName, this.resolveVersion(depVersion));
              } catch (error) {
                console.warn(
                  `[npm.installWithDependencies] Failed to install dependency ${depName}@${depVersion}: ${(error as Error).message}`
                );
                // 依存関係のインストールに失敗しても、メインパッケージのインストールは続行
              }
            })
          );
        }
      }

      // メインパッケージをインストール
      await this.downloadAndInstallPackage(packageName, packageInfo.version, packageInfo.tarball);

      // インストール済みマークに追加
      this.installedPackages.set(packageName, packageInfo.version);

      console.log(
        `[npm.installWithDependencies] Successfully installed ${packageKey} with ${dependencyEntries.length} dependencies`
      );
    } catch (error) {
      console.error(`[npm.installWithDependencies] Failed to install ${packageKey}:`, error);
      throw error;
    } finally {
      // インストール処理中マークから削除
      this.installingPackages.delete(packageKey);
    }
  }

  // パッケージをダウンロードしてインストール（.tgzから直接）
  async downloadAndInstallPackage(
    packageName: string,
    version: string = 'latest',
    tarballUrl?: string
  ): Promise<void> {
    try {
      // .tgzのURLを構築（指定されていない場合）
      const tgzUrl =
        tarballUrl || `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`;
      console.log(
        `[npm.downloadAndInstallPackage] Downloading ${packageName}@${version} from: ${tgzUrl}`
      );

      // .tgzファイルをダウンロード（タイムアウト付き）
      let tarballResponse: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒タイムアウト

        tarballResponse = await fetch(tgzUrl, {
          signal: controller.signal,
          headers: {
            Accept: 'application/octet-stream',
          },
        });
        clearTimeout(timeoutId);

        if (!tarballResponse.ok) {
          if (tarballResponse.status === 404) {
            throw new Error(`Package '${packageName}@${version}' not found`);
          } else {
            throw new Error(`HTTP ${tarballResponse.status}: ${tarballResponse.statusText}`);
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Download timeout for ${packageName}@${version}`);
        }
        throw new Error(`Failed to download package: ${(error as Error).message}`);
      }

      // tarballデータを取得
      let tarballData: ArrayBuffer;
      try {
        tarballData = await tarballResponse.arrayBuffer();
      } catch (error) {
        throw new Error(`Failed to read package data: ${(error as Error).message}`);
      }

      // tarballを展開
      let extractedFiles: Map<string, { isDirectory: boolean; content?: string; fullPath: string }>;
      try {
        extractedFiles = await this.extractPackage(`/node_modules/${packageName}`, tarballData);
      } catch (error) {
        // インストールに失敗した場合はディレクトリを削除
        try {
          await this.removeDirectory(`/node_modules/${packageName}`);
        } catch (cleanupError) {
          console.warn(`Failed to cleanup failed installation: ${cleanupError}`);
        }
        throw new Error(`Failed to extract package: ${(error as Error).message}`);
      }

      // IndexedDBに同期（展開されたファイルのみを使用）
      try {
        const relativePath = `/node_modules/${packageName}`;
        await this.executeFileOperation(relativePath, 'folder');

        // 展開されたファイルを順次同期
        for (const [relativePath, fileInfo] of extractedFiles) {
          const fullPath = `/node_modules/${packageName}/${relativePath}`;

          if (fileInfo.isDirectory) {
            // ディレクトリを作成
            await this.executeFileOperation(fullPath, 'folder');
          } else {
            // ファイルを作成
            const fileContent = fileInfo.content || '';
            await this.executeFileOperation(fullPath, 'file', fileContent);
          }
        }
      } catch (error) {
        console.warn(`Failed to sync to IndexedDB: ${(error as Error).message}`);
        // IndexedDB同期に失敗してもインストール自体は成功とする
      }

      console.log(
        `[npm.downloadAndInstallPackage] Package ${packageName}@${version} installed successfully`
      );
    } catch (error) {
      throw new Error(
        `Installation failed for ${packageName}@${version}: ${(error as Error).message}`
      );
    }
  }

  // パッケージの展開（実際のtar展開）- 高速化版
  private async extractPackage(
    packageDir: string,
    tarballData: ArrayBuffer
  ): Promise<Map<string, { isDirectory: boolean; content?: string; fullPath: string }>> {
    try {
      console.log(`[npm.extractPackage] Starting tar extraction to: ${packageDir}`);

      // tarballはgzip圧縮されているので、まず解凍
      const uint8Array = new Uint8Array(tarballData);

      let decompressedData: Uint8Array;

      try {
        decompressedData = pako.inflate(uint8Array);
        console.log(
          `[npm.extractPackage] Gzip decompression successful, size: ${decompressedData.length}`
        );
      } catch (error) {
        // gzip圧縮されていない場合はそのまま使用
        console.log(`[npm.extractPackage] Not gzip compressed, using raw data`);
        decompressedData = uint8Array;
      }

      const extract = tarStream.extract();

      // ファイル/ディレクトリのメタデータを格納
      const fileEntries = new Map<
        string,
        {
          type: string;
          data: Uint8Array;
          content?: string;
          fullPath: string;
        }
      >();

      // 必要なディレクトリのセット
      const requiredDirs = new Set<string>();

      // tar エントリを処理
      extract.on('entry', (header: any, stream: any, next: any) => {
        const chunks: Uint8Array[] = [];

        stream.on('data', (chunk: Uint8Array) => {
          chunks.push(chunk);
        });

        stream.on('end', () => {
          // パッケージ名のプレフィックスを削除 (例: "package/" -> "")
          let relativePath = header.name;
          if (relativePath.startsWith('package/')) {
            relativePath = relativePath.substring(8);
          }

          if (!relativePath) {
            next();
            return;
          }

          const fullPath = `${packageDir}/${relativePath}`;

          if (header.type === 'file') {
            // チャンクを結合（最適化）
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.length;
            }

            // ファイルの内容をデコード（事前に準備）
            const content = new TextDecoder('utf-8', { fatal: false }).decode(combined);

            fileEntries.set(relativePath, {
              type: header.type,
              data: combined,
              content: content,
              fullPath: fullPath,
            });

            // 親ディレクトリを必要ディレクトリに追加
            const pathParts = relativePath.split('/');
            if (pathParts.length > 1) {
              for (let i = 0; i < pathParts.length - 1; i++) {
                const dirPath = pathParts.slice(0, i + 1).join('/');
                requiredDirs.add(dirPath);
              }
            }
          } else if (header.type === 'directory') {
            fileEntries.set(relativePath, {
              type: header.type,
              data: new Uint8Array(0),
              fullPath: fullPath,
            });
            requiredDirs.add(relativePath);
          }
          next();
        });

        stream.resume();
      });

      // tar展開完了を待機
      await new Promise<void>((resolve, reject) => {
        extract.on('finish', () => {
          console.log(
            `[npm.extractPackage] Tar processing completed, found ${fileEntries.size} entries`
          );
          resolve();
        });

        extract.on('error', (error: Error) => {
          console.error(`[npm.extractPackage] Tar extraction error:`, error);
          reject(error);
        });

        extract.write(decompressedData);
        extract.end();
      });

      // 必要なディレクトリを深さ順でソート
      const sortedDirs = Array.from(requiredDirs).sort((a, b) => {
        const depthA = a.split('/').length;
        const depthB = b.split('/').length;
        return depthA - depthB;
      });

      // 戻り値用のマップを作成
      const extractedFiles = new Map<
        string,
        {
          isDirectory: boolean;
          content?: string;
          fullPath: string;
        }
      >();

      // ディレクトリ情報を追加
      for (const dirPath of sortedDirs) {
        const fullPath = `${packageDir}/${dirPath}`;
        extractedFiles.set(dirPath, {
          isDirectory: true,
          fullPath: fullPath,
        });
      }

      // ファイル情報を追加
      for (const [relativePath, entry] of fileEntries) {
        if (entry.type === 'file') {
          extractedFiles.set(relativePath, {
            isDirectory: false,
            content: entry.content,
            fullPath: entry.fullPath,
          });
        }
      }

      console.log(`[npm.extractPackage] Package extraction completed successfully`);
      return extractedFiles;
    } catch (error) {
      console.error(`[npm.extractPackage] Failed to extract package:`, error);
      throw error;
    }
  }
}
