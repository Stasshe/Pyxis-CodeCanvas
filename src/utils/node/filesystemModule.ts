import { getFileSystem } from '@/utils/filesystem';

  // fs モジュールのエミュレーション
export function createFSModule(projectDir: string, onFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>, unixCommands?: any) {
    const fs = getFileSystem();
    if (!fs) {
        throw new Error("ファイルシステムが初期化されていません");
    }
  
  const fsModule = {
    readFile: async (path: string, options?: any): Promise<string> => {
      try {
        // パスがプロジェクトルート相対の場合の処理
        let fullPath;
        if (path.startsWith('/')) {
          // 絶対パスの場合、プロジェクトディレクトリを基準とする
          fullPath = `${projectDir}${path}`;
        } else {
          // 相対パスの場合
          fullPath = `${projectDir}/${path}`;
        }
        
        console.log(`[fs.readFile] Attempting to read: ${path} -> ${fullPath}`);
        const content = await fs.promises.readFile(fullPath, { encoding: 'utf8' });
        return content as string;
      } catch (error) {
        console.error(`[fs.readFile] Failed to read ${path}:`, error);
        throw new Error(`ENOENT: ${path}`);
      }
    },
    writeFile: async (path: string, data: string, options?: any): Promise<void> => {
      try {
        let fullPath;
        let relativePath;
        if (path.startsWith('/')) {
          fullPath = `${projectDir}${path}`;
          relativePath = path;
        } else {
          fullPath = `${projectDir}/${path}`;
          relativePath = `/${path}`;
        }
        
        console.log(`[fs.writeFile] Writing to: ${path} -> ${fullPath}`);
        
        // 親ディレクトリが存在することを確認
        const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        if (parentDir && parentDir !== projectDir) {
          try {
            await fs.promises.stat(parentDir);
          } catch {
            await fs.promises.mkdir(parentDir, { recursive: true } as any);
          }
        }
        
        await fs.promises.writeFile(fullPath, data);
        
        // ファイルシステムのキャッシュをフラッシュ
        await flushFileSystemCache(fs);
        
        console.log(`[nodeRuntime.fs.writeFile] File written to filesystem: ${fullPath}, content length: ${data.length}`);
        
        // IndexedDBとの同期
        if (onFileOperation) {
          console.log(`[nodeRuntime.fs.writeFile] Calling onFileOperation with isNodeRuntime=true`);
          await onFileOperation(relativePath, 'file', data, true); // isNodeRuntime = true
          console.log(`[nodeRuntime.fs.writeFile] onFileOperation completed`);
        }
      } catch (error) {
        throw new Error(`Failed to write file '${path}': ${(error as Error).message}`);
      }
    },
    asyncWriteFile: async (path: string, data: string, options?: any): Promise<void> => {
      try {
        // パスがプロジェクトルート相対の場合の処理
        let fullPath;
        let relativePath;
        if (path.startsWith('/')) {
          fullPath = `${projectDir}${path}`;
          relativePath = path;
        } else {
          fullPath = `${projectDir}/${path}`;
          relativePath = `/${path}`;
        }
        const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        if (parentDir && parentDir !== projectDir) {
          try {
            await fs.promises.stat(parentDir);
          } catch {
            await fs.promises.mkdir(parentDir, { recursive: true } as any);
          }
        }
        await fs.promises.writeFile(fullPath, data);
        await flushFileSystemCache(fs);
        // IndexedDBとの同期
        if (onFileOperation) {
          console.log(`[asyncWriteFile] Calling onFileOperation with isNodeRuntime=true`);
          await onFileOperation(relativePath, 'file', data, true); // isNodeRuntime = true
          console.log(`[asyncWriteFile] onFileOperation completed`);
        }
      } catch (error) {
        throw new Error(`Failed to write file '${path}': ${(error as Error).message}`);
      }
    },
    readFileSync: (path: string, options?: any): string => {
      throw new Error('Synchronous file operations are not supported in browser environment. Use async versions.');
    },
    writeFileSync: (path: string, data: string, options?: any): void => {
      throw new Error('Synchronous file operations are not supported in browser environment. Use async versions.');
    },
    existsSync: async (path: string): Promise<boolean> => {
      try {
        let fullPath;
        if (path.startsWith('/')) {
          fullPath = `${projectDir}${path}`;
        } else {
          fullPath = `${projectDir}/${path}`;
        }
        
        await fs.promises.stat(fullPath);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path: string, options?: any): Promise<void> => {
      if (!unixCommands) throw new Error('Unix commands not available');
      
      const recursive = options?.recursive || false;
      await unixCommands.mkdir(path, recursive);
      // unixCommandsが内部でonFileOperationを呼び出すので追加の同期は不要
    },
    readdir: async (path: string, options?: any): Promise<string[]> => {
      try {
        const fullPath = path.startsWith('/') ? path : `${projectDir}/${path}`;
        const files = await fs.promises.readdir(fullPath);
        return files.filter((file: string) => file !== '.git' && !file.startsWith('.git'));
      } catch (error) {
        throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      }
    },
    unlink: async (path: string): Promise<void> => {
      if (!unixCommands) throw new Error('Unix commands not available');
      
      await unixCommands.rm(path);
      // unixCommandsが内部でonFileOperationを呼び出すので追加の同期は不要
    },
    appendFile: async (path: string, data: string, options?: any): Promise<void> => {
      try {
        // 既存のファイル内容を読み取り
        let existingContent = '';
        try {
          existingContent = await fsModule.readFile(path);
        } catch {
          // ファイルが存在しない場合は空として扱う
        }
        
        // 既存の内容に新しいデータを追加
        const newContent = existingContent + data;
        await fsModule.writeFile(path, newContent);
      } catch (error) {
        throw new Error(`Failed to append to file '${path}': ${(error as Error).message}`);
      }
    },
    stat: async (path: string): Promise<any> => {
      try {
        let fullPath;
        if (path.startsWith('/')) {
          fullPath = `${projectDir}${path}`;
        } else {
          fullPath = `${projectDir}/${path}`;
        }
        return await fs.promises.stat(fullPath);
      } catch (error) {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      }
    }
  };

  // fs.promisesプロパティを追加
  (fsModule as any).promises = fsModule;
  
  return fsModule;
}

// path モジュールのエミュレーション
export function createPathModule(projectDir: string) {
  return {
    join: (...paths: string[]): string => {
      return paths
        .filter(path => path)
        .join('/')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '') || '/';
    },
    resolve: (...paths: string[]): string => {
      let resolved = projectDir;
      for (const path of paths) {
        if (path.startsWith('/')) {
          resolved = path;
        } else {
          resolved = `${resolved}/${path}`;
        }
      }
      return resolved.replace(/\/+/g, '/');
    },
    dirname: (path: string): string => {
      const lastSlash = path.lastIndexOf('/');
      return lastSlash > 0 ? path.substring(0, lastSlash) : '/';
    },
    basename: (path: string, ext?: string): string => {
      const name = path.substring(path.lastIndexOf('/') + 1);
      return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
    },
    extname: (path: string): string => {
      const lastDot = path.lastIndexOf('.');
      const lastSlash = path.lastIndexOf('/');
      return (lastDot > lastSlash) ? path.substring(lastDot) : '';
    }
  };
}

// os モジュールのエミュレーション
export function createOSModule() {
  return {
    platform: () => 'browser',
    type: () => 'Browser',
    arch: () => 'x64',
    hostname: () => 'localhost',
    tmpdir: () => '/tmp',
    homedir: () => '/home/user',
    EOL: '\n'
  };
}

// util モジュールのエミュレーション
export function createUtilModule() {
  return {
    inspect: (obj: any, options?: any): string => {
      try {
        return JSON.stringify(obj, null, 2);
      } catch {
        return String(obj);
      }
    },
    format: (f: string, ...args: any[]): string => {
      let i = 0;
      return f.replace(/%[sdj%]/g, (x) => {
        if (x === '%%') return x;
        if (i >= args.length) return x;
        switch (x) {
          case '%s': return String(args[i++]);
          case '%d': return String(Number(args[i++]));
          case '%j':
            try {
              return JSON.stringify(args[i++]);
            } catch {
              return '[Circular]';
            }
          default:
            return x;
        }
      });
    },
    promisify: (fn: Function): Function => {
      return (...args: any[]) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: any, result: any) => {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          });
        });
      };
    }
  };
}

// ファイルシステムのキャッシュをフラッシュしてGitに変更を認識させる
export async function flushFileSystemCache(fs: any): Promise<void> {
  try {
    // Lightning-FSのキャッシュをフラッシュ（バックエンドストレージと同期）
    if (fs && fs.sync) {
      await fs.sync();
    }
    
    // ファイルシステムの強制同期のため短縮した遅延
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    console.warn('[nodeRuntime] Failed to flush filesystem cache:', error);
  }
}