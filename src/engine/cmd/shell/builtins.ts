import { Writable } from 'stream';

import handleUnixCommand from '../handlers/unixHandler';

export type StreamCtx = {
  stdin: Writable;
  stdout: Writable;
  stderr: Writable;
  onSignal: (fn: (sig: string) => void) => void;
  projectName?: string;
  projectId?: string;
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
      const stdinContent = await new Promise<string | null>(resolve => {
        if (!ctx.stdin || typeof (ctx.stdin as any).on !== 'function') {
          return resolve(null);
        }

        let buf = '';
        const src = ctx.stdin as any;
        let resolved = false;

        const finish = (content: string | null) => {
          if (resolved) return;
          resolved = true;
          resolve(content);
        };

        src.on('data', (c: any) => {
          buf += String(c);
        });
        src.on('end', () => finish(buf || null));
        src.on('close', () => finish(buf || null));

        // タイムアウト（stdin無し判定）
        setTimeout(() => finish(buf || null), 50);
      });

      const result = await handleUnixCommand(
        name,
        nArgs,
        projectName,
        projectId,
        writeOutput,
        stdinContent
      );

      exitCode = result.code ?? 0;

      // 未ストリーム出力があれば書き込み
      if (result.output && result.output.length > 0) {
        const stream = exitCode !== 0 ? ctx.stderr : ctx.stdout;
        stream.write(String(result.output));
      }
    } catch (e: any) {
      if (e && e.__silent) {
        exitCode = typeof e.code === 'number' ? e.code : 1;
      } else {
        const msg = e && e.message ? String(e.message) : String(e);
        ctx.stderr.write(msg + '\n');
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

  // 全てunixHandlerに統一委譲
  const commands = [
    'echo',
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
  ];

  for (const cmd of commands) {
    obj[cmd] = makeUnixBridge(cmd);
  }

  // test/[ ビルトイン（シェル内部実装が必要）
  const evaluateTest = async (ctx: StreamCtx, args: string[] = []) => {
    try {
      if (args.length > 0 && args[args.length - 1] === ']') {
        args = args.slice(0, -1);
      }

      let ok = false;

      if (args.length === 0) {
        ok = false;
      } else if (args.length === 1) {
        ok = String(args[0]).length > 0;
      } else if (args.length === 2) {
        const op = args[0];
        const val = args[1];

        if (op === '-n') ok = String(val).length > 0;
        else if (op === '-z') ok = String(val).length === 0;
        else if (op === '-f' || op === '-d') {
          if (typeof unix?.stat === 'function') {
            try {
              const st = await unix.stat(String(val)).catch(() => null);
              if (st) {
                if (op === '-f') {
                  ok =
                    typeof st === 'object'
                      ? !(st as any).isDirectory && (st as any).type !== 'directory'
                      : true;
                } else {
                  ok =
                    typeof st === 'object'
                      ? (st as any).isDirectory || (st as any).type === 'directory'
                      : true;
                }
              }
            } catch (e) {
              ok = false;
            }
          }
        }
      } else if (args.length >= 3) {
        const a = args[0];
        const op = args[1];
        const b = args[2];

        if (op === '=' || op === '==') ok = String(a) === String(b);
        else if (op === '!=') ok = String(a) !== String(b);
        else if (['-eq', '-ne', '-gt', '-lt', '-ge', '-le'].includes(op)) {
          const na = Number(a);
          const nb = Number(b);
          if (!Number.isNaN(na) && !Number.isNaN(nb)) {
            switch (op) {
              case '-eq':
                ok = na === nb;
                break;
              case '-ne':
                ok = na !== nb;
                break;
              case '-gt':
                ok = na > nb;
                break;
              case '-lt':
                ok = na < nb;
                break;
              case '-ge':
                ok = na >= nb;
                break;
              case '-le':
                ok = na <= nb;
                break;
            }
          }
        }
      }

      if (!ok) {
        throw { __silent: true, code: 1 };
      }
      ctx.stdout.end();
    } catch (e: any) {
      ctx.stdout.end();
      if (e && e.__silent) throw e;
      throw e;
    }
  };

  obj['['] = evaluateTest;
  obj['test'] = evaluateTest;
  obj['true'] = async (ctx: StreamCtx) => {
    ctx.stdout.end();
  };

  // type コマンド（シェル内部）
  obj.type = async (ctx: StreamCtx, args: string[] = []) => {
    const opts = { a: false, t: false, p: false };
    const names: string[] = [];

    for (const a of args) {
      if (a && a.startsWith('-') && a.length > 1) {
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

  return obj;
}
