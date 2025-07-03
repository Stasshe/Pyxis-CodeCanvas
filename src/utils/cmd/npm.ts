import { getFileSystem, getProjectDir } from '../filesystem';
import FS from '@isomorphic-git/lightning-fs';

export class NpmCommands {
  private fs: FS;
  private currentDir: string;
  private projectName: string;
  private onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;

  constructor(projectName: string, currentDir: string, onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>) {
    this.fs = getFileSystem()!;
    this.projectName = projectName;
    this.currentDir = currentDir;
    this.onFileOperation = onFileOperation;
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
        const packageJsonContent = await this.fs.promises.readFile(packageJsonPath, { encoding: 'utf8' });
        packageJson = JSON.parse(packageJsonContent as string);
      } catch {
        // package.jsonが存在しない場合は作成
        packageJson = {
          name: this.projectName,
          version: "1.0.0",
          description: "",
          main: "index.js",
          scripts: {
            test: "echo \"Error: no test specified\" && exit 1"
          },
          keywords: [],
          author: "",
          license: "ISC",
          dependencies: {},
          devDependencies: {}
        };
        await this.fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        
        // package.jsonをIndexedDBに同期
        if (this.onFileOperation) {
          await this.onFileOperation('/package.json', 'file', JSON.stringify(packageJson, null, 2));
        }
      }

      // node_modulesディレクトリの作成
      try {
        await this.fs.promises.stat(nodeModulesDir);
      } catch {
        await this.fs.promises.mkdir(nodeModulesDir, { recursive: true } as any);
        
        // node_modulesをIndexedDBに同期
        if (this.onFileOperation) {
          await this.onFileOperation('/node_modules', 'folder');
        }
      }

      if (!packageName) {
        // npm install（全依存関係のインストール）
        const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        const packageNames = Object.keys(allDependencies);
        
        if (packageNames.length === 0) {
          return 'up to date, audited 0 packages in 0.1s\n\nfound 0 vulnerabilities';
        }

        let output = `added ${packageNames.length} packages in 0.1s\n\n`;
        output += `Installing packages:\n`;
        
        for (const pkg of packageNames) {
          const version = allDependencies[pkg];
          output += `  ${pkg}@${version}\n`;
          
          // パッケージディレクトリを作成
          const packageDir = `${nodeModulesDir}/${pkg}`;
          await this.createMockPackage(packageDir, pkg, version);
        }

        output += `\nfound 0 vulnerabilities`;
        return output;
      } else {
        // 特定パッケージのインストール
        const isDev = flags.includes('--save-dev') || flags.includes('-D');
        const version = await this.getLatestVersion(packageName);
        
        // package.jsonに依存関係を追加
        if (isDev) {
          packageJson.devDependencies[packageName] = version;
        } else {
          packageJson.dependencies[packageName] = version;
        }

        // package.jsonを更新
        await this.fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        
        // package.jsonをIndexedDBに同期
        if (this.onFileOperation) {
          await this.onFileOperation('/package.json', 'file', JSON.stringify(packageJson, null, 2));
        }

        // パッケージディレクトリを作成
        const packageDir = `${nodeModulesDir}/${packageName}`;
        await this.createMockPackage(packageDir, packageName, version);

        const depType = isDev ? 'devDependencies' : 'dependencies';
        return `added 1 package in 0.1s\n\n+ ${packageName}@${version}\nadded 1 package from 1 contributor and audited 1 package in 0.1s\n\nfound 0 vulnerabilities`;
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

      // package.jsonから依存関係を削除
      try {
        const packageJsonContent = await this.fs.promises.readFile(packageJsonPath, { encoding: 'utf8' });
        const packageJson = JSON.parse(packageJsonContent as string);
        
        const wasInDependencies = delete packageJson.dependencies[packageName];
        const wasInDevDependencies = delete packageJson.devDependencies[packageName];
        
        if (!wasInDependencies && !wasInDevDependencies) {
          return `npm WARN ${packageName} is not a dependency of ${this.projectName}`;
        }

        await this.fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        
        // package.jsonをIndexedDBに同期
        if (this.onFileOperation) {
          await this.onFileOperation('/package.json', 'file', JSON.stringify(packageJson, null, 2));
        }
      } catch {
        return `npm ERR! Cannot find package.json`;
      }

      // node_modulesからパッケージを削除
      try {
        await this.removeDirectory(packageDir);
        
        // IndexedDBからも削除
        if (this.onFileOperation) {
          await this.onFileOperation(`/node_modules/${packageName}`, 'delete');
        }
        
        return `removed 1 package in 0.1s\n\n- ${packageName}\nremoved 1 package and audited 0 packages in 0.1s\n\nfound 0 vulnerabilities`;
      } catch {
        return `npm WARN ${packageName} package not found in node_modules`;
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
        const packageJsonContent = await this.fs.promises.readFile(packageJsonPath, { encoding: 'utf8' });
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
          test: "echo \"Error: no test specified\" && exit 1"
        },
        keywords: [],
        author: "",
        license: "ISC",
        dependencies: {},
        devDependencies: {}
      };

      await this.fs.promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
      
      // package.jsonをIndexedDBに同期
      if (this.onFileOperation) {
        await this.onFileOperation('/package.json', 'file', JSON.stringify(packageJson, null, 2));
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
        const packageJsonContent = await this.fs.promises.readFile(packageJsonPath, { encoding: 'utf8' });
        const packageJson = JSON.parse(packageJsonContent as string);
        
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
      } catch {
        return `npm ERR! Cannot find package.json`;
      }
    } catch (error) {
      throw new Error(`npm run failed: ${(error as Error).message}`);
    }
  }

  // モックパッケージの作成
  private async createMockPackage(packageDir: string, packageName: string, version: string): Promise<void> {
    try {
      await this.fs.promises.mkdir(packageDir, { recursive: true } as any);
      
      // package.jsonの作成
      const mockPackageJson = {
        name: packageName,
        version: version,
        description: `Mock package for ${packageName}`,
        main: "index.js",
        license: "MIT"
      };
      
      const packageJsonPath = `${packageDir}/package.json`;
      await this.fs.promises.writeFile(packageJsonPath, JSON.stringify(mockPackageJson, null, 2));
      
      // index.jsの作成
      const indexJsPath = `${packageDir}/index.js`;
      const mockIndexJs = `// Mock implementation of ${packageName}@${version}
module.exports = {
  name: '${packageName}',
  version: '${version}',
  mock: true,
  // Add your custom implementation here
};
`;
      await this.fs.promises.writeFile(indexJsPath, mockIndexJs);
      
      // IndexedDBに同期
      if (this.onFileOperation) {
        const relativePath = `/node_modules/${packageName}`;
        await this.onFileOperation(relativePath, 'folder');
        await this.onFileOperation(`${relativePath}/package.json`, 'file', JSON.stringify(mockPackageJson, null, 2));
        await this.onFileOperation(`${relativePath}/index.js`, 'file', mockIndexJs);
      }
    } catch (error) {
      console.error(`Failed to create mock package ${packageName}:`, error);
    }
  }

  // 最新バージョンの取得（モック）
  private async getLatestVersion(packageName: string): Promise<string> {
    // 実際のnpmレジストリからは取得せず、モックバージョンを返す
    const mockVersions: { [key: string]: string } = {
      'react': '^18.2.0',
      'react-dom': '^18.2.0',
      'next': '^14.0.0',
      'typescript': '^5.0.0',
      'lodash': '^4.17.21',
      'express': '^4.18.0',
      'axios': '^1.6.0',
      'moment': '^2.29.0',
      'uuid': '^9.0.0',
      'chalk': '^5.3.0',
      'commander': '^11.0.0',
      'inquirer': '^9.2.0'
    };
    
    return mockVersions[packageName] || '^1.0.0';
  }

  // ディレクトリの再帰削除
  private async removeDirectory(dirPath: string): Promise<void> {
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
    } catch (error) {
      console.error(`Failed to remove directory ${dirPath}:`, error);
      throw error;
    }
  }

  // プロジェクトディレクトリからの相対パスを取得
  private getRelativePathFromProject(fullPath: string): string {
    const projectBase = `/projects/${this.projectName}`;
    return fullPath.replace(projectBase, '') || '/';
  }
}
