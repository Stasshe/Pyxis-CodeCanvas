import { Writable, Readable } from 'stream';

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

  // Helper to create simple wrappers that call unix.<cmd>(...args) and write the
  // returned string (if any) to stdout, with basic error handling.
  const makeSimple = (name: string) => {
    return async (ctx: StreamCtx, args: string[] = []) => {
      try {
        // some unix implementations accept a single joined string (e.g. mock echo)
        // while others accept multiple args. If the implementation's arity is
        // <= 1 we pass the joined args as a single parameter; otherwise spread.
        let res: any;
        const fn = unix[name];
        if (typeof fn === 'function' && (fn.length || 0) <= 1) {
          const joined = args && args.length > 0 ? args.join(' ') : '';
          res = await fn.call(unix, joined);
        } else {
          res = await fn.apply(unix, args || []);
        }
        if (res !== undefined && res !== null) ctx.stdout.write(String(res));
      } catch (e: any) {
        ctx.stderr.write(String(e && e.message ? e.message : e));
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
      if (args.length === 0) {
        ok = false;
      } else if (args.length === 1) {
        ok = String(args[0]).length > 0;
      } else if (args.length === 2 && args[0] === '-n') {
        ok = String(args[1]).length > 0;
      } else if (args.length >= 3 && args[1] === '!=') {
        ok = String(args[0]) !== String(args[2]);
      } else if (args.length >= 3 && args[1] === '=') {
        ok = String(args[0]) === String(args[2]);
      } else {
        // unsupported: fall back to false
        ok = false;
      }
      if (!ok) {
        // signal non-zero exit without emitting stderr text
        const e: any = new Error('');
        (e as any).code = 1;
        throw e;
      }
      ctx.stdout.end();
    } catch (e: any) {
      ctx.stdout.end();
      // propagate error to caller (adapter will handle exit code)
      throw e;
    }
  };
  obj['['] = evaluateTest;
  obj['test'] = evaluateTest;

  // cat: if no args -> stream stdin to stdout; otherwise read file via unix.cat
  if (typeof unix.cat === 'function') {
    obj.cat = async (ctx: StreamCtx, args: string[] = []) => {
      if (!args || args.length === 0) {
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
        const content = await unix.cat(args[0]);
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
        const nIndex = args ? args.findIndex(a => a === '-n' || a.startsWith('-n')) : -1;
        if (nIndex !== -1) {
          const nOpt = args[nIndex];
          if (nOpt === '-n') {
            n = parseInt(args[nIndex + 1]) || 10;
          } else {
            n = parseInt(nOpt.replace('-n', '')) || 10;
          }
        }
        const nonOpts: string[] = [];
        if (args && args.length > 0) {
          for (let i = 0; i < args.length; i++) {
            const a = args[i];
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
        const nIndex = args ? args.findIndex(a => a === '-n' || a.startsWith('-n')) : -1;
        if (nIndex !== -1) {
          const nOpt = args[nIndex];
          if (nOpt === '-n') {
            n = parseInt(args[nIndex + 1]) || 10;
          } else {
            n = parseInt(nOpt.replace('-n', '')) || 10;
          }
        }
        const nonOpts: string[] = [];
        if (args && args.length > 0) {
          for (let i = 0; i < args.length; i++) {
            const a = args[i];
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
    obj.grep = async (ctx: StreamCtx, args: string[] = []) => {
      try {
        if (!args || args.length === 0) {
          ctx.stderr.write('grep: missing pattern');
          ctx.stderr.end();
          ctx.stdout.end();
          return;
        }
        const opts = args.filter(a => a.startsWith('-'));
        const nonOpts = args.filter(a => !a.startsWith('-'));
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
