import { fileRepository } from '@/engine/core/fileRepository';
import type { ProjectFile } from '@/types';

/**
 * Unixコマンドのベースクラス
 * 共通のユーティリティメソッドと状態管理を提供
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

  /**
   * 相対パスを絶対パスに変換
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
   * パスを正規化（..や.を解決）
   */
  protected normalizePath(path: string): string {
    const parts = path.split('/').filter(part => part !== '' && part !== '.');
    const normalized: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
          normalized.pop();
        }
      } else {
        normalized.push(part);
      }
    }

    return '/' + normalized.join('/');
  }

  /**
   * プロジェクトルートからの相対パスを取得
   */
  protected getRelativePathFromProject(fullPath: string): string {
    const projectBase = `/projects/${this.projectName}`;
    return fullPath.replace(projectBase, '') || '/';
  }

  /**
   * プロジェクトルートディレクトリを取得
   */
  protected getProjectRoot(): string {
    return '/projects/' + this.projectName;
  }

  /**
   * パスがプロジェクト内かチェック
   */
  protected isWithinProject(path: string): boolean {
    const projectRoot = this.getProjectRoot();
    return path.startsWith(projectRoot);
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
    const files = await fileRepository.getFilesByPrefix(this.projectId, prefix);

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
    const resolvedPath = this.resolvePath(pathPattern);

    // ワイルドカードが含まれていない場合はそのまま返す
    if (!resolvedPath.includes('*') && !resolvedPath.includes('?')) {
      return [resolvedPath];
    }

    const normalizedPath = this.normalizePath(resolvedPath);

    // プロジェクトルートからの相対パスに変換してから展開
    const relativePath = this.getRelativePathFromProject(normalizedPath);
    const parts = relativePath.split('/').filter(p => p);
    const relativeResults: string[] = [];

    await this.expandPathRecursive(parts, 0, '', relativeResults);

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
      const files: ProjectFile[] = await fileRepository.getFilesByPrefix(this.projectId, prefix);
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
    const file = await fileRepository.getFileByPath(this.projectId, relativePath);
    return file || undefined;
  }

  /**
   * IndexedDBから全ファイルを取得
   */
  protected async getAllFilesFromDB(): Promise<ProjectFile[]> {
    return await fileRepository.getProjectFiles(this.projectId);
  }

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
  const files = await fileRepository.getFilesByPrefix(this.projectId, parentPath);
  const hasChildren = files.some((f: ProjectFile) => f.path.startsWith(parentPath) && f.path !== relativePath);

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
    const files = await fileRepository.getFilesByPrefix(this.projectId, parentPath);
    const hasChildren = files.some((f: ProjectFile) => f.path.startsWith(parentPath) && f.path !== relativePath);

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
