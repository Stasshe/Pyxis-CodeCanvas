import { fileRepository } from '@/engine/core/fileRepository';
import {
  fsPathToAppPath,
  normalizeDotSegments,
  getProjectRoot as pathGetProjectRoot,
  isWithinProject as pathIsWithinProject,
  resolvePath as pathResolvePath,
  toAppPath,
} from '@/engine/core/pathResolver';
import type { ProjectFile } from '@/types';

/**
 * Unixコマンドのベースクラス
 * 共通のユーティリティメソッドと状態管理を提供
 *
 * パス形式:
 * - currentDir: FSPath形式（/projects/{projectName}/...）
 * - DB操作: AppPath形式（/src/hello.ts）
 */
export abstract class UnixCommandBase {
  protected currentDir: string;
  protected projectId: string;
  protected projectName: string;

  constructor(projectName: string, currentDir: string, projectId?: string) {
    this.projectName = projectName;
    this.currentDir = currentDir;
    this.projectId = projectId || '';

    if (!this.projectId) {
      console.warn('[UnixCommandBase] projectId is empty! DB operations will fail.');
    }
  }

  // NOTE: Caching disabled - direct DB reads are performed to ensure latest data is returned.
  // The methods keep their names for backward compatibility but do not store any cache.
  protected async cachedGetFile(relativePath: string): Promise<ProjectFile | undefined> {
    const file = await fileRepository.getFileByPath(this.projectId, relativePath);
    return file || undefined;
  }

  /**
   * インスタンス内キャッシュから prefix 検索結果を取得
   * prefix 例: '/src/' （先頭スラッシュを含むプロジェクト相対パス）
   */
  protected async cachedGetFilesByPrefix(prefix: string): Promise<ProjectFile[]> {
    return await fileRepository.getFilesByPrefix(this.projectId, prefix);
  }

  /**
   * キャッシュに単一ファイルを設定する（null を設定すると明示的に存在しないことを示す）
   * relativePath はプロジェクト相対パス（先頭スラッシュあり）
   */
  // No-op: caching removed. Method kept for compatibility.
  protected setCacheFile(relativePath: string, file: ProjectFile | null): void {
    return;
  }

  /**
   * キャッシュから単一ファイルエントリを削除する
   */
  // No-op: caching removed. Method kept for compatibility.
  protected deleteCacheFile(relativePath: string): void {
    return;
  }

  /**
   * prefix に一致するキャッシュ（prefix: と file:）を無効化する
   * prefix はプロジェクト相対パスで先頭スラッシュあり。例: '/' or '/src/'
   */
  // No-op: caching removed. Method kept for compatibility.
  protected invalidatePrefix(prefix: string): void {
    return;
  }

  /**
   * インスタンスキャッシュを全消去する（テスト用・デバッグ用）
   */
  // No-op: caching removed. Method kept for compatibility.
  protected clearCache(): void {
    return;
  }

  /**
   * 相対パスを絶対パス（FSPath形式）に変換
   */
  protected resolvePath(path: string): string {
    // 絶対パスの場合はそのまま返す
    if (path.startsWith('/')) {
      return path;
    }

    // '.' はカレントディレクトリを表す
    if (path === '.') {
      return this.currentDir;
    }

    // '..' で始まる場合や、パスに含まれる場合は結合してから正規化
    return `${this.currentDir}/${path}`;
  }

  /**
   * パスを正規化（..や.を解決、末尾スラッシュを除去）
   * pathResolverのnormalizeDotSegmentsを使用
   */
  protected normalizePath(path: string): string {
    return normalizeDotSegments(path);
  }

  /**
   * FSPath（/projects/...）からAppPath（/src/...）を取得
   * pathResolverのfsPathToAppPathを使用
   */
  protected getRelativePathFromProject(fullPath: string): string {
    return fsPathToAppPath(fullPath, this.projectName);
  }

  /**
   * プロジェクトルートディレクトリを取得（FSPath形式）
   * pathResolverのgetProjectRootを使用
   */
  protected getProjectRoot(): string {
    return pathGetProjectRoot(this.projectName);
  }

  /**
   * パスがプロジェクト内かチェック
   * pathResolverのisWithinProjectを使用
   */
  protected isWithinProject(path: string): boolean {
    return pathIsWithinProject(path, this.projectName);
  }

  /**
   * ワイルドカード展開（glob）
   * @param pattern - ワイルドカードを含むパターン
   * @param dirPath - 検索対象ディレクトリ（プロジェクトルートからの相対パス）
   * @returns マッチしたファイル/ディレクトリの相対パスリスト
   */
  protected async expandGlob(pattern: string, dirPath: string): Promise<string[]> {
    const regex = this.globToRegex(pattern);

    // dirPath配下のファイル/フォルダを取得（プレフィックス検索で絞る）
    const dirRelative = this.getRelativePathFromProject(dirPath);
    const prefix = dirRelative === '/' ? '' : `${dirRelative}/`;
    const files = await this.cachedGetFilesByPrefix(prefix);

    const childrenInDir = files.filter((f: ProjectFile) => {
      if (dirRelative === '/') {
        // ルートの場合、直下のみ
        return f.path.split('/').filter((p: string) => p).length === 1;
      } else {
        // 指定ディレクトリの直下のみ
        const relativePath = f.path.replace(prefix, '');
        return f.path.startsWith(prefix) && !relativePath.includes('/');
      }
    });

    return childrenInDir
      .map((f: ProjectFile) => f.path.split('/').pop() || '')
      .filter((name: string) => regex.test(name))
      .map((name: string) => `${dirPath}/${name}`);
  }

  /**
   * globパターンを正規表現に変換
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
  }

  /**
   * ワイルドカードを含むパスパターンを展開
   * @param pathPattern - ワイルドカードを含む可能性のあるパス
   * @returns マッチした全パスのリスト
   */
  protected async expandPathPattern(pathPattern: string): Promise<string[]> {
    // Step 1: 末尾スラッシュを削除（正規化前）
    let cleanPattern = pathPattern;
    if (cleanPattern.endsWith('/') && cleanPattern !== '/') {
      cleanPattern = cleanPattern.slice(0, -1);
    }

    // Step 2: カレントディレクトリ基準で解決
    const resolvedPath = this.resolvePath(cleanPattern);

    // ワイルドカードが含まれていない場合はそのまま返す
    if (!resolvedPath.includes('*') && !resolvedPath.includes('?')) {
      return [resolvedPath];
    }

    // Step 3: 正規化して絶対パスを得る
    const normalizedPath = this.normalizePath(resolvedPath);

    // Step 4: currentDirからの相対パスを計算
    // currentDirは絶対パス（例：/projects/projectName/src）
    // normalizedPathは絶対パス（例：/projects/projectName/src/*）
    let relativePattern = '';
    if (normalizedPath.startsWith(this.currentDir)) {
      // カレントディレクトリからの相対パス
      relativePattern = normalizedPath.substring(this.currentDir.length);
      if (relativePattern.startsWith('/')) {
        relativePattern = relativePattern.substring(1);
      }
    } else {
      // カレントディレクトリ外の絶対パス指定
      relativePattern = this.getRelativePathFromProject(normalizedPath);
      if (relativePattern.startsWith('/')) {
        relativePattern = relativePattern.substring(1);
      }
    }

    // Step 5: パスを分割
    const parts = relativePattern.split('/').filter(p => p);

    if (parts.length === 0) {
      return [normalizedPath];
    }

    const relativeResults: string[] = [];

    // expandPathRecursiveで処理
    // currentPathにはカレントディレクトリを渡す（プロジェクト相対パス）
    const currentDirRelative = this.getRelativePathFromProject(this.currentDir);
    await this.expandPathRecursive(parts, 0, currentDirRelative, relativeResults);

    // 重複を除去
    const uniqueResults = Array.from(new Set(relativeResults));

    // 相対パスを絶対パスに戻す
    const projectRoot = this.getProjectRoot();
    return uniqueResults.map(rel => {
      if (rel.startsWith('/')) {
        return `${projectRoot}${rel}`;
      }
      return `${projectRoot}/${rel}`;
    });
  }

  /**
   * パスパターンを再帰的に展開（相対パスベース）
   * @param parts - パスを分割した配列
   * @param index - 現在処理中のインデックス
   * @param currentPath - 現在のパス（プロジェクトルートからの相対パス、先頭の/なし）
   * @param results - 結果を格納する配列
   */
  private async expandPathRecursive(
    parts: string[],
    index: number,
    currentPath: string,
    results: string[]
  ): Promise<void> {
    if (index >= parts.length) {
      // 結果を格納（先頭に/を付ける）
      results.push(currentPath === '' ? '/' : `/${currentPath}`);
      return;
    }

    const part = parts[index];

    // ワイルドカードが含まれていない場合
    if (!part.includes('*') && !part.includes('?')) {
      const nextPath = currentPath === '' ? part : `${currentPath}/${part}`;
      await this.expandPathRecursive(parts, index + 1, nextPath, results);
      return;
    }

    // ワイルドカード展開（IndexedDBから取得）
    try {
      // currentPath直下のファイル/フォルダを取得（プレフィックス検索で絞る）
      const currentRelative = currentPath === '' ? '/' : `/${currentPath}`;
      const prefix = currentRelative === '/' ? '' : `${currentRelative}/`;
      const files: ProjectFile[] = await this.cachedGetFilesByPrefix(prefix);
      const childrenInDir = files.filter((f: ProjectFile) => {
        if (currentRelative === '/') {
          // ルート直下
          return f.path.split('/').filter((p: string) => p).length === 1;
        } else {
          // 指定ディレクトリ直下
          if (!f.path.startsWith(prefix)) return false;
          const relativePath = f.path.substring(prefix.length);
          return !relativePath.includes('/');
        }
      });

      // 特殊ケース: '**' は0個以上のディレクトリセグメントにマッチ
      if (part === '**') {
        // 0個マッチさせて次のパートへ進む
        await this.expandPathRecursive(parts, index + 1, currentPath, results);

        // 1個以上マッチするケース: currentPath直下のディレクトリを再帰的に辿る
        for (const child of childrenInDir) {
          const fileName = child.path.split('/').pop() || '';

          // child がディレクトリかどうかを判定
          const childIsDir =
            child.type === 'folder' || files.some(f => f.path.startsWith(child.path + '/'));
          if (!childIsDir) continue;

          const nextPath = currentPath === '' ? fileName : `${currentPath}/${fileName}`;
          // 同じパート（index）を維持して、さらに深い階層を消費できるようにする
          await this.expandPathRecursive(parts, index, nextPath, results);
        }
        return;
      }

      const regex = this.globToRegex(part);

      for (const file of childrenInDir) {
        const fileName = file.path.split('/').pop() || '';
        if (regex.test(fileName)) {
          const nextPath = currentPath === '' ? fileName : `${currentPath}/${fileName}`;
          await this.expandPathRecursive(parts, index + 1, nextPath, results);
        }
      }
    } catch (error) {
      // エラーが発生した場合は無視
      console.warn(`[expandPathRecursive] Error at path ${currentPath}:`, error);
    }
  }

  /**
   * IndexedDBからファイルを取得
   */
  protected async getFileFromDB(relativePath: string): Promise<ProjectFile | undefined> {
    const file = await this.cachedGetFile(relativePath);
    return file || undefined;
  }

  // /**
  //  * IndexedDBから全ファイルを取得
  //  */
  // protected async getAllFilesFromDB(): Promise<ProjectFile[]> {
  //   return await fileRepository.getProjectFiles(this.projectId);
  // }

  /**
   * ファイルの存在をチェック（IndexedDBベース）
   */
  protected async exists(path: string): Promise<boolean> {
    const relativePath = this.getRelativePathFromProject(path);

    // ルートディレクトリは常に存在する
    if (relativePath === '/' || relativePath === '') {
      return true;
    }

    const file = await this.getFileFromDB(relativePath);

    // ファイルが見つかった場合
    if (file !== undefined) {
      return true;
    }

    // ファイルが見つからない場合、子ファイルが存在するかチェック
    // （ディレクトリ自体がDBに登録されていない場合でも、子ファイルがあれば存在する）
    const parentPath = relativePath.endsWith('/') ? relativePath : relativePath + '/';
    const files = await this.cachedGetFilesByPrefix(parentPath);
    const hasChildren = files.some(
      (f: ProjectFile) => f.path.startsWith(parentPath) && f.path !== relativePath
    );

    return hasChildren;
  }

  /**
   * ディレクトリかどうかチェック（IndexedDBベース）
   */
  protected async isDirectory(path: string): Promise<boolean> {
    const relativePath = this.getRelativePathFromProject(path);

    // ルートディレクトリは常にディレクトリ
    if (relativePath === '/' || relativePath === '') {
      return true;
    }

    const file = await this.getFileFromDB(relativePath);

    // ファイルが見つかった場合、その型をチェック
    if (file !== undefined) {
      return file.type === 'folder';
    }

    // ファイルが見つからない場合、子ファイルが存在するかチェック
    // （ディレクトリ自体がDBに登録されていない場合でも、子ファイルがあればディレクトリ）
    const parentPath = relativePath.endsWith('/') ? relativePath : relativePath + '/';
    const files = await this.cachedGetFilesByPrefix(parentPath);
    const hasChildren = files.some(
      (f: ProjectFile) => f.path.startsWith(parentPath) && f.path !== relativePath
    );

    return hasChildren;
  }

  /**
   * ファイルかどうかチェック（IndexedDBベース）
   */
  protected async isFile(path: string): Promise<boolean> {
    const relativePath = this.getRelativePathFromProject(path);
    const file = await this.getFileFromDB(relativePath);
    return file !== undefined && file.type === 'file';
  }

  /**
   * オプションをパース
   * @param args - コマンドライン引数
   * @returns パース結果 { options, positional }
   */
  protected parseOptions(args: string[]): { options: Set<string>; positional: string[] } {
    const options = new Set<string>();
    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg.startsWith('--')) {
        // 長いオプション
        options.add(arg);
      } else if (arg.startsWith('-') && arg.length > 1 && arg !== '-') {
        // 短いオプション（複数結合可能: -rf など）
        for (let j = 1; j < arg.length; j++) {
          options.add(`-${arg[j]}`);
        }
      } else {
        // 位置引数
        positional.push(arg);
      }
    }

    return { options, positional };
  }
}
