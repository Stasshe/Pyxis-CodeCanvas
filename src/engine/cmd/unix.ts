// Unixコマンド統合クラス（新アーキテクチャ: IndexedDB優先、自動同期）
import JSZip from 'jszip';

import {
  CatCommand,
  CdCommand,
  CpCommand,
  EchoCommand,
  FindCommand,
  GrepCommand,
  HelpCommand,
  LsCommand,
  MkdirCommand,
  MvCommand,
  PwdCommand,
  RmCommand,
  TouchCommand,
  TreeCommand,
} from './unixOperations';

import { fileRepository } from '@/engine/core/fileRepository';
import { gitFileSystem } from '@/engine/core/gitFileSystem';


/**
 * Unixコマンドを統合して提供するクラス
 * 各コマンドの実装は unix-commands/ 配下に分割されている
 */
export class UnixCommands {
  private currentDir: string;
  private projectId: string;
  private projectName: string;

  // 各コマンドのインスタンス
  private catCmd: CatCommand;
  private cdCmd: CdCommand;
  private cpCmd: CpCommand;
  private echoCmd: EchoCommand;
  private findCmd: FindCommand;
  private grepCmd: GrepCommand;
  private helpCmd: HelpCommand;
  private lsCmd: LsCommand;
  private mkdirCmd: MkdirCommand;
  private mvCmd: MvCommand;
  private pwdCmd: PwdCommand;
  private rmCmd: RmCommand;
  private touchCmd: TouchCommand;
  private treeCmd: TreeCommand;

  constructor(projectName: string, projectId?: string) {
    this.currentDir = gitFileSystem.getProjectDir(projectName);
    this.projectId = projectId || '';
    this.projectName = projectName;

    if (!this.projectId) {
      console.warn('[UnixCommands] projectId is empty! DB operations will fail.');
    }

    // 各コマンドを初期化
    this.catCmd = new CatCommand(projectName, this.currentDir, projectId);
    this.cdCmd = new CdCommand(projectName, this.currentDir, projectId);
    this.cpCmd = new CpCommand(projectName, this.currentDir, projectId);
    this.echoCmd = new EchoCommand(projectName, this.currentDir, projectId);
    this.findCmd = new FindCommand(projectName, this.currentDir, projectId);
    this.grepCmd = new GrepCommand(projectName, this.currentDir, projectId);
    this.helpCmd = new HelpCommand(projectName, this.currentDir, projectId);
    this.lsCmd = new LsCommand(projectName, this.currentDir, projectId);
    this.mkdirCmd = new MkdirCommand(projectName, this.currentDir, projectId);
    this.mvCmd = new MvCommand(projectName, this.currentDir, projectId);
    this.pwdCmd = new PwdCommand(projectName, this.currentDir, projectId);
    this.rmCmd = new RmCommand(projectName, this.currentDir, projectId);
    this.touchCmd = new TouchCommand(projectName, this.currentDir, projectId);
    this.treeCmd = new TreeCommand(projectName, this.currentDir, projectId);
  }

  /**
   * 現在のディレクトリを取得
   */
  async pwd(): Promise<string> {
    return await this.pwdCmd.execute([]);
  }

  /**
   * プロジェクトルートからの相対パスを取得
   */
  getRelativePath(): string {
    const projectBase = this.currentDir.split('/')[2];
    const relativePath = this.currentDir.replace(`/projects/${projectBase}`, '');
    return relativePath || '/';
  }

  /**
   * 現在のディレクトリを設定
   */
  setCurrentDir(dir: string): void {
    this.currentDir = dir;
    // 全コマンドインスタンスの currentDir を更新
    this.catCmd['currentDir'] = dir;
    this.cdCmd['currentDir'] = dir;
    this.cpCmd['currentDir'] = dir;
    this.echoCmd['currentDir'] = dir;
    this.findCmd['currentDir'] = dir;
    this.grepCmd['currentDir'] = dir;
    this.helpCmd['currentDir'] = dir;
    this.lsCmd['currentDir'] = dir;
    this.mkdirCmd['currentDir'] = dir;
    this.mvCmd['currentDir'] = dir;
    this.pwdCmd['currentDir'] = dir;
    this.rmCmd['currentDir'] = dir;
    this.touchCmd['currentDir'] = dir;
    this.treeCmd['currentDir'] = dir;
  }

  /**
   * ディレクトリを変更
   */
  async cd(path: string, options: string[] = []): Promise<string> {
    const result = await this.cdCmd.execute([...options, path]);
    // cd成功時、現在のディレクトリを更新
    this.setCurrentDir(result.newDir);
    return result.message || '';
  }

  /**
   * ディレクトリの内容を一覧表示
   */
  async ls(path?: string, options: string[] = []): Promise<string> {
    const args = [...options];
    if (path) {
      args.push(path);
    }
    return await this.lsCmd.execute(args);
  }

  /**
   * ディレクトリを作成
   */
  async mkdir(dirName: string, recursive = false): Promise<string> {
    const options = recursive ? ['-p'] : [];
    return await this.mkdirCmd.execute([...options, dirName]);
  }

  /**
   * 空のファイルを作成
   */
  async touch(fileName: string): Promise<string> {
    return await this.touchCmd.execute([fileName]);
  }

  /**
   * ファイル/ディレクトリを削除
   */
  async rm(fileName: string, recursive = false): Promise<string> {
    const options = recursive ? ['-r'] : [];
    return await this.rmCmd.execute([...options, fileName]);
  }

  /**
   * ファイルの内容を表示
   */
  async cat(fileName: string): Promise<string> {
    return await this.catCmd.execute([fileName]);
  }

  /**
   * テキストを出力（リダイレクト処理はTerminal.tsxで処理される）
   */
  async echo(text: string): Promise<string> {
    return await this.echoCmd.execute([text]);
  }

  /**
   * ファイル/ディレクトリを移動またはリネーム
   */
  async mv(source: string, destination: string): Promise<string> {
    return await this.mvCmd.execute([source, destination]);
  }

  /**
   * ファイル/ディレクトリをリネーム（mvのエイリアス）
   */
  async rename(oldPath: string, newPath: string): Promise<string> {
    return await this.mvCmd.execute([oldPath, newPath]);
  }

  /**
   * ファイル/ディレクトリをコピー
   */
  async cp(source: string, destination: string, options: string[] = []): Promise<string> {
    return await this.cpCmd.execute([...options, source, destination]);
  }

  /**
   * ディレクトリ構造をツリー表示
   */
  async tree(path?: string, options: string[] = []): Promise<string> {
    const args = [...options];
    if (path) {
      args.push(path);
    }
    return await this.treeCmd.execute(args);
  }

  /**
   * ファイルを検索
   */
  async find(path?: string, options: string[] = []): Promise<string> {
    const args = [...options];
    if (path) {
      args.unshift(path);
    }
    return await this.findCmd.execute(args);
  }

  /**
   * ファイル内容を検索
   */
  async grep(pattern: string, files: string[], options: string[] = []): Promise<string> {
    return await this.grepCmd.execute([...options, pattern, ...files]);
  }

  /**
   * ヘルプを表示
   */
  async help(command?: string): Promise<string> {
    const args = command ? [command] : [];
    return await this.helpCmd.execute(args);
  }

  /**
   * ZIPファイルを解凍
   */
  async unzip(zipFileName: string, destDir: string, bufferContent: ArrayBuffer): Promise<string> {
    const extractDir = destDir
      ? destDir.startsWith('/')
        ? destDir
        : `${this.currentDir}/${destDir}`
      : this.currentDir;
    const normalizedDest = this.normalizePath(extractDir);

    try {
      const zip = await JSZip.loadAsync(bufferContent);
      let fileCount = 0;

      for (const relPath in zip.files) {
        const file = zip.files[relPath];

        if (!relPath || relPath === '/' || relPath.includes('../')) {
          continue;
        }

        const destPath = `${normalizedDest}/${relPath}`;
        const normalizedFilePath = this.normalizePath(destPath);
        const relativePath = this.getRelativePathFromProject(normalizedFilePath);

        if (file.dir || relPath.endsWith('/')) {
          // ディレクトリ（自動同期＆フラッシュ）
          await fileRepository.createFile(this.projectId, relativePath, '', 'folder');
        } else {
          // ファイル（自動同期＆フラッシュ）
          let content: Uint8Array | string = await file.async('uint8array');
          let isText = false;
          let isBufferArray = false;

          try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
            if (
              /\.(txt|md|js|ts|jsx|tsx|json|html|css|py|sh|yml|yaml|xml|svg|csv)$/i.test(relPath)
            ) {
              isText = true;
              content = text;
            }
          } catch {
            isBufferArray = true;
          }

          if (isText && typeof content === 'string') {
            await fileRepository.createFile(this.projectId, relativePath, content, 'file');
          } else if (isBufferArray && content instanceof Uint8Array) {
            const buffer =
              content.buffer instanceof ArrayBuffer
                ? content.buffer
                : new ArrayBuffer(content.byteLength);
            if (buffer !== content.buffer) {
              new Uint8Array(buffer).set(content);
            }
            await fileRepository.createFile(this.projectId, relativePath, '', 'file', true, buffer);
          }
        }
        fileCount++;
      }

      return `Unzipped ${fileCount} file(s) to ${normalizedDest}`;
    } catch (error) {
      throw new Error(`unzip: ${zipFileName}: ${(error as Error).message}`);
    }
  }

  // ユーティリティメソッド

  public getRelativePathFromProject(fullPath: string): string {
    const projectBase = `/projects/${this.projectName}`;
    return fullPath.replace(projectBase, '') || '/';
  }

  public normalizePath(path: string): string {
    // 絶対パスならそのまま
    if (path.startsWith('/')) {
      path = path;
    } else {
      // カレントディレクトリ基準の相対パス
      path = this.currentDir.replace(/\/$/, '') + '/' + path;
    }
    // './'や'../'を正しく解決
    const segments = path.split('/');
    const stack: string[] = [];
    for (const seg of segments) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (stack.length > 0) {
          stack.pop();
        }
      } else {
        stack.push(seg);
      }
    }
    return '/' + stack.join('/');
  }
}
