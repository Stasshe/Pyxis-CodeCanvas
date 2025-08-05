import {
  getFileSystem,
  getProjectDir,
  ensureDirectoryExists,
} from "../../filesystem";
import { UnixCommands } from "../../cmd/unix";
import FS from "@isomorphic-git/lightning-fs";
import pako from "pako";
import tarStream from"tar-stream";

interface PackageInfo {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  tarball: string;
}

export class NpmInstall {
  private fs: FS;
  private projectName: string;
  private onFileOperation?: (
    path: string,
    type: "file" | "folder" | "delete",
    content?: string,
    isNodeRuntime?: boolean,
  ) => Promise<void>;
  
  // インストール済みパッケージを追跡するためのマップ
  private installedPackages: Map<string, string> = new Map();
  // 現在インストール処理中のパッケージ（循環依存回避）
  private installingPackages: Set<string> = new Set();

  constructor(
    projectName: string,
    onFileOperation?: (
      path: string,
      type: "file" | "folder" | "delete",
      content?: string,
      isNodeRuntime?: boolean,
    ) => Promise<void>,
  ) {
    this.fs = getFileSystem()!;
    this.projectName = projectName;
    this.onFileOperation = onFileOperation;
    
    // 既存のインストール済みパッケージを非同期で読み込み
    this.loadInstalledPackages().catch(error => {
      console.warn(`[npm.constructor] Failed to load installed packages: ${error.message}`);
    });
  }

  // 既存のインストール済みパッケージを読み込む
  private async loadInstalledPackages(): Promise<void> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const nodeModulesDir = `${projectDir}/node_modules`;
      
      try {
        const entries = await this.fs.promises.readdir(nodeModulesDir);
        
        for (const entry of entries) {
          try {
            const packageDir = `${nodeModulesDir}/${entry}`;
            const packageJsonPath = `${packageDir}/package.json`;
            const stat = await this.fs.promises.stat(packageDir);
            
            if (stat.isDirectory()) {
              try {
                const packageJsonContent = await this.fs.promises.readFile(packageJsonPath, { encoding: "utf8" });
                const packageJson = JSON.parse(packageJsonContent as string);
                
                if (packageJson.name && packageJson.version) {
                  this.installedPackages.set(packageJson.name, packageJson.version);
                  console.log(`[npm.loadInstalledPackages] Found installed package: ${packageJson.name}@${packageJson.version}`);
                }
              } catch {
                // package.jsonの読み取りに失敗した場合はスキップ
              }
            }
          } catch {
            // ディレクトリの処理に失敗した場合はスキップ
          }
        }
        
        console.log(`[npm.loadInstalledPackages] Loaded ${this.installedPackages.size} installed packages`);
      } catch {
        // node_modulesディレクトリが存在しない場合は空でOK
        console.log(`[npm.loadInstalledPackages] No node_modules directory found`);
      }
    } catch (error) {
      console.warn(`[npm.loadInstalledPackages] Error loading installed packages: ${error}`);
    }
  }

  async removeDirectory(dirPath: string): Promise<void> {
    const unixCommands = new UnixCommands(this.projectName);
    unixCommands.rmdir(dirPath);
  }

  // NPMレジストリからパッケージ情報を取得
  private async fetchPackageInfo(packageName: string, version: string = "latest"): Promise<PackageInfo> {
    try {
      const packageUrl = `https://registry.npmjs.org/${packageName}`;
      console.log(`[npm.fetchPackageInfo] Fetching package info from: ${packageUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒タイムアウト

      const response = await fetch(packageUrl, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
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
      if (!data.name || !data["dist-tags"] || !data["dist-tags"].latest) {
        throw new Error(`Invalid package data for '${packageName}'`);
      }

      const targetVersion = version === "latest" ? data["dist-tags"].latest : version;
      const versionData = data.versions[targetVersion];

      if (!versionData || !versionData.dist || !versionData.dist.tarball) {
        throw new Error(
          `No download URL found for '${packageName}@${targetVersion}'`,
        );
      }

      return {
        name: data.name,
        version: targetVersion,
        dependencies: versionData.dependencies || {},
        tarball: versionData.dist.tarball,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout for package '${packageName}'`);
      }
      throw new Error(
        `Failed to fetch package info: ${(error as Error).message}`,
      );
    }
  }

  // セマンティックバージョンを解析して実際のバージョンを決定
  private resolveVersion(versionSpec: string): string {
    // ^1.0.0 -> 1.0.0, ~1.0.0 -> 1.0.0, 1.0.0 -> 1.0.0
    return versionSpec.replace(/^[\^~]/, "");
  }

  // パッケージが既にインストールされているかチェック
  private async isPackageInstalled(packageName: string, version: string): Promise<boolean> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const packageDir = `${projectDir}/node_modules/${packageName}`;
      const packageJsonPath = `${packageDir}/package.json`;

      await this.fs.promises.stat(packageDir);
      
      // package.jsonから実際のバージョンを確認
      try {
        const packageJsonContent = await this.fs.promises.readFile(packageJsonPath, { encoding: "utf8" });
        const packageJson = JSON.parse(packageJsonContent as string);
        
        // 既にインストールされているバージョンと要求されたバージョンが同じかチェック
        return packageJson.version === version;
      } catch {
        // package.jsonが読めない場合は再インストールが必要
        return false;
      }
    } catch {
      return false;
    }
  }

  // 依存関係を再帰的にインストール
  async installWithDependencies(packageName: string, version: string = "latest"): Promise<void> {
    const resolvedVersion = this.resolveVersion(version);
    const packageKey = `${packageName}@${resolvedVersion}`;

    // 循環依存の検出
    if (this.installingPackages.has(packageKey)) {
      console.log(`[npm.installWithDependencies] Circular dependency detected for ${packageKey}, skipping`);
      return;
    }

    // 既にインストール済みかチェック
    if (this.installedPackages.has(packageName)) {
      const installedVersion = this.installedPackages.get(packageName);
      if (installedVersion === resolvedVersion) {
        console.log(`[npm.installWithDependencies] ${packageKey} already installed, skipping`);
        return;
      }
    }

    // ファイルシステムでのインストール状況もチェック
    if (await this.isPackageInstalled(packageName, resolvedVersion)) {
      console.log(`[npm.installWithDependencies] ${packageKey} already exists on filesystem, skipping`);
      this.installedPackages.set(packageName, resolvedVersion);
      return;
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
        console.log(`[npm.installWithDependencies] Installing ${dependencyEntries.length} dependencies for ${packageKey}`);
        
        // 依存関係を並列でインストール（適度な並列度で制限）
        const DEPENDENCY_BATCH_SIZE = 3;
        for (let i = 0; i < dependencyEntries.length; i += DEPENDENCY_BATCH_SIZE) {
          const batch = dependencyEntries.slice(i, i + DEPENDENCY_BATCH_SIZE);
          await Promise.all(
            batch.map(async ([depName, depVersion]) => {
              try {
                await this.installWithDependencies(depName, this.resolveVersion(depVersion));
              } catch (error) {
                console.warn(`[npm.installWithDependencies] Failed to install dependency ${depName}@${depVersion}: ${(error as Error).message}`);
                // 依存関係のインストールに失敗しても、メインパッケージのインストールは続行
              }
            })
          );
        }
      }

      // メインパッケージをインストール
      await this.downloadAndInstallPackage(packageName, packageInfo.version);
      
      // インストール済みマークに追加
      this.installedPackages.set(packageName, packageInfo.version);
      
      console.log(`[npm.installWithDependencies] Successfully installed ${packageKey} with ${dependencyEntries.length} dependencies`);
      
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
    version: string = "latest",
    tarballUrl?: string,
  ): Promise<void> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const nodeModulesDir = `${projectDir}/node_modules`;
      const packageDir = `${nodeModulesDir}/${packageName}`;

      // .tgzのURLを構築（指定されていない場合）
      const tgzUrl = tarballUrl || `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`;
      console.log(
        `[npm.downloadAndInstallPackage] Downloading ${packageName}@${version} from: ${tgzUrl}`,
      );

      // パッケージディレクトリを作成
      try {
        await this.fs.promises.mkdir(packageDir, { recursive: true } as any);
      } catch (error) {
        throw new Error(
          `Failed to create package directory: ${(error as Error).message}`,
        );
      }

      // .tgzファイルをダウンロード（タイムアウト付き）
      let tarballResponse: Response;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒タイムアウト

        tarballResponse = await fetch(tgzUrl, {
          signal: controller.signal,
          headers: {
            Accept: "application/octet-stream",
          },
        });
        clearTimeout(timeoutId);

        if (!tarballResponse.ok) {
          if (tarballResponse.status === 404) {
            throw new Error(`Package '${packageName}@${version}' not found`);
          } else {
            throw new Error(
              `HTTP ${tarballResponse.status}: ${tarballResponse.statusText}`,
            );
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Download timeout for ${packageName}@${version}`);
        }
        throw new Error(
          `Failed to download package: ${(error as Error).message}`,
        );
      }

      // tarballデータを取得
      let tarballData: ArrayBuffer;
      try {
        tarballData = await tarballResponse.arrayBuffer();
      } catch (error) {
        throw new Error(
          `Failed to read package data: ${(error as Error).message}`,
        );
      }

      // tarballを展開
      let extractedFiles: Map<
        string,
        { isDirectory: boolean; content?: string; fullPath: string }
      >;
      try {
        extractedFiles = await this.extractPackage(packageDir, tarballData);
      } catch (error) {
        // インストールに失敗した場合はディレクトリを削除
        try {
          await this.removeDirectory(packageDir);
        } catch (cleanupError) {
          console.warn(
            `Failed to cleanup failed installation: ${cleanupError}`,
          );
        }
        throw new Error(
          `Failed to extract package: ${(error as Error).message}`,
        );
      }

      // IndexedDBに同期（展開されたファイルのみを使用）
      if (this.onFileOperation) {
        try {
          const relativePath = `/node_modules/${packageName}`;
          await this.onFileOperation(relativePath, "folder");

          // 展開されたファイルを順次同期
          for (const [relativePath, fileInfo] of extractedFiles) {
            const fullPath = `/node_modules/${packageName}/${relativePath}`;

            console.log(
              `[npm.downloadAndInstallPackage] Syncing: "${fullPath}"`,
            );

            if (fileInfo.isDirectory) {
              // ディレクトリを作成
              await this.onFileOperation(fullPath, "folder");
            } else {
              // ファイルを作成
              // ファイルの親ディレクトリが必要な場合は事前に作成
              const pathParts = relativePath.split("/");
              if (pathParts.length > 1) {
                let currentPath = `/node_modules/${packageName}`;
                for (let i = 0; i < pathParts.length - 1; i++) {
                  currentPath += `/${pathParts[i]}`;
                  await this.onFileOperation(currentPath, "folder");
                }
              }

              // extractPackageで既に内容が取得されているのでそれを使用
              const fileContent = fileInfo.content || "";
              await this.onFileOperation(fullPath, "file", fileContent);
            }
          }
        } catch (error) {
          console.warn(
            `Failed to sync to IndexedDB: ${(error as Error).message}`,
          );
          // IndexedDB同期に失敗してもインストール自体は成功とする
        }
      }

      console.log(
        `[npm.downloadAndInstallPackage] Package ${packageName}@${version} installed successfully`,
      );
    } catch (error) {
      throw new Error(
        `Installation failed for ${packageName}@${version}: ${(error as Error).message}`,
      );
    }
  }



  // パッケージの展開（実際のtar展開）- 高速化版
  private async extractPackage(
    packageDir: string,
    tarballData: ArrayBuffer,
  ): Promise<
    Map<string, { isDirectory: boolean; content?: string; fullPath: string }>
  > {
    try {
      console.log(
        `[npm.extractPackage] Starting tar extraction to: ${packageDir}`,
      );

      // tarballはgzip圧縮されているので、まず解凍
      const uint8Array = new Uint8Array(tarballData);
      
      let decompressedData: Uint8Array;

      try {
        decompressedData = pako.inflate(uint8Array);
        console.log(
          `[npm.extractPackage] Gzip decompression successful, size: ${decompressedData.length}`,
        );
      } catch (error) {
        // gzip圧縮されていない場合はそのまま使用
        console.log(`[npm.extractPackage] Not gzip compressed, using raw data`);
        decompressedData = uint8Array;
      }

      const extract = tarStream.extract();
      
      // ファイル/ディレクトリのメタデータを格納
      const fileEntries = new Map<string, { 
        type: string; 
        data: Uint8Array; 
        content?: string; 
        fullPath: string 
      }>();
      
      // 必要なディレクトリのセット
      const requiredDirs = new Set<string>();

      // tar エントリを処理
      extract.on("entry", (header: any, stream: any, next: any) => {
        const chunks: Uint8Array[] = [];

        stream.on("data", (chunk: Uint8Array) => {
          chunks.push(chunk);
        });

        stream.on("end", () => {
          // パッケージ名のプレフィックスを削除 (例: "package/" -> "")
          let relativePath = header.name;
          if (relativePath.startsWith("package/")) {
            relativePath = relativePath.substring(8);
          }
          
          if (!relativePath) {
            next();
            return;
          }

          const fullPath = `${packageDir}/${relativePath}`;

          if (header.type === "file") {
            // チャンクを結合（最適化）
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.length;
            }

            // ファイルの内容をデコード（事前に準備）
            const content = new TextDecoder("utf-8", { fatal: false }).decode(combined);
            
            fileEntries.set(relativePath, {
              type: header.type,
              data: combined,
              content: content,
              fullPath: fullPath
            });

            // 親ディレクトリを必要ディレクトリに追加
            const pathParts = relativePath.split("/");
            if (pathParts.length > 1) {
              for (let i = 0; i < pathParts.length - 1; i++) {
                const dirPath = pathParts.slice(0, i + 1).join("/");
                requiredDirs.add(dirPath);
              }
            }
          } else if (header.type === "directory") {
            fileEntries.set(relativePath, {
              type: header.type,
              data: new Uint8Array(0),
              fullPath: fullPath
            });
            requiredDirs.add(relativePath);
          }
          next();
        });

        stream.resume();
      });

      // tar展開完了を待機
      await new Promise<void>((resolve, reject) => {
        extract.on("finish", () => {
          console.log(
            `[npm.extractPackage] Tar processing completed, found ${fileEntries.size} entries`,
          );
          resolve();
        });

        extract.on("error", (error: Error) => {
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

      // ディレクトリを順次作成（並列処理でファイルシステムの競合を避ける）
      for (const dirPath of sortedDirs) {
        const fullPath = `${packageDir}/${dirPath}`;
        
        try {
          // 同名のファイルが存在していたら削除
          try {
            const stat = await this.fs.promises.stat(fullPath);
            if (!stat.isDirectory()) {
              await this.fs.promises.unlink(fullPath);
            }
          } catch (err: any) {
            // ファイルが存在しない場合は無視
            if (err && err.code !== "ENOENT") throw err;
          }

          await this.fs.promises.mkdir(fullPath, { recursive: true } as any);
        } catch (error: any) {
          if (error.code !== "EEXIST") {
            console.warn(`Failed to create directory ${fullPath}:`, error);
          }
        }
      }

      // ファイルを並列作成（適度な並列度で競合を避ける）
      const fileEntryArray = Array.from(fileEntries.entries()).filter(([_, entry]) => entry.type === "file");
      const BATCH_SIZE = 10;
      
      for (let i = 0; i < fileEntryArray.length; i += BATCH_SIZE) {
        const batch = fileEntryArray.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ([relativePath, entry]) => {
          const fullPath = entry.fullPath;
          
          try {
            // 同名のディレクトリが存在していたら削除
            try {
              const stat = await this.fs.promises.stat(fullPath);
              if (stat.isDirectory()) {
                await this.removeDirectory(fullPath);
              }
            } catch (err: any) {
              // ファイルが存在しない場合は無視
              if (err && err.code !== "ENOENT") throw err;
            }

            // ファイルを書き込み
            await this.fs.promises.writeFile(fullPath, entry.data);
          } catch (error) {
            console.warn(`Failed to write file ${fullPath}:`, error);
          }
        }));
      }

      // 戻り値用のマップを作成
      const extractedFiles = new Map<string, { 
        isDirectory: boolean; 
        content?: string; 
        fullPath: string 
      }>();

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
        if (entry.type === "file") {
          extractedFiles.set(relativePath, {
            isDirectory: false,
            content: entry.content,
            fullPath: entry.fullPath,
          });
        }
      }

      console.log(
        `[npm.extractPackage] Package extraction completed successfully`,
      );
      return extractedFiles;
    } catch (error) {
      console.error(`[npm.extractPackage] Failed to extract package:`, error);
      throw error;
    }
  }
}