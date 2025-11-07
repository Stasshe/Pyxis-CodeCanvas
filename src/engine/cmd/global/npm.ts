/**
 * npm.ts - 新アーキテクチャ版NPMコマンド
 *
 * NEW ARCHITECTURE:
 * - IndexedDB (fileRepository) が単一の真実の情報源
 * - package.jsonなどの設定ファイルは IndexedDB に保存
 * - NpmInstallクラスが .gitignore を考慮して IndexedDB を更新
 * - fileRepository.createFile() を使用して自動的に管理
 */

import { NpmInstall } from './npmOperations/npmInstall';

import { fileRepository } from '@/engine/core/fileRepository';

export class NpmCommands {
  private currentDir: string;
  private projectName: string;
  private projectId: string;

  constructor(projectName: string, projectId: string, currentDir: string) {
    this.projectName = projectName;
    this.projectId = projectId;
    this.currentDir = currentDir;
  }

  async downloadAndInstallPackage(packageName: string, version: string = 'latest'): Promise<void> {
    const npmInstall = new NpmInstall(this.projectName, this.projectId);
    npmInstall.startBatchProcessing();
    try {
      await npmInstall.installWithDependencies(packageName, version);
    } finally {
      await npmInstall.finishBatchProcessing();
    }
  }

  async removeDirectory(dirPath: string): Promise<void> {
    const npmInstall = new NpmInstall(this.projectName, this.projectId, true);
    await npmInstall.removeDirectory(dirPath);
  }

  // npm install コマンドの実装
  async install(packageName?: string, flags: string[] = []): Promise<string> {
    try {
      // IndexedDBからpackage.jsonを単一取得（インデックス経由）
      const packageFile = await fileRepository.getFileByPath(this.projectId, '/package.json');
      let packageJson: any;
      if (packageFile) {
        packageJson = JSON.parse(packageFile.content);
      } else {
        // package.jsonが存在しない場合は作成
        packageJson = {
          name: this.projectName,
          version: '1.0.0',
          description: '',
          main: 'index.js',
          scripts: {
            test: 'echo "Error: no test specified" && exit 1',
          },
          keywords: [],
          author: '',
          license: 'ISC',
          dependencies: {},
          devDependencies: {},
        };
        await fileRepository.createFile(
          this.projectId,
          '/package.json',
          JSON.stringify(packageJson, null, 2),
          'file'
        );
      }

      if (!packageName) {
        // npm install（全依存関係のインストール）
        const allDependencies = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        const packageNames = Object.keys(allDependencies);

        if (packageNames.length === 0) {
          return 'up to date, audited 0 packages in 0.1s\n\nfound 0 vulnerabilities';
        }

        let output = `Installing ${packageNames.length} packages...\n`;
        let installedCount = 0;

        const npmInstall = new NpmInstall(this.projectName, this.projectId);
        npmInstall.startBatchProcessing();
        try {
          for (const pkg of packageNames) {
            const versionSpec = allDependencies[pkg];
            const version = versionSpec.replace(/[\^~]/, '');
            try {
              await npmInstall.installWithDependencies(pkg, version);
              installedCount++;
              output += `  ✓ ${pkg}@${version} (with dependencies)\n`;
            } catch (error) {
              output += `  ✗ ${pkg}@${version} - ${(error as Error).message}\n`;
            }
          }
        } finally {
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
        const isDev = flags.includes('--save-dev') || flags.includes('-D');

        // package.jsonに記載があるかチェック
        let isInPackageJson = false;
        if (
          (packageJson.dependencies && packageJson.dependencies[packageName]) ||
          (packageJson.devDependencies && packageJson.devDependencies[packageName])
        ) {
          isInPackageJson = true;
        }

        try {
          const packageInfo = await this.fetchPackageInfo(packageName);
          const version = packageInfo.version;

          if (!packageJson.dependencies) packageJson.dependencies = {};
          if (!packageJson.devDependencies) packageJson.devDependencies = {};

          if (isDev) {
            packageJson.devDependencies[packageName] = `^${version}`;
          } else {
            packageJson.dependencies[packageName] = `^${version}`;
          }

          await fileRepository.createFile(
            this.projectId,
            '/package.json',
            JSON.stringify(packageJson, null, 2),
            'file'
          );

          // 実際にnode_modulesにインストールされているかチェック（プレフィックス検索）
          const nodeFiles = await fileRepository.getFilesByPrefix(
            this.projectId,
            `/node_modules/${packageName}`
          );
          const isActuallyInstalled = nodeFiles.length > 0;

          if (isInPackageJson && isActuallyInstalled) {
            return `updated 1 package in ${Math.random() * 2 + 1}s\n\n~ ${packageName}@${version}\nupdated 1 package and audited 1 package in ${Math.random() * 0.5 + 0.5}s\n\nfound 0 vulnerabilities`;
          } else {
            const npmInstall = new NpmInstall(this.projectName, this.projectId);
            npmInstall.startBatchProcessing();
            try {
              await npmInstall.installWithDependencies(packageName, version);
            } finally {
              await npmInstall.finishBatchProcessing();
            }
            return `added packages with dependencies in ${Math.random() * 2 + 1}s\n\n+ ${packageName}@${version}\nadded packages and audited packages in ${Math.random() * 0.5 + 0.5}s\n\nfound 0 vulnerabilities`;
          }
        } catch (error) {
          throw new Error(`Failed to install ${packageName}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      throw new Error(`npm install failed: ${(error as Error).message}`);
    }
  }

  // npm uninstall コマンドの実装
  async uninstall(packageName: string): Promise<string> {
    try {
      // IndexedDBからpackage.jsonを単一取得（インデックス経由）
      const packageFile = await fileRepository.getFileByPath(this.projectId, '/package.json');
      if (!packageFile) {
        return `npm ERR! Cannot find package.json`;
      }
      const packageJson = JSON.parse(packageFile.content);

      if (!packageJson.dependencies) packageJson.dependencies = {};
      if (!packageJson.devDependencies) packageJson.devDependencies = {};

      let wasInDependencies = false;
      let wasInDevDependencies = false;
      if (packageJson.dependencies[packageName]) {
        wasInDependencies = true;
        delete packageJson.dependencies[packageName];
      }
      if (packageJson.devDependencies[packageName]) {
        wasInDevDependencies = true;
        delete packageJson.devDependencies[packageName];
      }

      if (!wasInDependencies && !wasInDevDependencies) {
        return `npm WARN ${packageName} is not a dependency of ${this.projectName}`;
      }

      await fileRepository.createFile(
        this.projectId,
        '/package.json',
        JSON.stringify(packageJson, null, 2),
        'file'
      );

      // 依存関係を含めてパッケージを削除
      const npmInstall = new NpmInstall(this.projectName, this.projectId, true);
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
        console.warn(
          `[npm.uninstall] Dependency analysis failed, removing only main package: ${(error as Error).message}`
        );
        // node_modules配下のIndexedDBファイルも念のため削除（プレフィックス検索）
        const packageFiles = await fileRepository.getFilesByPrefix(
          this.projectId,
          `/node_modules/${packageName}`
        );
        for (const file of packageFiles) {
          await fileRepository.deleteFile(file.id);
        }
        return `removed 1 package in 0.1s\n\n- ${packageName}\nremoved 1 package and audited 0 packages in 0.1s\n\nfound 0 vulnerabilities`;
      }
    } catch (error) {
      throw new Error(`npm uninstall failed: ${(error as Error).message}`);
    }
  }

  // npm list コマンドの実装
  async list(): Promise<string> {
    try {
      const packageFile = await fileRepository.getFileByPath(this.projectId, '/package.json');
      if (!packageFile) {
        return `npm ERR! Cannot find package.json`;
      }
      const packageJson = JSON.parse(packageFile.content);
      let output = `${this.projectName}@${packageJson.version} (IndexedDB)\n`;
      const dependencies = packageJson.dependencies || {};
      const devDependencies = packageJson.devDependencies || {};
      const depKeys = Object.keys(dependencies);
      const devDepKeys = Object.keys(devDependencies);
      if (depKeys.length === 0 && devDepKeys.length === 0) {
        output += '(empty)';
        return output;
      }
      depKeys.forEach((pkg, index) => {
        const isLast = index === depKeys.length - 1 && devDepKeys.length === 0;
        const connector = isLast ? '└── ' : '├── ';
        output += `${connector}${pkg}@${dependencies[pkg]}\n`;
      });
      devDepKeys.forEach((pkg, index) => {
        const isLast = index === devDepKeys.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        output += `${connector}${pkg}@${devDependencies[pkg]} (dev)\n`;
      });
      return output.trim();
    } catch (error) {
      throw new Error(`npm list failed: ${(error as Error).message}`);
    }
  }

  // npm init コマンドの実装
  async init(force = false): Promise<string> {
    try {
      const packageFile = await fileRepository.getFileByPath(this.projectId, '/package.json');
      if (packageFile && !force) {
        return `package.json already exists. Use 'npm init --force' to overwrite.`;
      }
      const packageJson = {
        name: this.projectName,
        version: '1.0.0',
        description: '',
        main: 'index.js',
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
        keywords: [],
        author: '',
        license: 'ISC',
        dependencies: {},
        devDependencies: {},
      };
      await fileRepository.createFile(
        this.projectId,
        '/package.json',
        JSON.stringify(packageJson, null, 2),
        'file'
      );
      return `Wrote to /package.json (IndexedDB):\n\n${JSON.stringify(packageJson, null, 2)}`;
    } catch (error) {
      throw new Error(`npm init failed: ${(error as Error).message}`);
    }
  }

  // npm run コマンドの実装
  async run(scriptName: string): Promise<string> {
    try {
      const packageFile = await fileRepository.getFileByPath(this.projectId, '/package.json');
      if (!packageFile) {
        return `npm ERR! Cannot find package.json`;
      }
      const packageJson = JSON.parse(packageFile.content);
      const scripts = packageJson.scripts || {};
      if (!scripts[scriptName]) {
        const availableScripts = Object.keys(scripts);
        let output = `npm ERR! script '${scriptName}' not found\n`;
        if (availableScripts.length > 0) {
          output += `\nAvailable scripts:\n`;
          availableScripts.forEach(script => {
            output += `  ${script}: ${scripts[script]}\n`;
          });
        }
        return output;
      }
      const command = scripts[scriptName];
      return `> ${this.projectName}@${packageJson.version} ${scriptName}\n> ${command}\n\n[Script execution simulated] ${command}\n\nScript '${scriptName}' completed successfully.`;
    } catch (error) {
      throw new Error(`npm run failed: ${(error as Error).message}`);
    }
  }

  // 実際のnpmレジストリからパッケージ情報を取得
  private async fetchPackageInfo(packageName: string): Promise<any> {
    try {
      console.log('fetching package info for:', packageName);
      // タイムアウト付きでfetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒タイムアウト

      const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

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
      if (!data.name || !data['dist-tags'] || !data['dist-tags'].latest) {
        throw new Error(`Invalid package data for '${packageName}'`);
      }

      const latestVersion = data['dist-tags'].latest;
      const versionData = data.versions[latestVersion];

      if (!versionData || !versionData.dist || !versionData.dist.tarball) {
        throw new Error(`No download URL found for '${packageName}@${latestVersion}'`);
      }

      // メインファイルパスを正規化
      let mainFile = versionData.main || 'index.js';
      console.log(`[npm.fetchPackageInfo] Original main file: "${mainFile}"`);

      // より厳密な正規化
      mainFile = mainFile.replace(/^\.+\/+/g, ''); // ./や../を削除
      mainFile = mainFile.replace(/\/+/g, '/'); // 連続するスラッシュを1つにまとめる
      mainFile = mainFile.replace(/^\/+/, ''); // 先頭のスラッシュを削除

      console.log(`[npm.fetchPackageInfo] Normalized main file: "${mainFile}"`);

      return {
        name: data.name,
        version: latestVersion,
        description: data.description || '',
        main: mainFile,
        license: data.license || versionData.license || 'Unknown',
        tarball: versionData.dist.tarball,
        dependencies: versionData.dependencies || {},
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout for package '${packageName}'`);
      }
      throw new Error(`Failed to fetch package info: ${(error as Error).message}`);
    }
  }

  // プロジェクトディレクトリからの相対パスを取得（現状未使用）
  private getRelativePathFromProject(fullPath: string): string {
    return fullPath;
  }
}
