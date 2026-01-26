// Unixコマンド統合クラス（新アーキテクチャ: IndexedDB優先、自動同期）

import {
  CatCommand,
  CdCommand,
  CpCommand,
  EchoCommand,
  FindCommand,
  GrepCommand,
  HeadCommand,
  HelpCommand,
  LsCommand,
  MkdirCommand,
  MvCommand,
  PwdCommand,
  RmCommand,
  StatCommand,
  TailCommand,
  TestCommand,
  TouchCommand,
  TreeCommand,
  UnzipCommand,
  WcCommand,
  DateCommand,
} from './unixOperations';

import { gitFileSystem } from '@/engine/core/gitFileSystem';
import {
  fsPathToAppPath,
  normalizeDotSegments,
  resolvePath as pathResolvePath,
} from '@/engine/core/pathUtils';

/**
 * Unixコマンドを統合して提供するクラス
 *
 * 設計原則:
 * - 全てのコマンドメソッドは args: string[] を受け取る (POSIX準拠)
 * - 各コマンドの実装は unixOperations/ 配下に分割
 * - このクラスは薄いファサードとして機能し、execute()に委譲
 *
 * パス形式:
 * - currentDir: FSPath形式（/projects/{projectName}/...）
 * - 外部API: AppPath形式（/src/hello.ts）
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
  private testCmd: TestCommand;
  private touchCmd: TouchCommand;
  private treeCmd: TreeCommand;
  private unzipCmd: UnzipCommand;
  private headCmd: HeadCommand;
  private tailCmd: TailCommand;
  private statCmd: StatCommand;
  private wcCmd: WcCommand;
  private dateCmd: DateCommand;

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
    this.testCmd = new TestCommand(projectName, this.currentDir, projectId);
    this.touchCmd = new TouchCommand(projectName, this.currentDir, projectId);
    this.treeCmd = new TreeCommand(projectName, this.currentDir, projectId);
    this.unzipCmd = new UnzipCommand(projectName, this.currentDir, projectId);
    this.headCmd = new HeadCommand(projectName, this.currentDir, projectId);
    this.tailCmd = new TailCommand(projectName, this.currentDir, projectId);
    this.statCmd = new StatCommand(projectName, this.currentDir, projectId);
    this.wcCmd = new WcCommand(projectName, this.currentDir, projectId);
    this.dateCmd = new DateCommand(projectName, this.currentDir, projectId);
  }

  // ==================== 状態管理 ====================

  /**
   * 現在のディレクトリを取得 (pwd)
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
    this.catCmd.currentDir = dir;
    this.cdCmd.currentDir = dir;
    this.cpCmd.currentDir = dir;
    this.echoCmd.currentDir = dir;
    this.findCmd.currentDir = dir;
    this.grepCmd.currentDir = dir;
    this.helpCmd.currentDir = dir;
    this.lsCmd.currentDir = dir;
    this.mkdirCmd.currentDir = dir;
    this.mvCmd.currentDir = dir;
    this.pwdCmd.currentDir = dir;
    this.rmCmd.currentDir = dir;
    this.testCmd.currentDir = dir;
    this.touchCmd.currentDir = dir;
    this.treeCmd.currentDir = dir;
    this.unzipCmd.currentDir = dir;
    this.headCmd.currentDir = dir;
    this.tailCmd.currentDir = dir;
    this.statCmd.currentDir = dir;
    this.wcCmd.currentDir = dir;
    this.dateCmd.currentDir = dir;
  }

  // ==================== POSIX準拠コマンド (args: string[]) ====================

  /**
   * cd - ディレクトリを変更
   * @param args - [path] または [options..., path]
   */
  async cd(args: string[]): Promise<string> {
    const result = await this.cdCmd.execute(args);
    // cd成功時、現在のディレクトリを更新
    this.setCurrentDir(result.newDir);
    return result.message || '';
  }

  /**
   * ls - ディレクトリの内容を一覧表示
   * @param args - [options..., paths...]
   */
  async ls(args: string[] = []): Promise<string> {
    return await this.lsCmd.execute(args);
  }

  /**
   * mkdir - ディレクトリを作成
   * @param args - [options..., dirs...]
   */
  async mkdir(args: string[]): Promise<string> {
    return await this.mkdirCmd.execute(args);
  }

  /**
   * touch - ファイルを作成/タイムスタンプ更新
   * @param args - [options..., files...]
   */
  async touch(args: string[]): Promise<string> {
    return await this.touchCmd.execute(args);
  }

  /**
   * rm - ファイル/ディレクトリを削除
   * @param args - [options..., files...]
   */
  async rm(args: string[]): Promise<string> {
    return await this.rmCmd.execute(args);
  }

  /**
   * cat - ファイルの内容を表示
   * @param args - [options..., files...]
   */
  async cat(args: string[]): Promise<string> {
    return await this.catCmd.execute(args);
  }

  /**
   * head - ファイルの先頭を表示
   * @param args - [options..., files...]
   */
  async head(args: string[]): Promise<string> {
    return await this.headCmd.execute(args);
  }

  /**
   * tail - ファイルの末尾を表示
   * @param args - [options..., files...]
   */
  async tail(args: string[]): Promise<string> {
    return await this.tailCmd.execute(args);
  }

  /**
   * stat - ファイル情報を表示
   * @param args - [options..., files...]
   */
  async stat(args: string[]): Promise<string> {
    return await this.statCmd.execute(args);
  }

  /**
   * echo - テキストを出力
   * @param args - [options..., strings...]
   */
  async echo(args: string[]): Promise<string> {
    return await this.echoCmd.execute(args);
  }

  /**
   * mv - ファイル/ディレクトリを移動
   * @param args - [options..., sources..., destination]
   */
  async mv(args: string[]): Promise<string> {
    return await this.mvCmd.execute(args);
  }

  /**
   * cp - ファイル/ディレクトリをコピー
   * @param args - [options..., sources..., destination]
   */
  async cp(args: string[]): Promise<string> {
    return await this.cpCmd.execute(args);
  }

  /**
   * rename - ファイル/ディレクトリをリネーム (mvのエイリアス)
   * @param args - [oldPath, newPath]
   */
  async rename(args: string[]): Promise<string> {
    return await this.mvCmd.execute(args);
  }

  /**
   * tree - ディレクトリ構造をツリー表示
   * @param args - [options..., path]
   */
  async tree(args: string[] = []): Promise<string> {
    return await this.treeCmd.execute(args);
  }

  /**
   * find - ファイルを検索
   * @param args - [path, expressions...]
   */
  async find(args: string[] = []): Promise<string> {
    return await this.findCmd.execute(args);
  }

  /**
   * grep - ファイル内容を検索
   * @param args - [options..., pattern, files...]
   * @param stdin - 標準入力ストリームまたは文字列
   */
  async grep(args: string[], stdin: NodeJS.ReadableStream | string | null = null): Promise<string> {
    return await this.grepCmd.execute(args, stdin);
  }

  /**
   * wc - 行数、単語数、バイト数をカウント
   * @param args - [options..., files...]
   * @param stdin - 標準入力ストリームまたは文字列
   */
  async wc(args: string[], stdin: NodeJS.ReadableStream | string | null = null): Promise<string> {
    if (stdin) {
      // stdinの内容をセット
      let content = '';
      if (typeof stdin === 'string') {
        content = stdin;
      } else {
        content = await new Promise<string>(resolve => {
          let buf = '';
          stdin.on('data', (c: any) => (buf += String(c)));
          stdin.on('end', () => resolve(buf));
          stdin.on('close', () => resolve(buf));
          setTimeout(() => resolve(buf), 50);
        });
      }
      this.wcCmd.setStdin(content);
    }
    return await this.wcCmd.execute(args);
  }

  /**
   * test/[ - 条件式を評価
   * @param args - 条件式トークン
   */
  async test(args: string[]): Promise<boolean> {
    return await this.testCmd.evaluate(args);
  }

  /**
   * help - ヘルプを表示
   * @param args - [command]
   */
  async help(args: string[] = []): Promise<string> {
    return await this.helpCmd.execute(args);
  }

  /**
   * date - 日付表示（POSIXライク）
   * @param args - [options..., +FORMAT]
   */
  async date(args: string[] = []): Promise<string> {
    return await this.dateCmd.execute(args);
  }

  /**
   * unzip - ZIPファイルを解凍
   * @param args - [zipFile, destDir]
   * @param bufferContent - オプションのバッファ内容
   */
  async unzip(args: string[], bufferContent?: ArrayBuffer): Promise<string> {
    const zipFileName = args[0] || '';
    const destDir = args[1] || '.';
    if (bufferContent) {
      return await this.unzipCmd.extract(zipFileName, destDir, bufferContent);
    }
    return await this.unzipCmd.extract(zipFileName, destDir);
  }

  // ==================== ユーティリティメソッド ====================

  /**
   * FSPath（/projects/...）からAppPath（/src/...）を取得
   * pathResolverのfsPathToAppPathを使用
   */
  public getRelativePathFromProject(fullPath: string): string {
    return fsPathToAppPath(fullPath, this.projectName);
  }

  /**
   * パスを正規化（..や.を解決）
   * pathResolverを使用
   */
  public normalizePath(path: string): string {
    // 絶対パスならそのまま正規化
    if (path.startsWith('/')) {
      return normalizeDotSegments(path);
    }
    // カレントディレクトリ基準の相対パスを解決
    return pathResolvePath(this.currentDir, path);
  }
}
