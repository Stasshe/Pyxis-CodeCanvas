// Unixコマンド統合クラス（新アーキテクチャ: IndexedDB優先、自動同期）

import type TerminalUI from '@/engine/cmd/terminalUI';
import type { FsApi } from '@/engine/core/fs';
import {
  fsClient as defaultFsClient,
  normalizePath,
  resolvePath as pathResolvePath,
} from '@/engine/core/fs';
import { parseWithGetOpt } from '../lib';
import {
  AwkCommand,
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
  MkfifoCommand,
  MvCommand,
  PrintfCommand,
  PwdCommand,
  RmCommand,
  SeqCommand,
  SleepCommand,
  SortCommand,
  StatCommand,
  TailCommand,
  TarCommand,
  TeeCommand,
  TestCommand,
  TouchCommand,
  TrCommand,
  TreeCommand,
  UnzipCommand,
  WcCommand,
  XargsCommand,
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
  'mkfifo',
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
  'tr',
  'seq',
  'tee',
  'sleep',
  'xargs',
  'awk',
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
  private mkfifoCmd: MkfifoCommand;
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
  private trCmd: TrCommand;
  private seqCmd: SeqCommand;
  private teeCmd: TeeCommand;
  private sleepCmd: SleepCommand;
  private xargsCmd: XargsCommand;
  private awkCmd: AwkCommand;

  private terminalUI?: TerminalUI;

  constructor(rootPath: string, fs: FsApi = defaultFsClient) {
    this.rootPath = normalizePath(rootPath);
    this.currentDir = this.rootPath;

    // 各コマンドを初期化
    this.catCmd = new CatCommand(this.rootPath, this.currentDir, fs);
    this.cdCmd = new CdCommand(this.rootPath, this.currentDir, fs);
    this.cpCmd = new CpCommand(this.rootPath, this.currentDir, fs);
    this.echoCmd = new EchoCommand(this.rootPath, this.currentDir, fs);
    this.findCmd = new FindCommand(this.rootPath, this.currentDir, fs);
    this.grepCmd = new GrepCommand(this.rootPath, this.currentDir, fs);
    this.helpCmd = new HelpCommand(this.rootPath, this.currentDir, fs);
    this.lsCmd = new LsCommand(this.rootPath, this.currentDir, fs);
    this.mkdirCmd = new MkdirCommand(this.rootPath, this.currentDir, fs);
    this.mkfifoCmd = new MkfifoCommand(this.rootPath, this.currentDir, fs);
    this.mvCmd = new MvCommand(this.rootPath, this.currentDir, fs);
    this.pwdCmd = new PwdCommand(this.rootPath, this.currentDir, fs);
    this.printfCmd = new PrintfCommand(this.rootPath, this.currentDir, fs);
    this.rmCmd = new RmCommand(this.rootPath, this.currentDir, fs);
    this.testCmd = new TestCommand(this.rootPath, this.currentDir, fs);
    this.touchCmd = new TouchCommand(this.rootPath, this.currentDir, fs);
    this.treeCmd = new TreeCommand(this.rootPath, this.currentDir, fs);
    this.unzipCmd = new UnzipCommand(this.rootPath, this.currentDir, fs);
    this.headCmd = new HeadCommand(this.rootPath, this.currentDir, fs);
    this.tailCmd = new TailCommand(this.rootPath, this.currentDir, fs);
    this.statCmd = new StatCommand(this.rootPath, this.currentDir, fs);
    this.wcCmd = new WcCommand(this.rootPath, this.currentDir, fs);
    this.dateCmd = new DateCommand(this.rootPath, this.currentDir, fs);
    this.dirnameCmd = new DirnameCommand(this.rootPath, this.currentDir, fs);

    // new commands
    this.duCmd = new DuCommand(this.rootPath, this.currentDir, fs);
    this.dfCmd = new DfCommand(this.rootPath, this.currentDir, fs);
    this.sortCmd = new SortCommand(this.rootPath, this.currentDir, fs);
    this.tarCmd = new TarCommand(this.rootPath, this.currentDir, fs);
    this.gzipCmd = new GzipCommand(this.rootPath, this.currentDir, fs);
    this.zipCmd = new ZipCommand(this.rootPath, this.currentDir, fs);
    this.trCmd = new TrCommand(this.rootPath, this.currentDir, fs);
    this.seqCmd = new SeqCommand(this.rootPath, this.currentDir, fs);
    this.teeCmd = new TeeCommand(this.rootPath, this.currentDir, fs);
    this.sleepCmd = new SleepCommand(this.rootPath, this.currentDir, fs);
    this.xargsCmd = new XargsCommand(this.rootPath, this.currentDir, fs);
    this.awkCmd = new AwkCommand(this.rootPath, this.currentDir, fs);
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
    this.trCmd.setTerminalUI?.(ui);
    this.seqCmd.setTerminalUI?.(ui);
    this.teeCmd.setTerminalUI?.(ui);
    this.sleepCmd.setTerminalUI?.(ui);
    this.xargsCmd.setTerminalUI?.(ui);
    this.awkCmd.setTerminalUI?.(ui);
  }

  getTerminalUI(): TerminalUI | undefined {
    return this.terminalUI;
  }

  withFsClient(fs: FsApi): UnixCommands {
    const scoped = new UnixCommands(this.rootPath, fs);
    scoped.setCurrentDir(this.currentDir);
    if (this.terminalUI) scoped.setTerminalUI(this.terminalUI);
    return scoped;
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
    this.mkfifoCmd.currentDir = dir;
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
    this.trCmd.currentDir = dir;
    this.seqCmd.currentDir = dir;
    this.teeCmd.currentDir = dir;
    this.sleepCmd.currentDir = dir;
    this.xargsCmd.currentDir = dir;
    this.awkCmd.currentDir = dir;
  }

  // ==================== POSIX準拠コマンド (args: string[]) ====================

  async cd(args: string[]): Promise<string> {
    const result = await this.cdCmd.execute(args);
    this.setCurrentDir(result.newDir);
    return result.message || '';
  }

  async ls(args: string[] = [], outputTTY = false): Promise<string> {
    return await this.lsCmd.execute(args, outputTTY);
  }

  async mkdir(args: string[]): Promise<string> {
    return await this.mkdirCmd.execute(args);
  }

  async mkfifo(args: string[]): Promise<string> {
    return await this.mkfifoCmd.execute(args);
  }

  async touch(args: string[]): Promise<string> {
    return await this.touchCmd.execute(args);
  }

  async rm(args: string[]): Promise<string> {
    return await this.rmCmd.execute(args);
  }

  async cat(
    args: string[],
    stdin: NodeJS.ReadableStream | string | Uint8Array | null = null
  ): Promise<string | Uint8Array> {
    return this.catCmd.execute(args, stdin);
  }

  async head(args: string[], stdin?: string | Uint8Array): Promise<string | Uint8Array> {
    return await this.headCmd.execute(args, stdin);
  }

  async tail(args: string[], stdin?: string | Uint8Array): Promise<string | Uint8Array> {
    return await this.tailCmd.execute(args, stdin);
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
  async wc(
    args: string[],
    stdin: NodeJS.ReadableStream | string | Uint8Array | null = null
  ): Promise<string> {
    const parsed = parseWithGetOpt(args, 'lwcm', ['help']);
    let stdinContent: Uint8Array | null = null;
    if (parsed.errors.length === 0 && !parsed.flags.has('--help')) {
      if (parsed.positional.length === 0 || parsed.positional.includes('-')) {
        if (stdin !== null) stdinContent = await readStdinBytes(stdin);
      }
    }
    this.wcCmd.setStdin(stdinContent);
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
    const parsed = parseWithGetOpt(args, 'rnu', ['help']);
    let stdinContent: string | null = null;
    if (parsed.errors.length === 0 && !parsed.flags.has('--help')) {
      if (parsed.positional.length === 0 || parsed.positional.includes('-')) {
        if (stdin !== null) stdinContent = await readStdin(stdin);
      }
    }
    this.sortCmd.setStdin(stdinContent);
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

  async tr(args: string[], stdin: NodeJS.ReadableStream | string | null = null): Promise<string> {
    return this.trCmd.execute(args, await readStdin(stdin));
  }

  async seq(args: string[] = []): Promise<string> {
    return this.seqCmd.execute(args);
  }

  async tee(
    args: string[],
    stdin: NodeJS.ReadableStream | string | Uint8Array | null = null
  ): Promise<{ output: Uint8Array; errors: string[] }> {
    return this.teeCmd.execute(args, await readStdinBytes(stdin));
  }

  async sleep(
    args: string[] = [],
    onSignal?: (listener: (signal: string) => void) => () => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    return this.sleepCmd.execute(args, onSignal, signal);
  }

  async xargs(args: string[], stdin: NodeJS.ReadableStream | string | null = null) {
    return this.xargsCmd.expand(args, await readStdin(stdin));
  }

  async awk(args: string[], stdin: NodeJS.ReadableStream | string | null = null): Promise<string> {
    const execute = this.awkCmd.prepare(args);
    const input = await readStdin(stdin);
    return execute(input);
  }

  /**
   * unzip - ZIPファイルを解凍
   * @param args - [zipFile, destDir]
   * @param bufferContent - オプションのバッファ内容
   */
  async unzip(args: string[], bufferContent?: ArrayBuffer): Promise<string> {
    return this.unzipCmd.execute(args, bufferContent);
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

async function readStdin(stdin: NodeJS.ReadableStream | string | null): Promise<string> {
  if (typeof stdin === 'string') return stdin;
  if (!stdin) return '';
  return new Promise(resolve => {
    const decoder = new TextDecoder();
    let content = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      content += decoder.decode();
      resolve(content);
    };
    stdin.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') content += chunk;
      else if (chunk instanceof Uint8Array) content += decoder.decode(chunk, { stream: true });
    });
    stdin.on('end', finish);
    stdin.on('close', finish);
  });
}

async function readStdinBytes(
  stdin: NodeJS.ReadableStream | string | Uint8Array | null
): Promise<Uint8Array> {
  if (typeof stdin === 'string') return new TextEncoder().encode(stdin);
  if (stdin instanceof Uint8Array) return stdin;
  if (!stdin) return new Uint8Array();
  return new Promise(resolve => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const content = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(content);
    };
    stdin.on('data', (chunk: unknown) => {
      let bytes: Uint8Array;
      if (typeof chunk === 'string') bytes = new TextEncoder().encode(chunk);
      else if (chunk instanceof Uint8Array) bytes = new Uint8Array(chunk);
      else return;
      chunks.push(bytes);
      length += bytes.length;
    });
    stdin.on('end', finish);
    stdin.on('close', finish);
  });
}
