import FS from '@isomorphic-git/lightning-fs';

/**
 * Git操作で使用する共通のファイルシステムヘルパー関数
 */
export class GitFileSystemHelper {
  /**
   * ディレクトリ内のすべてのファイルを再帰的に取得
   * @param fs ファイルシステムインスタンス
   * @param dirPath 検索対象のディレクトリパス
   * @returns ファイルパスの配列（プロジェクトルートからの相対パス）
   */
  static async getAllFiles(fs: FS, dirPath: string): Promise<string[]> {
    const files: string[] = [];
    
    const traverse = async (currentPath: string, relativePath: string = '') => {
      try {
        // ファイルシステムの同期を確実にする
        if ((fs as any).sync) {
          try {
            await (fs as any).sync();
            // 同期後の追加待機
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (syncError) {
            console.warn(`[getAllFiles] Sync failed for ${currentPath}:`, syncError);
          }
        }
        
        const entries = await fs.promises.readdir(currentPath);
        console.log(`[getAllFiles] Reading directory ${currentPath}, found:`, entries);
        
        for (const entry of entries) {
          // .gitディレクトリは除外
          if (entry === '.git') continue;
          
          const fullPath = `${currentPath}/${entry}`;
          const relativeFilePath = relativePath ? `${relativePath}/${entry}` : entry;
          
          try {
            const stat = await fs.promises.stat(fullPath);
            console.log(`[getAllFiles] Stat for ${fullPath}:`, { 
              isFile: stat.isFile(), 
              isDirectory: stat.isDirectory(), 
              size: stat.size 
            });
            
            if (stat.isDirectory()) {
              await traverse(fullPath, relativeFilePath);
            } else if (stat.isFile()) {
              files.push(relativeFilePath);
              console.log(`[getAllFiles] Found file: ${relativeFilePath} (size: ${stat.size})`);
            }
          } catch (error) {
            console.warn(`[getAllFiles] Failed to stat ${fullPath}:`, error);
          }
        }
      } catch (error) {
        console.warn(`[getAllFiles] Failed to read directory ${currentPath}:`, error);
      }
    };
    
    await traverse(dirPath);
    console.log(`[getAllFiles] Total files found: ${files.length}`, files);
    return files;
  }

  /**
   * パターンにマッチするファイルを取得
   * @param fs ファイルシステムインスタンス
   * @param dirPath 検索対象のディレクトリパス
   * @param pattern マッチパターン
   * @returns マッチしたファイルパスの配列
   */
  static async getMatchingFiles(fs: FS, dirPath: string, pattern: string): Promise<string[]> {
    const allFiles = await this.getAllFiles(fs, dirPath);
    
    if (pattern === '*') {
      return allFiles;
    }
    
    // シンプルなグロブパターンマッチング
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    return allFiles.filter(file => regex.test(file));
  }

  /**
   * プロジェクトディレクトリからの相対パスを取得
   * @param fullPath 完全パス
   * @param projectDir プロジェクトディレクトリパス
   * @returns 相対パス
   */
  static getRelativePathFromProject(fullPath: string, projectDir: string): string {
    if (fullPath.startsWith(projectDir)) {
      const relativePath = fullPath.replace(projectDir, '');
      return relativePath.startsWith('/') ? relativePath : '/' + relativePath;
    }
    return fullPath;
  }

  /**
   * ディレクトリが存在することを確認し、なければ作成
   * @param fs ファイルシステムインスタンス
   * @param dirPath ディレクトリパス
   */
  static async ensureDirectory(fs: FS, dirPath: string): Promise<void> {
    try {
      await fs.promises.stat(dirPath);
    } catch {
      // ディレクトリが存在しない場合は作成
      await fs.promises.mkdir(dirPath, { recursive: true } as any);
    }
  }
}
