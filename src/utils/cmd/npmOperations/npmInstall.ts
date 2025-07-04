import {
  getFileSystem,
  getProjectDir,
  ensureDirectoryExists,
} from "../../filesystem";
import { UnixCommands } from "../../cmd/unix";
import FS from "@isomorphic-git/lightning-fs";
const pako = await import("pako");
const tarStream = await import("tar-stream");

export class NpmInstall {
  private fs: FS;
  private projectName: string;
  private onFileOperation?: (
    path: string,
    type: "file" | "folder" | "delete",
    content?: string,
    isNodeRuntime?: boolean,
  ) => Promise<void>;

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
  }

  async removeDirectory(dirPath: string): Promise<void> {
    const unixCommands = new UnixCommands(this.projectName);
    unixCommands.rmdir(dirPath);
  }
  
  // パッケージをダウンロードしてインストール（.tgzから直接）
  async downloadAndInstallPackage(
    packageName: string,
    version: string = "latest",
  ): Promise<void> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const nodeModulesDir = `${projectDir}/node_modules`;
      const packageDir = `${nodeModulesDir}/${packageName}`;

      // .tgzのURLを構築
      const tgzUrl = `https://registry.npmjs.org/${packageName}/-/${packageName}-${version}.tgz`;
      console.log(
        `[npm.downloadAndInstallPackage] Downloading from: ${tgzUrl}`,
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