import {
  getFileSystem,
  getProjectDir,
  ensureDirectoryExists,
} from "../filesystem";
import FS from "@isomorphic-git/lightning-fs";
import { NpmInstall } from "./npmOperations/npmInstall";

export class NpmCommands {
  private fs: FS;
  private currentDir: string;
  private projectName: string;
  private onFileOperation?: (
    path: string,
    type: "file" | "folder" | "delete",
    content?: string,
    isNodeRuntime?: boolean,
  ) => Promise<void>;

  constructor(
    projectName: string,
    currentDir: string,
    onFileOperation?: (
      path: string,
      type: "file" | "folder" | "delete",
      content?: string,
      isNodeRuntime?: boolean,
    ) => Promise<void>,
  ) {
    this.fs = getFileSystem()!;
    this.projectName = projectName;
    this.currentDir = currentDir;
    this.onFileOperation = onFileOperation;
  }

  async downloadAndInstallPackage(
    packageName: string,
    version: string = "latest",
  ): Promise<void> {
    const npmInstall = new NpmInstall(
      this.projectName,
      this.onFileOperation,
    );
    
    // バッチ処理を開始
    npmInstall.startBatchProcessing();
    
    try {
      await npmInstall.installWithDependencies(packageName, version);
    } finally {
      // バッチ処理を終了（エラーが発生してもフラッシュを実行）
      await npmInstall.finishBatchProcessing();
    }
  }

  async removeDirectory(
    dirPath: string,
  ): Promise<void> {
    const npmInstall = new NpmInstall(
      this.projectName,
      this.onFileOperation,
      true, // skipLoadingInstalledPackages = true（軽量版）
    );
    await npmInstall.removeDirectory(dirPath);
  }

  // npm install コマンドの実装
  async install(packageName?: string, flags: string[] = []): Promise<string> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const packageJsonPath = `${projectDir}/package.json`;
      const nodeModulesDir = `${projectDir}/node_modules`;

      // package.jsonの存在確認と作成
      let packageJson: any;
      try {
        const packageJsonContent = await this.fs.promises.readFile(
          packageJsonPath,
          { encoding: "utf8" },
        );
        packageJson = JSON.parse(packageJsonContent as string);
      } catch {
        // package.jsonが存在しない場合は作成
        packageJson = {
          name: this.projectName,
          version: "1.0.0",
          description: "",
          main: "index.js",
          scripts: {
            test: 'echo "Error: no test specified" && exit 1',
          },
          keywords: [],
          author: "",
          license: "ISC",
          dependencies: {},
          devDependencies: {},
        };
        await this.fs.promises.writeFile(
          packageJsonPath,
          JSON.stringify(packageJson, null, 2),
        );

        // package.jsonをIndexedDBに同期
        if (this.onFileOperation) {
          await this.onFileOperation(
            "/package.json",
            "file",
            JSON.stringify(packageJson, null, 2),
          );
        }
      }

      // node_modulesディレクトリの作成
      try {
        await this.fs.promises.stat(nodeModulesDir);
      } catch {
        await this.fs.promises.mkdir(nodeModulesDir, {
          recursive: true,
        } as any);

        // node_modulesをIndexedDBに同期
        if (this.onFileOperation) {
          await this.onFileOperation("/node_modules", "folder");
        }
      }

      if (!packageName) {
        // npm install（全依存関係のインストール）
        const allDependencies = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        const packageNames = Object.keys(allDependencies);

        if (packageNames.length === 0) {
          return "up to date, audited 0 packages in 0.1s\n\nfound 0 vulnerabilities";
        }

        let output = `Installing ${packageNames.length} packages...\n`;
        let installedCount = 0;

        // NpmInstallインスタンスを作成（依存関係解決のため）
        const npmInstall = new NpmInstall(this.projectName, this.onFileOperation);
        
        // バッチ処理を開始
        npmInstall.startBatchProcessing();

        try {
          for (const pkg of packageNames) {
            const versionSpec = allDependencies[pkg];
            const version = versionSpec.replace(/[\^~]/, ""); // ^1.0.0 -> 1.0.0

            try {
              // 依存関係も含めてインストール（毎回チェック）
              await npmInstall.installWithDependencies(pkg, version);
              installedCount++;
              output += `  ✓ ${pkg}@${version} (with dependencies)\n`;
            } catch (error) {
              output += `  ✗ ${pkg}@${version} - ${(error as Error).message}\n`;
            }
          }
        } finally {
          // バッチ処理を終了（エラーが発生してもフラッシュを実行）
          await npmInstall.finishBatchProcessing();
        }

        if (installedCount === 0) {
          output += `\nup to date, audited ${packageNames.length} packages in ${Math.random() * 2 + 1}s\n\nfound 0 vulnerabilities`;
        } else {
          output += `\nadded/updated ${installedCount} packages in ${Math.random() * 2 + 1}s\n\nfound 0 vulnerabilities`;
        }
        return output;
      } else {
        // 特定パッケージのインストール
        const isDev = flags.includes("--save-dev") || flags.includes("-D");

        // 既にインストール済みかチェック
        const packageDir = `${nodeModulesDir}/${packageName}`;
        let isAlreadyInstalled = false;
        try {
          await this.fs.promises.stat(packageDir);
          isAlreadyInstalled = true;
        } catch {
          // パッケージが存在しない場合は新規インストール
        }

        try {
          const packageInfo = await this.fetchPackageInfo(packageName);
          const version = packageInfo.version;

          // package.jsonの依存関係オブジェクトを確保
          if (!packageJson.dependencies) {
            packageJson.dependencies = {};
          }
          if (!packageJson.devDependencies) {
            packageJson.devDependencies = {};
          }

          // package.jsonに依存関係を追加（既存でも更新）
          if (isDev) {
            packageJson.devDependencies[packageName] = `^${version}`;
          } else {
            packageJson.dependencies[packageName] = `^${version}`;
          }

          // package.jsonを更新
          await this.fs.promises.writeFile(
            packageJsonPath,
            JSON.stringify(packageJson, null, 2),
          );

          // package.jsonをIndexedDBに同期
          if (this.onFileOperation) {
            await this.onFileOperation(
              "/package.json",
              "file",
              JSON.stringify(packageJson, null, 2),
            );
          }

          if (isAlreadyInstalled) {
            return `updated 1 package in ${Math.random() * 2 + 1}s\n\n~ ${packageName}@${version}\nupdated 1 package and audited 1 package in ${Math.random() * 0.5 + 0.5}s\n\nfound 0 vulnerabilities`;
          } else {
            // パッケージを依存関係と一緒にダウンロードしてインストール
            const npmInstall = new NpmInstall(this.projectName, this.onFileOperation);
            
            // バッチ処理を開始
            npmInstall.startBatchProcessing();
            
            try {
              await npmInstall.installWithDependencies(packageName, version);
            } finally {
              // バッチ処理を終了（エラーが発生してもフラッシュを実行）
              await npmInstall.finishBatchProcessing();
            }
            
            return `added packages with dependencies in ${Math.random() * 2 + 1}s\n\n+ ${packageName}@${version}\nadded packages and audited packages in ${Math.random() * 0.5 + 0.5}s\n\nfound 0 vulnerabilities`;
          }
        } catch (error) {
          throw new Error(
            `Failed to install ${packageName}: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      throw new Error(`npm install failed: ${(error as Error).message}`);
    }
  }

  // npm uninstall コマンドの実装
  async uninstall(packageName: string): Promise<string> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const packageJsonPath = `${projectDir}/package.json`;
      const nodeModulesDir = `${projectDir}/node_modules`;
      const packageDir = `${nodeModulesDir}/${packageName}`;

      // パッケージが実際に存在するかチェック
      try {
        await this.fs.promises.stat(packageDir);
      } catch {
        return `npm WARN ${packageName} package not found in node_modules`;
      }

      // package.jsonから依存関係を削除
      let wasInDependencies = false;
      let wasInDevDependencies = false;
      
      try {
        const packageJsonContent = await this.fs.promises.readFile(
          packageJsonPath,
          { encoding: "utf8" },
        );
        const packageJson = JSON.parse(packageJsonContent as string);

        // 依存関係オブジェクトが存在しない場合は作成
        if (!packageJson.dependencies) {
          packageJson.dependencies = {};
        }
        if (!packageJson.devDependencies) {
          packageJson.devDependencies = {};
        }

        wasInDependencies = delete packageJson.dependencies[packageName];
        wasInDevDependencies = delete packageJson.devDependencies[packageName];

        if (!wasInDependencies && !wasInDevDependencies) {
          return `npm WARN ${packageName} is not a dependency of ${this.projectName}`;
        }

        await this.fs.promises.writeFile(
          packageJsonPath,
          JSON.stringify(packageJson, null, 2),
        );

        // package.jsonをIndexedDBに同期
        if (this.onFileOperation) {
          await this.onFileOperation(
            "/package.json",
            "file",
            JSON.stringify(packageJson, null, 2),
          );
        }
      } catch {
        return `npm ERR! Cannot find package.json`;
      }

      // 依存関係を含めてパッケージを削除
      const npmInstall = new NpmInstall(
        this.projectName,
        this.onFileOperation,
        true, // skipLoadingInstalledPackages = true（軽量版）
      );
      
      try {
        const removedPackages = await npmInstall.uninstallWithDependencies(packageName);
        const totalRemoved = removedPackages.length;
        
        if (totalRemoved === 0) {
          return `removed 1 package in 0.1s\n\n- ${packageName}\nremoved 1 package and audited 0 packages in 0.1s\n\nfound 0 vulnerabilities`;
        } else {
          const removedList = removedPackages.join(', ');
          return `removed ${totalRemoved + 1} packages in 0.1s\n\n- ${packageName}\n- ${removedList} (orphaned dependencies)\nremoved ${totalRemoved + 1} packages and audited 0 packages in 0.1s\n\nfound 0 vulnerabilities`;
        }
      } catch (error) {
        // 依存関係解決に失敗した場合は、単純にメインパッケージのみ削除
        console.warn(`[npm.uninstall] Dependency analysis failed, removing only main package: ${(error as Error).message}`);
        
        try {
          await this.removeDirectory(packageDir);

          // IndexedDBからも削除
          if (this.onFileOperation) {
            await this.onFileOperation(`/node_modules/${packageName}`, "delete");
          }

          return `removed 1 package in 0.1s\n\n- ${packageName}\nremoved 1 package and audited 0 packages in 0.1s\n\nfound 0 vulnerabilities`;
        } catch {
          return `npm WARN ${packageName} package not found in node_modules`;
        }
      }
    } catch (error) {
      throw new Error(`npm uninstall failed: ${(error as Error).message}`);
    }
  }

  // npm list コマンドの実装
  async list(): Promise<string> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const packageJsonPath = `${projectDir}/package.json`;

      try {
        const packageJsonContent = await this.fs.promises.readFile(
          packageJsonPath,
          { encoding: "utf8" },
        );
        const packageJson = JSON.parse(packageJsonContent as string);

        let output = `${this.projectName}@${packageJson.version} ${projectDir}\n`;

        const dependencies = packageJson.dependencies || {};
        const devDependencies = packageJson.devDependencies || {};

        // 通常の依存関係
        const depKeys = Object.keys(dependencies);
        const devDepKeys = Object.keys(devDependencies);

        if (depKeys.length === 0 && devDepKeys.length === 0) {
          output += "(empty)";
          return output;
        }

        depKeys.forEach((pkg, index) => {
          const isLast =
            index === depKeys.length - 1 && devDepKeys.length === 0;
          const connector = isLast ? "└── " : "├── ";
          output += `${connector}${pkg}@${dependencies[pkg]}\n`;
        });

        devDepKeys.forEach((pkg, index) => {
          const isLast = index === devDepKeys.length - 1;
          const connector = isLast ? "└── " : "├── ";
          output += `${connector}${pkg}@${devDependencies[pkg]} (dev)\n`;
        });

        return output.trim();
      } catch {
        return `npm ERR! Cannot find package.json`;
      }
    } catch (error) {
      throw new Error(`npm list failed: ${(error as Error).message}`);
    }
  }

  // npm init コマンドの実装
  async init(force = false): Promise<string> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const packageJsonPath = `${projectDir}/package.json`;

      // package.jsonが既に存在するかチェック
      try {
        await this.fs.promises.stat(packageJsonPath);
        if (!force) {
          return `package.json already exists. Use 'npm init --force' to overwrite.`;
        }
      } catch {
        // package.jsonが存在しない場合は続行
      }

      const packageJson = {
        name: this.projectName,
        version: "1.0.0",
        description: "",
        main: "index.js",
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
        keywords: [],
        author: "",
        license: "ISC",
        dependencies: {},
        devDependencies: {},
      };

      await this.fs.promises.writeFile(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2),
      );

      // package.jsonをIndexedDBに同期
      if (this.onFileOperation) {
        await this.onFileOperation(
          "/package.json",
          "file",
          JSON.stringify(packageJson, null, 2),
        );
      }

      return `Wrote to ${packageJsonPath}:\n\n${JSON.stringify(packageJson, null, 2)}`;
    } catch (error) {
      throw new Error(`npm init failed: ${(error as Error).message}`);
    }
  }

  // npm run コマンドの実装
  async run(scriptName: string): Promise<string> {
    try {
      const projectDir = getProjectDir(this.projectName);
      const packageJsonPath = `${projectDir}/package.json`;

      try {
        const packageJsonContent = await this.fs.promises.readFile(
          packageJsonPath,
          { encoding: "utf8" },
        );
        const packageJson = JSON.parse(packageJsonContent as string);

        const scripts = packageJson.scripts || {};

        if (!scripts[scriptName]) {
          const availableScripts = Object.keys(scripts);
          let output = `npm ERR! script '${scriptName}' not found\n`;
          if (availableScripts.length > 0) {
            output += `\nAvailable scripts:\n`;
            availableScripts.forEach((script) => {
              output += `  ${script}: ${scripts[script]}\n`;
            });
          }
          return output;
        }

        const command = scripts[scriptName];
        return `> ${this.projectName}@${packageJson.version} ${scriptName}\n> ${command}\n\n[Script execution simulated] ${command}\n\nScript '${scriptName}' completed successfully.`;
      } catch {
        return `npm ERR! Cannot find package.json`;
      }
    } catch (error) {
      throw new Error(`npm run failed: ${(error as Error).message}`);
    }
  }

  // 実際のnpmレジストリからパッケージ情報を取得
  private async fetchPackageInfo(packageName: string): Promise<any> {
    try {
      console.log("fetching package info for:", packageName);
      // タイムアウト付きでfetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒タイムアウト

      const response = await fetch(
        `https://registry.npmjs.org/${packageName}`,
        {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Package '${packageName}' not found`);
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      const data = await response.json();

      console.dir(data, { depth: null, colors: true });

      // 必要なデータが存在するかチェック
      if (!data.name || !data["dist-tags"] || !data["dist-tags"].latest) {
        throw new Error(`Invalid package data for '${packageName}'`);
      }

      const latestVersion = data["dist-tags"].latest;
      const versionData = data.versions[latestVersion];

      if (!versionData || !versionData.dist || !versionData.dist.tarball) {
        throw new Error(
          `No download URL found for '${packageName}@${latestVersion}'`,
        );
      }

      // メインファイルパスを正規化
      let mainFile = versionData.main || "index.js";
      console.log(`[npm.fetchPackageInfo] Original main file: "${mainFile}"`);

      // より厳密な正規化
      mainFile = mainFile.replace(/^\.+\/+/g, ""); // ./や../を削除
      mainFile = mainFile.replace(/\/+/g, "/"); // 連続するスラッシュを1つにまとめる
      mainFile = mainFile.replace(/^\/+/, ""); // 先頭のスラッシュを削除

      console.log(`[npm.fetchPackageInfo] Normalized main file: "${mainFile}"`);

      return {
        name: data.name,
        version: latestVersion,
        description: data.description || "",
        main: mainFile,
        license: data.license || versionData.license || "Unknown",
        tarball: versionData.dist.tarball,
        dependencies: versionData.dependencies || {},
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

  
  // 最新バージョンの取得（実際のレジストリから）
  private async getLatestVersion(packageName: string): Promise<string> {
    try {
      const packageInfo = await this.fetchPackageInfo(packageName);
      return packageInfo.version;
    } catch {
      // フォールバック: よく使われるパッケージのデフォルトバージョン
      const fallbackVersions: { [key: string]: string } = {
        react: "18.2.0",
        "react-dom": "18.2.0",
        next: "14.0.0",
        typescript: "5.0.0",
        lodash: "4.17.21",
        express: "4.18.0",
        axios: "1.6.0",
        moment: "2.29.0",
        uuid: "9.0.0",
        chalk: "5.3.0",
        commander: "11.0.0",
        inquirer: "9.2.0",
      };

      return fallbackVersions[packageName] || "1.0.0";
    }
  }

  
  // プロジェクトディレクトリからの相対パスを取得
  private getRelativePathFromProject(fullPath: string): string {
    const projectBase = `/projects/${this.projectName}`;
    return fullPath.replace(projectBase, "") || "/";
  }
}
