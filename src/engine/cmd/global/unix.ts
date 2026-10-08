// Unixコマンド統合クラス（新アーキテクチャ: IndexedDB優先、自動同期）

import type TerminalUI from '@/engine/cmd/terminalUI';
import { normalizePath, resolvePath as pathResolvePath } from '@/engine/core/fs';
import {
  CatCommand,
  CdCommand,
  CpCommand,
  DateCommand,
  DfCommand,
  DirnameCommand,
  DuCommand,
  EchoCommand,
  FindCommand,
  GrepCommand,
  GzipCommand,
  HeadCommand,
  HelpCommand,
  LsCommand,
  MkdirCommand,
  MvCommand,
  PrintfCommand,
  PwdCommand,
  RmCommand,
  SortCommand,
  StatCommand,
  TailCommand,
  TarCommand,
  TestCommand,
  TouchCommand,
  TreeCommand,
  UnzipCommand,
  WcCommand,
  ZipCommand,
} from './unixOperations';

/**
 * Unixコマンドを統合して提供するクラス
 *
 * 設計原則:
 * - 全てのコマンドメソッドは args: string[] を受け取る (POSIX準拠)
 * - 各コマンドの実装は unixOperations/ 配下に分割
 * - このクラスは薄いファサードとして機能し、execute()に委譲
 *
 * Paths use absolute filesystem paths. The workspace root only sets the initial cwd.
 */
export const UNIX_COMMANDS = [
  'echo',
  'printf',
  'pwd',
  'ls',
  'cd',
  'mkdir',
  'touch',
  'rm',
  'cp',
  'mv',
  'rename',
  'tree',
  'find',
  'help',
  'unzip',
  'stat',
  'cat',
  'head',
  'tail',
  'grep',
  'wc',
  'date',
  'dirname',
  'whoami',
  'chmod',
  'chown',
  'du',
  'df',
  'sort',
  'tar',
  'gzip',
  'zip',
] as const;

export class UnixCommands {
  private currentDir: string;
  private rootPath: string;

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
  private printfCmd: PrintfCommand;
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
  private dirnameCmd: DirnameCommand;
  private duCmd: DuCommand;
  private dfCmd: DfCommand;
  private sortCmd: SortCommand;
  private tarCmd: TarCommand;
  private gzipCmd: GzipCommand;
  private zipCmd: ZipCommand;

  private terminalUI?: TerminalUI;

  constructor(rootPath: string) {
    this.rootPath = normalizePath(rootPath);
    this.currentDir = this.rootPath;

    // 各コマンドを初期化
    this.catCmd = new CatCommand(this.rootPath, this.currentDir);
    this.cdCmd = new CdCommand(this.rootPath, this.currentDir);
    this.cpCmd = new CpCommand(this.rootPath, this.currentDir);
    this.echoCmd = new EchoCommand(this.rootPath, this.currentDir);
    this.findCmd = new FindCommand(this.rootPath, this.currentDir);
    this.grepCmd = new GrepCommand(this.rootPath, this.currentDir);
    this.helpCmd = new HelpCommand(this.rootPath, this.currentDir);
    this.lsCmd = new LsCommand(this.rootPath, this.currentDir);
    this.mkdirCmd = new MkdirCommand(this.rootPath, this.currentDir);
    this.mvCmd = new MvCommand(this.rootPath, this.currentDir);
    this.pwdCmd = new PwdCommand(this.rootPath, this.currentDir);
    this.printfCmd = new PrintfCommand(this.rootPath, this.currentDir);
    this.rmCmd = new RmCommand(this.rootPath, this.currentDir);
    this.testCmd = new TestCommand(this.rootPath, this.currentDir);
    this.touchCmd = new TouchCommand(this.rootPath, this.currentDir);
    this.treeCmd = new TreeCommand(this.rootPath, this.currentDir);
    this.unzipCmd = new UnzipCommand(this.rootPath, this.currentDir);
    this.headCmd = new HeadCommand(this.rootPath, this.currentDir);
    this.tailCmd = new TailCommand(this.rootPath, this.currentDir);
    this.statCmd = new StatCommand(this.rootPath, this.currentDir);
    this.wcCmd = new WcCommand(this.rootPath, this.currentDir);
    this.dateCmd = new DateCommand(this.rootPath, this.currentDir);
    this.dirnameCmd = new DirnameCommand(this.rootPath, this.currentDir);

    // new commands
    this.duCmd = new DuCommand(this.rootPath, this.currentDir);
    this.dfCmd = new DfCommand(this.rootPath, this.currentDir);
    this.sortCmd = new SortCommand(this.rootPath, this.currentDir);
    this.tarCmd = new TarCommand(this.rootPath, this.currentDir);
    this.gzipCmd = new GzipCommand(this.rootPath, this.currentDir);
    this.zipCmd = new ZipCommand(this.rootPath, this.currentDir);
  }

  /**
   * Inject TerminalUI instance into UnixCommands and propagate to all child command instances
   */
  setTerminalUI(ui: TerminalUI): void {
    this.terminalUI = ui;

    // propagate to individual commands if they support it
    this.catCmd.setTerminalUI?.(ui);
    this.cdCmd.setTerminalUI?.(ui);
    this.cpCmd.setTerminalUI?.(ui);
    this.echoCmd.setTerminalUI?.(ui);
    this.findCmd.setTerminalUI?.(ui);
    this.grepCmd.setTerminalUI?.(ui);
    this.helpCmd.setTerminalUI?.(ui);
    this.lsCmd.setTerminalUI?.(ui);
    this.mkdirCmd.setTerminalUI?.(ui);
    this.mvCmd.setTerminalUI?.(ui);
    this.pwdCmd.setTerminalUI?.(ui);
    this.printfCmd.setTerminalUI?.(ui);
    this.rmCmd.setTerminalUI?.(ui);
    this.testCmd.setTerminalUI?.(ui);
    this.touchCmd.setTerminalUI?.(ui);
    this.treeCmd.setTerminalUI?.(ui);
    this.unzipCmd.setTerminalUI?.(ui);
    this.headCmd.setTerminalUI?.(ui);
    this.tailCmd.setTerminalUI?.(ui);
    this.statCmd.setTerminalUI?.(ui);
    this.wcCmd.setTerminalUI?.(ui);
    this.dateCmd.setTerminalUI?.(ui);
    this.dirnameCmd.setTerminalUI?.(ui);
    this.duCmd.setTerminalUI?.(ui);
    this.dfCmd.setTerminalUI?.(ui);
    this.sortCmd.setTerminalUI?.(ui);
    this.tarCmd.setTerminalUI?.(ui);
    this.gzipCmd.setTerminalUI?.(ui);
    this.zipCmd.setTerminalUI?.(ui);
  }

  getTerminalUI(): TerminalUI | undefined {
    return this.terminalUI;
  }

  // ==================== 状態管理 ====================

  /**
   * 現在のディレクトリを取得 (pwd)
   */
  async pwd(): Promise<string> {
    return await this.pwdCmd.execute([]);
  }

  async printf(args: string[]): Promise<string> {
    return await this.printfCmd.execute(args);
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
    this.printfCmd.currentDir = dir;
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
    this.dirnameCmd.currentDir = dir;
    this.duCmd.currentDir = dir;
    this.dfCmd.currentDir = dir;
    this.sortCmd.currentDir = dir;
    this.tarCmd.currentDir = dir;
    this.gzipCmd.currentDir = dir;
    this.zipCmd.currentDir = dir;
  }

  // ==================== POSIX準拠コマンド (args: string[]) ====================

  async cd(args: string[]): Promise<string> {
    const result = await this.cdCmd.execute(args);
    this.setCurrentDir(result.newDir);
    return result.message || '';
  }

  async ls(args: string[] = []): Promise<string> {
    return await this.lsCmd.execute(args);
  }

  async mkdir(args: string[]): Promise<string> {
    return await this.mkdirCmd.execute(args);
  }

  async touch(args: string[]): Promise<string> {
    return await this.touchCmd.execute(args);
  }

  async rm(args: string[]): Promise<string> {
    return await this.rmCmd.execute(args);
  }

  async cat(args: string[]): Promise<string | Uint8Array> {
    return await this.catCmd.execute(args);
  }

  async head(args: string[]): Promise<string> {
    return await this.headCmd.execute(args);
  }

  async tail(args: string[]): Promise<string> {
    return await this.tailCmd.execute(args);
  }

  async stat(args: string[]): Promise<string> {
    return await this.statCmd.execute(args);
  }

  async echo(args: string[]): Promise<string> {
    return await this.echoCmd.execute(args);
  }

  async dirname(args: string[]): Promise<string> {
    return await this.dirnameCmd.execute(args);
  }

  async mv(args: string[]): Promise<string> {
    return await this.mvCmd.execute(args);
  }

  async cp(args: string[]): Promise<string> {
    return await this.cpCmd.execute(args);
  }

  async rename(args: string[]): Promise<string> {
    return await this.mvCmd.execute(args);
  }

  async tree(args: string[] = []): Promise<string> {
    return await this.treeCmd.execute(args);
  }

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

  async test(args: string[]): Promise<boolean> {
    return await this.testCmd.evaluate(args);
  }

  async help(args: string[] = []): Promise<string> {
    return await this.helpCmd.execute(args);
  }

  async date(args: string[] = []): Promise<string> {
    return await this.dateCmd.execute(args);
  }

  async du(args: string[] = []): Promise<string> {
    return await this.duCmd.execute(args);
  }

  async df(args: string[] = []): Promise<string> {
    return await this.dfCmd.execute(args);
  }

  async sort(args: string[], stdin: NodeJS.ReadableStream | string | null = null): Promise<string> {
    if (stdin) {
      let content = '';
      if (typeof stdin === 'string') content = stdin;
      else {
        content = await new Promise<string>(resolve => {
          let buf = '';
          stdin.on('data', (c: any) => (buf += String(c)));
          stdin.on('end', () => resolve(buf));
          stdin.on('close', () => resolve(buf));
          setTimeout(() => resolve(buf), 50);
        });
      }
      this.sortCmd.setStdin(content);
    }
    return await this.sortCmd.execute(args);
  }

  /**
   * tar - tar archive create/list/extract
   */
  async tar(args: string[] = []): Promise<string> {
    return await this.tarCmd.execute(args);
  }

  /**
   * gzip - compress/decompress
   */
  async gzip(args: string[] = []): Promise<string> {
    return await this.gzipCmd.execute(args);
  }

  /**
   * zip - create zip archive
   */
  async zip(args: string[] = []): Promise<string> {
    return await this.zipCmd.execute(args);
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
   * パスを正規化（..や.を解決）
   * pathResolverを使用
   */
  public normalizePath(path: string): string {
    return path.startsWith('/') ? normalizePath(path) : pathResolvePath(this.currentDir, path);
  }
}
