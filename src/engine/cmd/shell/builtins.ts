import { Writable, Readable } from 'stream';
import handleUnixCommand from '../handlers/unixHandler';

export type StreamCtx = {
  stdin: Writable;
  stdout: Writable; // we'll write buffers/strings
  stderr: Writable;
  onSignal: (fn: (sig: string) => void) => void;
  projectName?: string;
  projectId?: string;
};

// adapt a unix-like implementation (promise-based helpers) into stream-friendly builtins
// This refactor reduces duplication by auto-wrapping simple unix methods and
// keeping specialized stream-aware implementations for commands that need them.
export default function adaptUnixToStream(unix: any) {
  const obj: Record<string, any> = {};

  // Normalize mixed-token args into plain strings. Tokens may be strings or
  // objects like { text, quote, cmdSub } produced by the shell tokenizer.
  // Additionally expand grouped short flags (e.g. -rf -> -r, -f) so option
  // detection is robust.
  const normalizeArgs = (args?: Array<string | { text?: string }>): string[] => {
    if (!args || args.length === 0) return [];
    const flat = args.map(a => {
      if (typeof a === 'string') return a;
      if (a && typeof a === 'object' && 'text' in a && typeof (a as any).text === 'string') return (a as any).text;
      return String(a);
    });
    // expand grouped short flags like -rf into ['-r','-f'] but keep options
    // with attached values (-n10) intact
    const expanded: string[] = [];
    for (const token of flat) {
      if (!token || typeof token !== 'string') continue;
      if (token.startsWith('--') || !token.startsWith('-') || token === '-') {
        expanded.push(token);
        continue;
      }
      // token starts with single '-' and has multiple letters (grouped flags) or may be like -n10
      if (token.length > 2 && !/^-n\d+/i.test(token)) {
        // split into individual short flags like -r -f -x
        const chars = token.slice(1).split('');
        for (const ch of chars) expanded.push(`-${ch}`);
      } else {
        expanded.push(token);
      }
    }
    return expanded;
  };

  // Helper to create simple wrappers that call unix.<cmd>(...args) and write the
  // returned string (if any) to stdout, with basic error handling.
  const makeSimple = (name: string) => {
    return async (ctx: StreamCtx, args: Array<string | { text?: string }> = []) => {
      // Delegate to central unix handler to keep option parsing and behavior
      // consistent with other code paths (unixHandler). For stream-aware
      // commands (cat/head/tail/grep) we keep specialized implementations
      // elsewhere in this file.
      const nArgs = normalizeArgs(args || []);
      let streamed = false;
      const writeOutput = async (s: string) => {
        if (s === undefined || s === null) return;
        streamed = true;
        try {
          ctx.stdout.write(String(s));
        } catch (e) {
          // ignore
        }
      };
      try {
        const projectName = ctx.projectName || '';
        const projectId = ctx.projectId || '';
        const result = await handleUnixCommand(name, nArgs, projectName, projectId, writeOutput);
        // If handler didn't stream but returned output, write it
        if (!streamed && result && result.output) {
          ctx.stdout.write(String(result.output));
        }
        // Respect handler exit semantics; errors are surfaced via stderr
      } catch (e: any) {
        const msg = e && e.message ? String(e.message) : String(e);
        ctx.stderr.write(msg);
      }
      ctx.stdout.end();
    };
  };

  // Bind common simple commands
  for (const cmd of [
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
  ]) {
    if (typeof unix[cmd] === 'function') {
      obj[cmd] = makeSimple(cmd);
    }
  }

  // Provide '[' and 'test' builtin to evaluate simple conditional expressions.
  // Supports patterns used in run-test.sh: [ -n STRING ] and [ A != B ] and [ STRING ]
  const evaluateTest = async (ctx: StreamCtx, args: string[] = []) => {
    try {
      // strip trailing ']' if present
      if (args.length > 0 && args[args.length - 1] === ']') args = args.slice(0, -1);
      let ok = false;
      // Common unary tests
      if (args.length === 0) {
        ok = false;
      } else if (args.length === 1) {
        // [ STRING ] -> true if non-empty
        ok = String(args[0]).length > 0;
      } else if (args.length === 2) {
        // -n STRING  or -z STRING or unary file tests
        const op = args[0];
        const val = args[1];
        if (op === '-n') ok = String(val).length > 0;
        else if (op === '-z') ok = String(val).length === 0;
        else if (op === '-f' || op === '-d') {
          // file/directory test via unix.stat if available
          const path = String(val);
          if (typeof unix?.stat === 'function') {
            try {
              const st = await unix.stat(path).catch(() => null);
              // treat any non-null result as existence; if -d is requested and st.type exists, check
              if (st) {
                if (op === '-f') {
                  // prefer to check a 'type' or 'isDirectory' flag if present
                  if (typeof st === 'object') {
                    ok = !(st as any).isDirectory;
                    if ((st as any).type === 'file') ok = true;
                  } else {
                    ok = true;
                  }
                } else {
                  if (typeof st === 'object') {
                    ok = !!(st as any).isDirectory || (st as any).type === 'directory';
                  } else {
                    ok = true;
                  }
                }
              } else ok = false;
            } catch (e) {
              ok = false;
            }
          } else {
            ok = false;
          }
        } else {
          ok = false;
        }
      } else if (args.length >= 3) {
        // binary ops: string (=, !=) or numeric (-eq, -ne, -gt, -lt, -ge, -le)
        const a = args[0];
        const op = args[1];
        const b = args[2];
        if (op === '=' || op === '==') ok = String(a) === String(b);
        else if (op === '!=') ok = String(a) !== String(b);
        else if (op === '-eq' || op === '-ne' || op === '-gt' || op === '-lt' || op === '-ge' || op === '-le') {
          const na = Number(a);
          const nb = Number(b);
          if (Number.isNaN(na) || Number.isNaN(nb)) {
            ok = false;
          } else {
            switch (op) {
              case '-eq': ok = na === nb; break;
              case '-ne': ok = na !== nb; break;
              case '-gt': ok = na > nb; break;
              case '-lt': ok = na < nb; break;
              case '-ge': ok = na >= nb; break;
              case '-le': ok = na <= nb; break;
            }
          }
        } else {
          // unsupported operators fall back to false
          ok = false;
        }
      }
      if (!ok) {
        // signal non-zero exit without emitting stderr text
        throw { __silent: true, code: 1 } as any;
      }
      ctx.stdout.end();
    } catch (e: any) {
      ctx.stdout.end();
      // propagate silent failure marker if present, otherwise rethrow
      if (e && e.__silent) throw e;
      throw e;
    }
  };
  obj['['] = evaluateTest;
  obj['test'] = evaluateTest;

  // true: do nothing and succeed (POSIX semantics)
  obj.true = async (ctx: StreamCtx, _args: string[] = []) => {
    // no output, successful exit
    ctx.stdout.end();
  };

  // type: identify how a name would be interpreted by the shell.
  // Support common flags: -t (print a single word type), -a (all matches), -p (print path-like info when possible)
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
          // ignore unknown flags for now (shells often return usage)
        }
      } else {
        names.push(a);
      }
    }
    if (names.length === 0) {
      throw new Error('type: missing operand');
    }

    for (const name of names) {
      // collect possible matches in order: builtin -> unix-provided command
      const isBuiltin = !!obj[name];
      const isUnixFn = !!(unix && typeof unix[name] === 'function');

      if (opts.t) {
        if (isBuiltin) {
          ctx.stdout.write('builtin\n');
        } else if (isUnixFn) {
          // treat unix-provided commands as "file" for -t semantics
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
          // we don't have a real filesystem PATH to resolve, so print a descriptive line
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

      // default single-name behavior: print a single descriptive line
      if (isBuiltin) {
        ctx.stdout.write(`${name} is a shell builtin\n`);
      } else if (isUnixFn) {
        if (opts.p) {
          // best-effort: print the name as a path-like hint since we don't have PATH lookup
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

  // cat: if no args -> stream stdin to stdout; otherwise read file via unix.cat
  if (typeof unix.cat === 'function') {
    obj.cat = async (ctx: StreamCtx, args: Array<string | { text?: string }> = []) => {
      const nArgs = normalizeArgs(args);
      if (!nArgs || nArgs.length === 0) {
        // stream stdin -> stdout preserving streaming semantics
        const src = ctx.stdin as unknown as Readable;
        // pipe will end stdout by default when src ends
        try {
          src.pipe(ctx.stdout as unknown as Writable);
          src.on('end', () => ctx.stdout.end());
        } catch (e: any) {
          ctx.stderr.write(String(e && e.message ? e.message : e));
          ctx.stdout.end();
        }
        return;
      }
      try {
        const content = await unix.cat(nArgs[0]);
        ctx.stdout.write(String(content));
      } catch (e: any) {
        ctx.stderr.write(String(e && e.message ? e.message : e));
      }
      ctx.stdout.end();
    };
  }

  // head/tail: keep stream-aware implementations because they can read from stdin
  if (typeof unix.head === 'function') {
    obj.head = async (ctx: StreamCtx, args: string[] = []) => {
      try {
        let n = 10;
        const nArgs = normalizeArgs(args);
        const nIndex = nArgs ? nArgs.findIndex(a => a === '-n' || a.startsWith('-n')) : -1;
        if (nIndex !== -1) {
          const nOpt = nArgs[nIndex];
          if (nOpt === '-n') {
            n = parseInt(nArgs[nIndex + 1]) || 10;
          } else {
            n = parseInt(nOpt.replace('-n', '')) || 10;
          }
        }
        const nonOpts: string[] = [];
        if (nArgs && nArgs.length > 0) {
          for (let i = 0; i < nArgs.length; i++) {
            const a = nArgs[i];
            if (a === '-n') { i++; continue; }
            if (a.startsWith('-n') && a.length > 2) continue;
            if (a.startsWith('-')) continue;
            nonOpts.push(a);
          }
        }
        if (!nonOpts || nonOpts.length === 0) {
          const buf: string[] = [];
          const src = ctx.stdin as unknown as Readable;
          for await (const ch of src) buf.push(String(ch));
          const out = buf.join('').split('\n').slice(0, n).join('\n');
          ctx.stdout.write(out);
        } else {
          const fileArg = nonOpts[0];
          const out = await unix.head(fileArg, n);
          ctx.stdout.write(String(out));
        }
      } catch (e: any) {
        ctx.stderr.write(String(e && e.message ? e.message : e));
      }
      ctx.stdout.end();
    };
  }

  if (typeof unix.tail === 'function') {
    obj.tail = async (ctx: StreamCtx, args: string[] = []) => {
      try {
        let n = 10;
        const nArgs = normalizeArgs(args);
        const nIndex = nArgs ? nArgs.findIndex(a => a === '-n' || a.startsWith('-n')) : -1;
        if (nIndex !== -1) {
          const nOpt = nArgs[nIndex];
          if (nOpt === '-n') {
            n = parseInt(nArgs[nIndex + 1]) || 10;
          } else {
            n = parseInt(nOpt.replace('-n', '')) || 10;
          }
        }
        const nonOpts: string[] = [];
        if (nArgs && nArgs.length > 0) {
          for (let i = 0; i < nArgs.length; i++) {
            const a = nArgs[i];
            if (a === '-n') { i++; continue; }
            if (a.startsWith('-n') && a.length > 2) continue;
            if (a.startsWith('-')) continue;
            nonOpts.push(a);
          }
        }
        if (!nonOpts || nonOpts.length === 0) {
          const buf: string[] = [];
          const src = ctx.stdin as unknown as Readable;
          for await (const ch of src) buf.push(String(ch));
          const out = buf.join('').split('\n').slice(-n).join('\n');
          ctx.stdout.write(out);
        } else {
          const fileArg = nonOpts[0];
          const out = await unix.tail(fileArg, n);
          ctx.stdout.write(String(out));
        }
      } catch (e: any) {
        ctx.stderr.write(String(e && e.message ? e.message : e));
      }
      ctx.stdout.end();
    };
  }

  if (typeof unix.grep === 'function') {
    obj.grep = async (ctx: StreamCtx, args: Array<string | { text?: string }> = []) => {
      try {
        const nArgs = normalizeArgs(args);
        if (!nArgs || nArgs.length === 0) {
          ctx.stderr.write('grep: missing pattern');
          ctx.stderr.end();
          ctx.stdout.end();
          return;
        }
        const opts = nArgs.filter(a => a.startsWith('-'));
        const nonOpts = nArgs.filter(a => !a.startsWith('-'));
        const pattern = nonOpts[0];
        const files = nonOpts.slice(1);
        if (!pattern) {
          ctx.stderr.write('grep: missing pattern');
          ctx.stdout.end();
          return;
        }
        if (files.length === 0) {
          const buf: string[] = [];
          const src = ctx.stdin as unknown as Readable;
          for await (const ch of src) buf.push(String(ch));
          const joined = buf.join('');
          const regex = new RegExp(pattern);
          const lines = joined.split('\n').filter(l => regex.test(l));
          if (lines.length === 0) {
            throw { message: '', code: 1 };
          }
          ctx.stdout.write(lines.join('\n'));
        } else {
          const out = await unix.grep(pattern, files);
          if (!out || String(out).length === 0) throw { message: '', code: 1 };
          ctx.stdout.write(String(out));
        }
      } catch (e: any) {
        if (e && typeof e.code === 'number') throw e;
        const msg = (e && e.message) ? String(e.message) : '';
        if (msg) ctx.stderr.write(msg);
      }
      ctx.stdout.end();
    };
  }

  return obj;
}
