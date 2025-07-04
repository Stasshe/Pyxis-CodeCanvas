import {
  getFileSystem,
  getProjectDir,
  ensureDirectoryExists,
} from "../../filesystem";
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


// パッケージをダウンロードしてインストール
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

  // パッケージの展開（実際のtar展開）- 完全にtar内容と同じ構造を作成
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

      const files: Array<{ name: string; data: Uint8Array; type: string }> = [];

      // tar エントリを処理
      extract.on("entry", (header: any, stream: any, next: any) => {
        const chunks: Uint8Array[] = [];

        stream.on("data", (chunk: Uint8Array) => {
          chunks.push(chunk);
        });

        stream.on("end", () => {
          if (header.type === "file") {
            // チャンクを結合
            const totalLength = chunks.reduce(
              (sum, chunk) => sum + chunk.length,
              0,
            );
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.length;
            }

            files.push({
              name: header.name,
              data: combined,
              type: header.type,
            });
          } else if (header.type === "directory") {
            files.push({
              name: header.name,
              data: new Uint8Array(0),
              type: header.type,
            });
          }
          next();
        });

        stream.resume();
      });

      // tar展開完了時の処理
      await new Promise<void>((resolve, reject) => {
        extract.on("finish", () => {
          console.log(
            `[npm.extractPackage] Tar extraction completed, found ${files.length} entries`,
          );
          resolve();
        });

        extract.on("error", (error: Error) => {
          console.error(`[npm.extractPackage] Tar extraction error:`, error);
          reject(error);
        });

        // decompressされたデータをtar-streamに送信
        extract.write(decompressedData);
        extract.end();
      });

      // 展開したファイル情報を格納するマップ
      const extractedFiles = new Map<
        string,
        { isDirectory: boolean; content?: string; fullPath: string }
      >();

      // ファイルをファイルシステムに書き込み & 情報を収集
      for (const file of files) {
        // パッケージ名のプレフィックスを削除 (例: "package/" -> "")
        let relativePath = file.name;
        if (relativePath.startsWith("package/")) {
          relativePath = relativePath.substring(8);
        }
        if (!relativePath) continue; // 空のパスはスキップ

        const fullPath = `${packageDir}/${relativePath}`;

        if (file.type === "directory") {
          // もし同名のファイルが存在していたら削除（存在しない場合は無視）
          try {
            const stat = await this.fs.promises.stat(fullPath);
            if (!stat.isDirectory()) {
              await this.fs.promises.unlink(fullPath);
            }
          } catch (err: any) {
            if (err && err.code !== "ENOENT") throw err;
          }

          // 親ディレクトリも必ず作成
          const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
          await ensureDirectoryExists(this.fs, dirPath);
          console.log(`[npm.extractPackage] Creating directory: ${fullPath}`);
          await this.fs.promises.mkdir(fullPath, { recursive: true } as any);

          // ディレクトリ情報を追加
          extractedFiles.set(relativePath, {
            isDirectory: true,
            fullPath: fullPath,
          });
        } else if (file.type === "file") {
          // 親ディレクトリを必ず作成（mkdir -p 相当）
          const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
          await ensureDirectoryExists(this.fs, dirPath);

          // もし同名のディレクトリが存在していたら削除（存在しない場合は無視）
          try {
            const stat = await this.fs.promises.stat(fullPath);
            if (stat.isDirectory()) {
              // ディレクトリを再帰的に削除
              const removeDir = async (fs: any, dir: string) => {
                try {
                  const files = await fs.promises.readdir(dir);
                  for (const f of files) {
                    const p = `${dir}/${f}`;
                    const s = await fs.promises.stat(p);
                    if (s.isDirectory()) {
                      await removeDir(fs, p);
                    } else {
                      await fs.promises.unlink(p);
                    }
                  }
                  await fs.promises.rmdir(dir);
                } catch (err: any) {
                  if (err && err.code !== "ENOENT") throw err;
                }
              };
              await removeDir(this.fs, fullPath);
            }
          } catch (err: any) {
            if (err && err.code !== "ENOENT") throw err;
          }

          // ファイルを書き込み
          console.log(
            `[npm.extractPackage] Writing file: ${fullPath} (${file.data.length} bytes)`,
          );
          await this.fs.promises.writeFile(fullPath, file.data);

          // ファイル情報を追加（内容も含む）
          const content = new TextDecoder("utf-8", { fatal: false }).decode(
            file.data,
          );
          extractedFiles.set(relativePath, {
            isDirectory: false,
            content: content,
            fullPath: fullPath,
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
  // ディレクトリの再帰削除
  async removeDirectory(dirPath: string): Promise<void> {
    try {
      const files = await this.fs.promises.readdir(dirPath);
      for (const file of files) {
        const filePath = `${dirPath}/${file}`;
        const stat = await this.fs.promises.stat(filePath);
        if (stat.isDirectory()) {
          await this.removeDirectory(filePath);
        } else {
          await this.fs.promises.unlink(filePath);
        }
      }
      await this.fs.promises.rmdir(dirPath);
    } catch (error: any) {
      // ENOENT（存在しない）は無視、それ以外はエラー
      if (error && error.code !== "ENOENT") {
        console.error(`Failed to remove directory ${dirPath}:`, error);
        throw error;
      }
    }
  }


}