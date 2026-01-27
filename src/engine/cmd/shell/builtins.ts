import type { Readable, Writable } from 'node:stream';

import handleUnixCommand from '../handlers/unixHandler';
import { UNIX_COMMANDS } from '@/engine/cmd/global/unix';

export type StreamCtx = {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  onSignal: (fn: (sig: string) => void) => void;
  projectName?: string;
  projectId?: string;
  /** Terminal columns (width) */
  terminalColumns?: number;
  /** Terminal rows (height) */
  terminalRows?: number;
};

// トークンを正規化（オブジェクト→文字列変換のみ、オプション展開は削除）
const normalizeArgs = (args?: Array<string | { text?: string }>): string[] => {
  if (!args || args.length === 0) return [];
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object' && 'text' in a && typeof (a as any).text === 'string')
      return (a as any).text;
    return String(a);
  });
};

/**
 * unixHandlerへの統一ブリッジ関数
 * ストリーム対応しながらunixHandlerの完全なロジックを活用
 */
const makeUnixBridge = (name: string) => {
  return async (ctx: StreamCtx, args: Array<string | { text?: string }> = []) => {
    const nArgs = normalizeArgs(args || []);
    let exitCode = 0;

    const writeOutput = async (s: string) => {
      if (s === undefined || s === null) return;
      try {
        ctx.stdout.write(String(s));
      } catch (e) {
        // ignore
      }
    };

    try {
      const projectName = ctx.projectName || '';
      const projectId = ctx.projectId || '';

      // stdin内容を事前に読み取り（grep等で必要）
      // Pass the stdin stream directly to the handler so commands like grep
      // can read from stdin interactively (block until data) if needed.
      const stdinStream =
        ctx.stdin && typeof (ctx.stdin as any).on === 'function' ? ctx.stdin : null;

      const writeError = async (s: string) => {
        try {
          if (s === undefined || s === null) return;
          ctx.stderr.write(String(s));
        } catch (e) {}
      };

      const result = await handleUnixCommand(
        name,
        nArgs,
        projectName,
        projectId,
        writeOutput,
        writeError,
        stdinStream
      );

      exitCode = result.code ?? 0;

      // 未ストリーム出力があれば書き込み
      if (result.output && result.output.length > 0) {
        const stream = exitCode !== 0 ? ctx.stderr : ctx.stdout;
        stream.write(String(result.output));
      }
    } catch (e: any) {
      if (e?.__silent) {
        exitCode = typeof e.code === 'number' ? e.code : 1;
      } else {
        const msg = e?.message ? String(e.message) : String(e);
        ctx.stderr.write(`${msg}\n`);
        exitCode = 1;
      }
    }

    ctx.stdout.end();
    ctx.stderr.end();

    // 非ゼロ終了時は例外を投げてシェルに伝播
    if (exitCode !== 0) {
      throw { __silent: true, code: exitCode };
    }
  };
};

/**
 * unixからビルトインコマンドを生成
 */
export default function adaptUnixToStream(unix: any) {
  const obj: Record<string, any> = {};

  for (const cmd of UNIX_COMMANDS) {
    obj[cmd] = makeUnixBridge(cmd);
  }

  // test/[ ビルトイン - TestCommandに委譲
  const evaluateTest = async (ctx: StreamCtx, args: string[] = []) => {
    try {
      const ok = await unix.test(args);
      if (!ok) {
        throw { __silent: true, code: 1 };
      }
      ctx.stdout.end();
    } catch (e: any) {
      ctx.stdout.end();
      if (e?.__silent) throw e;
      throw e;
    }
  };

  obj['['] = evaluateTest;
  obj.test = evaluateTest;
  obj.true = async (ctx: StreamCtx) => {
    ctx.stdout.end();
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
      const isUnixFn = !!(unix && typeof unix[name] === 'function');

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
        let any = false;
        if (isBuiltin) {
          ctx.stdout.write(`${name} is a shell builtin\n`);
          any = true;
        }
        if (isUnixFn) {
          if (opts.p) {
            ctx.stdout.write(`${name}\n`);
          } else {
            ctx.stdout.write(`${name} is a shell command\n`);
          }
          any = true;
        }
        if (!any) throw new Error(`type: not found: ${name}`);
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
      try {
        const ver = 'v18.0.0 (custom build)'; // バージョン番号を適宜設定
        ctx.stdout.write(`${String(ver)}\n`);
      } catch (e) {}
      ctx.stdout.end();
      ctx.stderr.end();
      return;
    }

    if (args.length === 0) {
      ctx.stderr.write('Usage: node <file.js>\n');
      ctx.stdout.end();
      ctx.stderr.end();
      throw { __silent: true, code: 2 };
    }

    try {
      // NodeRuntimeをdynamic importで読み込み
      const { NodeRuntime } = await import('../../runtime/nodeRuntime');

      // デバッグコンソールを設定（即座に出力、バッファリングなし）
      const debugConsole = {
        log: (...args: unknown[]) => {
          const output = `${args
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ')}\n`;
          // 即座にストリームに書き込む（バッファリングなし）
          try {
            ctx.stdout.write(output);
          } catch (e) {
            // ストリームが閉じていても無視（イベントループ完了後の出力）
          }
        },
        error: (...args: unknown[]) => {
          const output = args
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ');
          try {
            ctx.stderr.write(`${output}\n`);
          } catch (e) {}
        },
        warn: (...args: unknown[]) => {
          const output = args
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ');
          try {
            ctx.stdout.write(`${output}\n`);
          } catch (e) {}
        },
        clear: () => {
          // Terminal clearは別途処理
        },
      };

      // TODO: stdinに統合
      // 入力インターフェース（シンプルなダミー実装、将来的にstdin統合可能）
      const onInput = (promptText: string, callback: (input: string) => void) => {
        // streamShellではインタラクティブ入力は未対応
        // エラーを返すか、空文字列でcallback
        ctx.stderr.write(`node: interactive input not supported in streamShell\n`);
        callback('');
      };

      // パスを解決（相対パス対応）
      let entryPath = args[0];
      try {
        if (unix && typeof unix.pwd === 'function') {
          if (!entryPath.startsWith('/')) {
            const cwd = await unix.pwd();
            const combined = `${cwd.replace(/\/$/, '')}/${entryPath}`;
            entryPath =
              typeof unix.normalizePath === 'function' ? unix.normalizePath(combined) : combined;
          } else {
            entryPath =
              typeof unix.normalizePath === 'function' ? unix.normalizePath(entryPath) : entryPath;
          }
        }
      } catch (e) {
        // Fallback to original arg
        entryPath = args[0];
      }

      const runtime = new NodeRuntime({
        projectId: ctx.projectId || '',
        projectName: ctx.projectName || '',
        filePath: entryPath,
        debugConsole,
        onInput,
        terminalColumns: ctx.terminalColumns,
        terminalRows: ctx.terminalRows,
      });

      // NodeRuntimeを実行
      await runtime.execute(entryPath, args.slice(1));

      // ★ イベントループが空になるまで待つ（本物のNode.jsと同じ挙動）
      // setTimeout, Promise.thenなど、すべての非同期タスクが完了するまで自動的に待機
      await runtime.waitForEventLoop();

      // ストリームを閉じる
      ctx.stdout.end();
      ctx.stderr.end();
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e);
      ctx.stderr.write(`node: error: ${msg}\n`);
      ctx.stdout.end();
      ctx.stderr.end();
      throw { __silent: true, code: 1 };
    }
  };

  return obj;
}
