import { getFileSystem, getProjectDir } from './filesystem';
import vm from 'vm-browserify';
import { UnixCommands } from './cmd/unix';
import { 
  createFSModule, 
  createPathModule, 
  createOSModule, 
  createUtilModule,
  flushFileSystemCache
} from './node/filesystemModule';
import { 
  transformESModules, 
  wrapCodeForExecution,
  wrapModuleCode
} from './node/esModuleTransformer';
import { loadFromCDN, evaluateModuleCode } from './node/cdnLoader';
import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';

// Node.js風のランタイム環境
export class NodeJSRuntime {
  private fs: any;
  private projectDir: string;
  private unixCommands: UnixCommands;
  private console: any;
  private onOutput?: (output: string, type: 'log' | 'error') => void;
  private onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;
  private moduleCache: Map<string, any> = new Map(); // モジュールキャッシュ
  private currentWorkingDirectory: string = '/'; // 現在の作業ディレクトリ

  constructor(
    projectName: string, 
    onOutput?: (output: string, type: 'log' | 'error') => void,
    onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>
  ) {
    this.fs = getFileSystem();
    this.projectDir = getProjectDir(projectName);
    this.unixCommands = new UnixCommands(projectName, onFileOperation);
    this.onOutput = onOutput;
    this.onFileOperation = onFileOperation;
    
    // console.logをオーバーライド
    this.console = {
      log: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        this.onOutput?.(output, 'log');
      },
      error: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        this.onOutput?.(output, 'error');
      },
      warn: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        this.onOutput?.(`⚠️ ${output}`, 'log');
      },
      info: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        this.onOutput?.(`ℹ️ ${output}`, 'log');
      }
    };
  }

  // Node.js風のコードを実行
  async executeNodeJS(code: string): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      // まず必要なモジュールを事前ロード（現在の作業ディレクトリから開始）
      await this.preloadModules(code, this.currentWorkingDirectory);
      
      // Node.js風のグローバル環境を構築
      const nodeGlobals = this.createNodeGlobals();
      
      // コードを実行可能な形に変換
      const wrappedCode = wrapCodeForExecution(code, nodeGlobals);
      
      // 実行
      const result = await this.executeInSandbox(wrappedCode, nodeGlobals);
      
      return { success: true, output: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.onOutput?.(errorMessage, 'error');
      return { success: false, error: errorMessage };
    }
  }

  // コード内のrequire/importを解析して事前ロード（再帰的に依存関係を解決）
  private async preloadModules(code: string, currentDir: string = '/'): Promise<void> {
    const moduleNames = new Set<string>();
    
    pushMsgOutPanel(`[preloadModules] Analyzing code for modules:'${code.substring(0, 100) + '...'}`,'info','npm');
    
    // require()文の検出
    const requireMatches = code.match(/require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g);
    if (requireMatches) {
      requireMatches.forEach(match => {
        const moduleName = match.match(/require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/)?.[1];
        if (moduleName && !this.isBuiltinModule(moduleName)) {
          console.log(`[preloadModules] Adding module to preload: ${moduleName}`);
          moduleNames.add(moduleName);
        }
      });
    }
    
    // import文の検出
    const importMatches = code.match(/from\s+['"`]([^'"`]+)['"`]/g);
    if (importMatches) {
      importMatches.forEach(match => {
        const moduleName = match.match(/from\s+['"`]([^'"`]+)['"`]/)?.[1];
        if (moduleName && !this.isBuiltinModule(moduleName)) {
          console.log(`[preloadModules] Adding module to preload: ${moduleName}`);
          moduleNames.add(moduleName);
        }
      });
    }
    
    console.log(`[preloadModules] Total modules to preload: ${Array.from(moduleNames)}`);
    
    // 検出されたモジュールを事前ロード（再帰的に依存関係もロード）
    for (const moduleName of moduleNames) {
      try {
        await this.preloadModuleRecursively(moduleName, currentDir);
        pushMsgOutPanel(`[preloadModules] Successfully preloaded: ${moduleName}`, 'info', 'npm');
      } catch (error) {
        pushMsgOutPanel(`[preloadModules] Failed to preload ${moduleName}: ${(error as Error).message}`, 'error', 'npm');
        // 事前ロードに失敗してもエラーにはしない
      }
    }

    pushMsgOutPanel(`[preloadModules] Preloading complete. Cache contents: ${Array.from(this.moduleCache.keys())}`,'info','npm');
  }

  // モジュールとその依存関係を再帰的に事前ロード
  private async preloadModuleRecursively(moduleName: string, contextDir: string = '/'): Promise<void> {
    // モジュールの解決キーを生成（コンテキストディレクトリを考慮）
    let resolvedModuleName = moduleName;
    let moduleKey = this.getModuleKey(moduleName, contextDir);

    // '#'で始まる場合はpackage.jsonのimportsフィールドを参照
    if (moduleName.startsWith('#')) {
      // contextDirから親ディレクトリを辿ってpackage.jsonを探す
      let searchDir = contextDir;
      let found = false;
      let pkgJsonPath = '';
      let pkgJsonFullPath = '';
      while (searchDir !== '' && searchDir !== '/' && !found) {
        pkgJsonPath = searchDir + '/package.json';
        if (!pkgJsonPath.startsWith('/')) pkgJsonPath = '/' + pkgJsonPath;
        pkgJsonFullPath = this.projectDir + pkgJsonPath;
        try {
          const stat = await this.fs.promises.stat(pkgJsonFullPath);
          if (stat) {
            found = true;
            break;
          }
        } catch (e) {
          // 見つからなければ親ディレクトリへ
          searchDir = searchDir.substring(0, searchDir.lastIndexOf('/'));
          if (searchDir === '') searchDir = '/';
        }
      }
      if (found) {
        try {
          const pkgContent = await this.fs.promises.readFile(pkgJsonFullPath, { encoding: 'utf8' });
          const pkgData = JSON.parse(pkgContent);
          if (pkgData.imports && pkgData.imports[moduleName]) {
            let importPath = pkgData.imports[moduleName];
            // importPathが"./"で始まる場合はpackage.jsonのディレクトリからの相対パス
            let pkgDir = pkgJsonPath.replace(/\/package\.json$/, '');
            if (importPath.startsWith('./')) {
              resolvedModuleName = pkgDir + '/' + importPath.substring(2);
            } else {
              resolvedModuleName = importPath;
            }
            moduleKey = this.getModuleKey(resolvedModuleName, contextDir);
            console.log(`[preloadModuleRecursively] '#'-import resolved: ${moduleName} -> ${resolvedModuleName}`);
          }
        } catch (e) {
          // JSON parse error等は無視
        }
      }
    }

    // すでにキャッシュにある場合はスキップ
    if (this.moduleCache.has(moduleKey)) {
      console.log(`[preloadModuleRecursively] Already cached: ${moduleKey}`);
      return;
    }

    console.log(`[preloadModuleRecursively] Loading module: ${resolvedModuleName} from context: ${contextDir}`);

    // 現在の作業ディレクトリを一時的に設定
    const oldCwd = this.currentWorkingDirectory;
    this.currentWorkingDirectory = contextDir;

    try {
      // 組み込みモジュールの場合
      if (this.isBuiltinModule(resolvedModuleName)) {
        const module = this.createBuiltinModule(resolvedModuleName);
        this.moduleCache.set(moduleKey, module);
        return;
      }

      // ファイルモジュールをロード
      const moduleObj = await this.loadFileModuleForPreload(resolvedModuleName);
      this.moduleCache.set(moduleKey, moduleObj);

      console.log(`[preloadModuleRecursively] Successfully loaded: ${moduleKey}`);

    } finally {
      // 作業ディレクトリを復元
      this.currentWorkingDirectory = oldCwd;
    }
  }
  
  // モジュールキーを生成（コンテキスト付き）
  private getModuleKey(moduleName: string, contextDir: string): string {
    // 絶対パスや相対パスの場合は、コンテキストディレクトリと結合
    if (moduleName.startsWith('./') || moduleName.startsWith('../') || moduleName.startsWith('/')) {
      let resolvedPath: string;
      if (moduleName.startsWith('/')) {
        resolvedPath = moduleName;
      } else {
        resolvedPath = this.resolvePath(contextDir, moduleName);
      }
      return resolvedPath;
    }
    // npm パッケージの場合はモジュール名をそのまま使用
    return moduleName;
  }
  
  // パスを解決するヘルパー
  private resolvePath(basePath: string, relativePath: string): string {
    // 相対パスを絶対パスに解決
    const parts = basePath.split('/').filter(p => p.length > 0);
    const relativeParts = relativePath.split('/');
    
    for (const part of relativeParts) {
      if (part === '.') {
        continue;
      } else if (part === '..') {
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    
    return '/' + parts.join('/');
  }

  // Node.js風のグローバル環境を作成
  private createNodeGlobals(): any {
    const self = this;

    return {
      console: this.console,
      process: {
        cwd: () => this.unixCommands.getRelativePath(),
        env: { NODE_ENV: 'development' },
        version: 'v18.0.0',
        platform: 'browser',
        argv: ['node', 'script.js']
      },
      require: (moduleName: string) => {
        const moduleKey = this.getModuleKey(moduleName, this.currentWorkingDirectory);
        if (this.moduleCache.has(moduleKey)) {
          console.log(`[require] Loading from cache: ${moduleKey}`);
          return this.moduleCache.get(moduleKey);
        }
        if (this.isBuiltinModule(moduleName)) {
          const module = this.createBuiltinModule(moduleName);
          this.moduleCache.set(moduleKey, module);
          return module;
        }
        console.error(`[require] Module '${moduleName}' (key: ${moduleKey}) not found in cache. Available modules:`, Array.from(this.moduleCache.keys()));
        throw new Error(`Module '${moduleName}' not found in cache. Make sure all dependencies are preloaded. Context: ${this.currentWorkingDirectory}`);
      },
      exports: new Proxy({}, {
        get: (target, prop) => {
          const moduleKey = this.getModuleKey(String(prop), this.currentWorkingDirectory);
          if (this.moduleCache.has(moduleKey)) {
            console.log(`[exports] Loading from cache: ${moduleKey}`);
            return this.moduleCache.get(moduleKey);
          }
          console.error(`[exports] Module '${String(prop)}' (key: ${moduleKey}) not found in cache. Available modules:`, Array.from(this.moduleCache.keys()));
          throw new Error(`Module '${String(prop)}' not found in cache. Make sure all dependencies are preloaded. Context: ${this.currentWorkingDirectory}`);
        }
      }),
      __filename: this.projectDir + '/script.js',
      __dirname: this.projectDir,
      module: {
        get exports() {
          return this._exports;
        },
        set exports(value) {
          this._exports = value;
          this.exports = value; // 修正: module 内で exports を同期
        },
        _exports: {},
      },
      Buffer: globalThis.Buffer || {
        from: (data: any) => new Uint8Array(typeof data === 'string' ? new TextEncoder().encode(data) : data),
        isBuffer: (obj: any) => obj instanceof Uint8Array
      },
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
      clearTimeout: globalThis.clearTimeout,
      clearInterval: globalThis.clearInterval
    };
  }

  // サンドボックス内でコードを実行
  private async executeInSandbox(wrappedCode: string, globals: any): Promise<string> {
    try {
      console.log('[NodeJS Runtime] Executing code (vm-browserify):', wrappedCode.substring(0, 200) + '...');
      // vm-browserifyのrunInNewContextでサンドボックス実行
      // wrappedCodeは関数定義 (async function(globals) {...}) なので、まず関数を生成
      const asyncFunction = vm.runInNewContext(wrappedCode, globals);
      if (typeof asyncFunction !== 'function') {
        throw new Error('Generated function is not executable');
      }
      // グローバル変数を渡して実行
      const result = await asyncFunction(globals);
      return result !== undefined ? String(result) : '';
    } catch (error) {
      console.error('[NodeJS Runtime] Execution error (vm-browserify):', error);
      throw new Error(`Execution error: ${(error as Error).message}`);
    }
  }

  // ファイルを実行
  async executeFile(filePath: string): Promise<{ success: boolean; output?: string; error?: string }> {
    try {
      // ファイルパスの正規化（プロジェクトルート相対）
      let fullPath;
      let relativePath;
      if (filePath.startsWith('/')) {
        // 絶対パスの場合、プロジェクトディレクトリを基準とする
        fullPath = `${this.projectDir}${filePath}`;
        relativePath = filePath;
      } else {
        // 相対パスの場合
        fullPath = `${this.projectDir}/${filePath}`;
        relativePath = `/${filePath}`;
      }
      
      // 実行時の作業ディレクトリを設定（ファイルがあるディレクトリ）
      const fileDir = relativePath.substring(0, relativePath.lastIndexOf('/')) || '/';
      const oldCwd = this.currentWorkingDirectory;
      this.currentWorkingDirectory = fileDir;
      
      console.log(`[executeFile] Reading file: ${filePath} -> ${fullPath}`);
      console.log(`[executeFile] Setting working directory to: ${fileDir}`);
      
      try {
        const code = await this.fs.promises.readFile(fullPath, { encoding: 'utf8' });
        
        this.onOutput?.(`Executing: ${filePath}`, 'log');
        const result = await this.executeNodeJS(code as string);
        
        return result;
      } finally {
        // 作業ディレクトリを元に戻す
        this.currentWorkingDirectory = oldCwd;
      }
    } catch (error) {
      const errorMessage = `Failed to execute file '${filePath}': ${(error as Error).message}`;
      console.error('[executeFile] Error:', error);
      this.onOutput?.(errorMessage, 'error');
      return { success: false, error: errorMessage };
    }
  }

  // 組み込みモジュールかチェック
  private isBuiltinModule(moduleName: string): boolean {
    const builtinModules = ['fs', 'path', 'os', 'util', 'crypto', 'http', 'url', 'querystring'];
    return builtinModules.includes(moduleName);
  }

  // 組み込みモジュールを作成
  private createBuiltinModule(moduleName: string): any {
    switch (moduleName) {
      case 'fs':
        return createFSModule(this.projectDir, this.onFileOperation, this.unixCommands);
      case 'path':
        return createPathModule(this.projectDir);
      case 'os':
        return createOSModule();
      case 'util':
        return createUtilModule();
      default:
        throw new Error(`Built-in module '${moduleName}' not implemented`);
    }
  }

  // 事前ロード用のファイルモジュールローダー（依存関係も再帰的にロード）
  private async loadFileModuleForPreload(moduleName: string): Promise<any> {
    const possiblePaths = this.resolveModulePath(moduleName);
    
    // console.log(`[loadFileModuleForPreload] Loading module: ${moduleName}`);
    // console.log(`[loadFileModuleForPreload] Project directory: ${this.projectDir}`);
    // console.log(`[loadFileModuleForPreload] Current working directory: ${this.currentWorkingDirectory}`);
    
    for (const filePath of possiblePaths) {
      try {
        console.log(`[loadFileModuleForPreload] Trying to load: ${filePath}`);
        
        let fullPath;
        if (filePath.startsWith('/')) {
          fullPath = `${this.projectDir}${filePath}`;
        } else {
          fullPath = `${this.projectDir}/${filePath}`;
        }

        console.log(`[loadFileModuleForPreload] Full path: ${fullPath}`);

        // ファイルの存在確認
        await this.fs.promises.stat(fullPath);
        console.log(`[loadFileModuleForPreload] File exists: ${fullPath}`);
        
        // ファイル内容を読み取り
        const content = await this.fs.promises.readFile(fullPath, { encoding: 'utf8' });
        console.log(`[loadFileModuleForPreload] File content read successfully, length: ${(content as string).length}`);
        
        // package.jsonの場合はmain/exportsを解釈して本体jsファイルをrequire
        if (filePath.endsWith('package.json')) {
          try {
            const packageData = JSON.parse(content as string);
            console.log(`[loadFileModuleForPreload] Loaded package.json: ${moduleName}`);
            // main/exportsフィールドを参照
            let entryFile = '';
            if (packageData.exports && typeof packageData.exports === 'object') {
              // exportsフィールドがオブジェクトの場合
              if (packageData.exports["."] && packageData.exports["."].import) {
                entryFile = packageData.exports["."].import;
              } else if (packageData.exports["."] && typeof packageData.exports["."] === 'string') {
                entryFile = packageData.exports["."];
              } else if (typeof packageData.exports === 'string') {
                entryFile = packageData.exports;
              }
            }
            if (!entryFile && packageData.main) {
              entryFile = packageData.main;
            }
            if (!entryFile) {
              entryFile = 'index.js';
            }
            // パスの正規化
            if (!entryFile.startsWith('.')) {
              entryFile = './' + entryFile;
            }
            // chalkなどはsource/index.jsのようなパス
            const packageDir = filePath.replace(/\/package\.json$/, '');
            const entryPath = packageDir + '/' + entryFile.replace(/^\.\//, '');
            console.log(`[loadFileModuleForPreload] Resolving entry file: ${entryPath}`);
            // entryPathをrequire
            try {
              return await this.loadFileModuleForPreload(entryPath);
            } catch (error) {
              throw new Error(`Failed to load entry file '${entryPath}': ${(error as Error).message}`);
            }
          } catch (error) {
            throw new Error(`Invalid JSON in package.json: ${(error as Error).message}`);
          }
        }
        
        // .jsonファイルの場合もJSONとして解析
        if (filePath.endsWith('.json')) {
          try {
            const jsonData = JSON.parse(content as string);
            //console.log(`[loadFileModuleForPreload] Loaded JSON file: ${moduleName}`);
            return jsonData;
          } catch (error) {
            throw new Error(`Invalid JSON in ${filePath}: ${(error as Error).message}`);
          }
        }
        
        // モジュール内の依存関係も事前に再帰的にロード
        const moduleDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
        console.log(`[loadFileModuleForPreload] Analyzing dependencies in module: ${filePath}, moduleDir: ${moduleDir}`);
        await this.preloadModules(content as string, moduleDir);
        
        // モジュールを実行して exports を取得
        const moduleExports = await this.executeModuleCode(content as string, filePath);
        
        console.log(`[loadFileModuleForPreload] Successfully loaded module: ${moduleName} from ${filePath}`);
        return moduleExports;
        
      } catch (error) {
        console.log(`[loadFileModuleForPreload] Failed to load ${filePath}: ${(error as Error).message}`);
        continue;
      }
    }
    
    // すべての候補パスを試行しても見つからない場合
    throw new Error(`Module file not found for '${moduleName}'. Tried paths: ${possiblePaths.join(', ')}`);
  }

  // モジュールパスを解決
  private resolveModulePath(moduleName: string): string[] {
    const paths: string[] = [];
    
    console.log(`[resolveModulePath] Resolving module: ${moduleName}`);
    console.log(`[resolveModulePath] Current working directory: ${this.currentWorkingDirectory}`);
    
    // 相対パス / 絶対パスの場合
    if (moduleName.startsWith('./') || moduleName.startsWith('../') || moduleName.startsWith('/')) {
      let basePath: string;
      
      if (moduleName.startsWith('/')) {
        basePath = moduleName;
      } else {
        // 相対パスの解決
        if (this.currentWorkingDirectory === '/') {
          basePath = moduleName.substring(2); // './file' → 'file'
        } else {
          basePath = this.currentWorkingDirectory + '/' + moduleName.substring(2);
        }
      }
      
      console.log(`[resolveModulePath] Resolved base path: ${basePath}`);
      
      // パスの正規化
      basePath = basePath.replace(/\/+/g, '/').replace(/\/$/, '');
      
      // 拡張子の候補
      paths.push(basePath);
      if (!basePath.includes('.') || basePath.endsWith('.js') === false) {
        if (!basePath.endsWith('.js')) {
          paths.push(basePath + '.js');
        }
        if (!basePath.endsWith('.json')) {
          paths.push(basePath + '.json');
        }
        // ディレクトリの場合のindex.js
        paths.push(basePath + '/index.js');
        paths.push(basePath + '/package.json');
      }
    } else {
      // node_modules風の解決（npm packages）
      paths.push(`/node_modules/${moduleName}`);
      paths.push(`/node_modules/${moduleName}.js`);
      paths.push(`/node_modules/${moduleName}/index.js`);
      paths.push(`/node_modules/${moduleName}/package.json`);
      
      // scoped packages対応 (@org/package)
      if (moduleName.includes('/')) {
        const parts = moduleName.split('/');
        if (parts.length === 2 && parts[0].startsWith('@')) {
          paths.push(`/node_modules/${moduleName}/index.js`);
          paths.push(`/node_modules/${moduleName}/package.json`);
        }
      }
      
      // プロジェクト内のファイルとしても検索
      paths.push(`/${moduleName}`);
      paths.push(`/${moduleName}.js`);
      paths.push(`/${moduleName}.json`);
    }
    
    console.log(`[resolveModulePath] Candidate paths:`, paths);
    return paths;
  }

  // モジュールコードを実行してexportsを取得
  private async executeModuleCode(code: string, filePath: string): Promise<any> {
    const moduleExports = {};
    const moduleObject = { exports: moduleExports };

    // モジュールのディレクトリコンテキストを設定
    const moduleDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';

    // モジュール用のグローバル環境を作成
    const moduleGlobals = {
      ...this.createNodeGlobals(),
      module: moduleObject,
      exports: moduleExports,
      __filename: filePath,
      __dirname: moduleDir,
      require: (reqModule: string) => {
        // モジュールのディレクトリコンテキストでモジュールキーを生成
        const moduleKey = this.getModuleKey(reqModule, moduleDir);

        console.log(`[executeModuleCode:require] Requiring: ${reqModule} from ${moduleDir}, key: ${moduleKey}`);

        // キャッシュから取得（事前ロード済み）
        if (this.moduleCache.has(moduleKey)) {
          console.log(`[executeModuleCode:require] Found in cache: ${moduleKey}`);
          return this.moduleCache.get(moduleKey);
        }

        // 組み込みモジュールの場合
        if (this.isBuiltinModule(reqModule)) {
          const module = this.createBuiltinModule(reqModule);
          this.moduleCache.set(moduleKey, module);
          return module;
        }

        // キャッシュにない場合はエラー
        console.error(`[executeModuleCode:require] Module '${reqModule}' (key: ${moduleKey}) not found in cache. Available modules:`, Array.from(this.moduleCache.keys()));
        throw new Error(`Module '${reqModule}' not found in cache. Context: ${moduleDir}. Make sure all dependencies are preloaded.`);
      }
    };

    try {
      // ES6 import/export を CommonJS require/module.exports に変換
      const transformedCode = transformESModules(code);
      // code.replace(
      //   /export\s+default\s+(.+);?$/gm,
      //   'module.exports = $1;'
      // );

      // モジュールコードをラップして実行
      const wrappedCode = wrapModuleCode(transformedCode, moduleGlobals);

      console.log(`[executeModuleCode] Executing module code for: ${filePath}`);
      console.log(`[executeModuleCode] Transformed code:`, transformedCode.substring(0, 200) + '...');
      await this.executeInSandbox(wrappedCode, moduleGlobals);

      console.log(`[executeModuleCode] Module execution completed.`);
      console.log(`[executeModuleCode] Module exports keys:`, Object.keys(moduleObject.exports));

      // module.exportsを返す（CommonJSの標準的な動作）
      return moduleObject.exports;

    } catch (error) {
      console.error(`[executeModuleCode] Error executing module ${filePath}:`, error);
      throw new Error(`Failed to execute module '${filePath}': ${(error as Error).message}`);
    }
  }
}
