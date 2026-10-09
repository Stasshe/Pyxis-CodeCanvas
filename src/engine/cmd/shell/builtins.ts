import type { Readable, Writable } from 'node:stream';

import { UNIX_COMMANDS, type UnixCommands } from '@/engine/cmd/global/unix';
import { UnixCommandFailure } from '@/engine/cmd/global/unixOperations/base';
import { resolvePath } from '@/engine/core/pathUtils';
import { runtimeRegistry } from '@/engine/runtime/core/RuntimeRegistry';
import handleUnixCommand from '../handlers/unixHandler';
import type { ProcessStdin } from '../terminalProcessBridge';
import { SilentCommandError } from './errors';
import type { StreamBuiltin } from './types';

export type StreamCtx = {
  readonly hasExited: boolean;
  stdin: Readable;
  stdinRedirected?: boolean;
  processStdin: ProcessStdin;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  executeArgv: (
    argv: readonly string[]
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
  stdout: Writable;
  stderr: Writable;
  onSignal: (fn: (sig: string) => void, signals?: readonly string[]) => () => void;
  signal?: AbortSignal;
  rootPath: string;
  env?: Record<string, string>;
  unix: UnixCommands;
  /** Terminal columns (width) */
  terminalColumns?: number;
  /** Terminal rows (height) */
  terminalRows?: number;
};

/**
 * unixHandlerへの統一ブリッジ関数
 * ストリーム対応しながらunixHandlerの完全なロジックを活用
 */
const makeUnixBridge = (name: string) => {
  return async (ctx: StreamCtx, args: string[] = []) => {
    let exitCode = 0;

    const writeOutput = async (output: string | Uint8Array) => {
      if (ctx.hasExited) return;
      ctx.stdout.write(output);
    };

    try {
      const writeError = async (s: string) => {
        if (ctx.hasExited) return;
        ctx.stderr.write(s);
      };

      const result = await handleUnixCommand(
        name,
        args,
        writeOutput,
        writeError,
        ctx.unix,
        ctx.stdin,
        fn => ctx.onSignal(fn, ['SIGINT']),
        ctx.signal,
        ctx.stdoutIsTTY,
        ctx.executeArgv
      );

      exitCode = result.code ?? 0;
      if (ctx.hasExited) return;

      // 未ストリーム出力があれば書き込み
      if (result.output && result.output.length > 0) {
        const stream = exitCode !== 0 ? ctx.stderr : ctx.stdout;
        stream.write(String(result.output));
      }
    } catch (error: unknown) {
      if (ctx.hasExited) return;
      if (error instanceof SilentCommandError) {
        exitCode = error.code;
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.stderr.write(`${msg}\n`);
        exitCode = 1;
      }
    }

    ctx.stdout.end();
    ctx.stderr.end();

    // 非ゼロ終了時は例外を投げてシェルに伝播
    if (exitCode !== 0) {
      throw new SilentCommandError(exitCode);
    }
  };
};

/**
 * unixからビルトインコマンドを生成
 */
export default function adaptUnixToStream(unix: UnixCommands): Record<string, StreamBuiltin> {
  const obj: Record<string, StreamBuiltin> = {};

  for (const cmd of UNIX_COMMANDS) {
    obj[cmd] = makeUnixBridge(cmd);
  }

  // test/[ ビルトイン - TestCommandに委譲
  const evaluateTest = async (ctx: StreamCtx, args: string[] = []) => {
    try {
      const ok = await unix.test(args);
      if (!ok) {
        throw new SilentCommandError(1);
      }
      ctx.stdout.end();
    } catch (error: unknown) {
      ctx.stdout.end();
      if (error instanceof UnixCommandFailure) {
        ctx.stderr.write(`${error.message}\n`);
        throw new SilentCommandError(error.code);
      }
      throw error;
    }
  };

  obj['['] = evaluateTest;
  obj.test = evaluateTest;
  obj.true = async (ctx: StreamCtx) => {
    ctx.stdout.end();
  };
  obj.false = async (ctx: StreamCtx) => {
    ctx.stdout.end();
    throw new SilentCommandError(1);
  };

  // type コマンド（シェル内部）
  obj.type = async (ctx: StreamCtx, args: string[] = []) => {
    const opts = { a: false, t: false, p: false };
    const names: string[] = [];

    for (const a of args) {
      if (a?.startsWith('-') && a.length > 1) {
        for (let i = 1; i < a.length; i++) {
          const ch = a[i];
          if (ch === 'a') opts.a = true;
          else if (ch === 't') opts.t = true;
          else if (ch === 'p') opts.p = true;
        }
      } else {
        names.push(a);
      }
    }

    if (names.length === 0) {
      throw new Error('type: missing operand');
    }

    for (const name of names) {
      const isBuiltin = !!obj[name];
      const isUnixFn = UNIX_COMMANDS.some(command => command === name);

      if (opts.t) {
        if (isBuiltin) {
          ctx.stdout.write('builtin\n');
        } else if (isUnixFn) {
          ctx.stdout.write('file\n');
        } else {
          throw new Error(`type: not found: ${name}`);
        }
        continue;
      }

      if (opts.a) {
        let found = false;
        if (isBuiltin) {
          ctx.stdout.write(`${name} is a shell builtin\n`);
          found = true;
        }
        if (isUnixFn) {
          if (opts.p) {
            ctx.stdout.write(`${name}\n`);
          } else {
            ctx.stdout.write(`${name} is a shell command\n`);
          }
          found = true;
        }
        if (!found) throw new Error(`type: not found: ${name}`);
        continue;
      }

      if (isBuiltin) {
        ctx.stdout.write(`${name} is a shell builtin\n`);
      } else if (isUnixFn) {
        if (opts.p) {
          ctx.stdout.write(`${name}\n`);
        } else {
          ctx.stdout.write(`${name} is a shell command\n`);
        }
      } else {
        throw new Error(`type: not found: ${name}`);
      }
    }
    ctx.stdout.end();
  };

  // node コマンド（NodeRuntime実行）
  obj.node = async (ctx: StreamCtx, args: string[] = []) => {
    // Support version flags: `node -v` or `node --version`
    if (args.length >= 1 && (args[0] === '-v' || args[0] === '--version')) {
      ctx.stdout.write('v18.0.0 (custom build)\n');
      ctx.stdout.end();
      ctx.stderr.end();
      return;
    }

    const evalMode = args[0] === '-e' || args[0] === '--eval';
    if (args[0]?.startsWith('-') && !evalMode) {
      ctx.stderr.write(`node: bad option: ${args[0]}\n`);
      ctx.stdout.end();
      ctx.stderr.end();
      throw new SilentCommandError(9);
    }
    if (args.length === 0 || (evalMode && args.length < 2)) {
      ctx.stderr.write('Usage: node <file.js> | node -e <script>\n');
      ctx.stdout.end();
      ctx.stderr.end();
      throw new SilentCommandError(2);
    }

    try {
      const rootPath = ctx.rootPath;

      // デバッグコンソールを設定（即座に出力、バッファリングなし）
      const debugConsole = {
        log: (...args: unknown[]) => {
          if (ctx.hasExited) return;
          const output = `${args
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ')}\n`;
          ctx.stdout.write(output);
        },
        error: (...args: unknown[]) => {
          if (ctx.hasExited) return;
          const output = args
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ');
          ctx.stderr.write(`${output}\n`);
        },
        warn: (...args: unknown[]) => {
          if (ctx.hasExited) return;
          const output = args
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ');
          ctx.stdout.write(`${output}\n`);
        },
        clear: () => {
          // Terminal clearは別途処理
        },
      };

      // パスを解決（相対パス対応）
      let cwd = rootPath;
      if (unix) {
        cwd = await unix.pwd();
      }
      let entryName = args[0];
      if (evalMode) entryName = '[eval]';
      const entryPath = resolvePath(cwd, entryName);
      let argv = args.slice(1);
      let execArgv: string[] = [];
      let source: string | undefined;
      if (evalMode) {
        source = args[1];
        execArgv = [args[0], source];
        argv = args.slice(2);
        if (argv[0] === '--') argv = argv.slice(1);
      }

      const runtime = runtimeRegistry.getRuntime('nodejs');
      if (!runtime) throw new Error('Node.js runtime provider is unavailable.');
      const result = await runtime.execute({
        rootPath,
        cwd,
        filePath: entryPath,
        source,
        execArgv,
        env: ctx.env,
        argv,
        subscribeInterrupt: handler =>
          ctx.onSignal(
            signal => {
              if (signal === 'SIGINT') handler();
            },
            ['SIGINT']
          ),
        signal: ctx.signal,
        debugConsole,
        processStdin: ctx.processStdin,
        stdoutIsTTY: ctx.stdoutIsTTY,
        stderrIsTTY: ctx.stderrIsTTY,
        terminalColumns: ctx.terminalColumns,
        terminalRows: ctx.terminalRows,
        onStdout: output => {
          if (!ctx.hasExited) ctx.stdout.write(output);
        },
        onStderr: output => {
          if (!ctx.hasExited) ctx.stderr.write(output);
        },
      });
      if (ctx.hasExited) return;
      if (result.stderr) ctx.stderr.write(result.stderr);
      const exitCode = result.exitCode ?? 0;

      ctx.stdout.end();
      ctx.stderr.end();

      if (exitCode !== 0) {
        throw new SilentCommandError(exitCode);
      }
    } catch (error: unknown) {
      if (ctx.hasExited) return;
      if (error instanceof SilentCommandError) {
        ctx.stdout.end();
        ctx.stderr.end();
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      ctx.stderr.write(`node: error: ${msg}\n`);
      ctx.stdout.end();
      ctx.stderr.end();
      throw new SilentCommandError(1);
    }
  };

  return obj;
}
