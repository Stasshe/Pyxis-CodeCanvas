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
export default function adaptUnixToStream(unix: any) {
  const obj: Record<string, any> = {};

  obj.echo = async (ctx: StreamCtx, args: string[]) => {
    const text = args.join(' ');
    ctx.stdout.write(String(text));
    ctx.stdout.end();
  };

  obj.cat = async (ctx: StreamCtx, args: string[]) => {
    if (!args || args.length === 0) {
      // stream stdin to stdout
      const src = ctx.stdin as unknown as Readable;
      src.pipe(ctx.stdout as unknown as Writable);
      src.on('end', () => ctx.stdout.end());
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

  obj.pwd = async (ctx: StreamCtx) => {
    try {
      const p = await unix.pwd();
      ctx.stdout.write(String(p));
    } catch (e: any) {
      ctx.stderr.write(String(e && e.message ? e.message : e));
    }
    ctx.stdout.end();
  };

  obj.ls = async (ctx: StreamCtx, args: string[]) => {
    try {
      const out = await unix.ls(args && args[0]);
      ctx.stdout.write(String(out));
    } catch (e: any) {
      ctx.stderr.write(String(e && e.message ? e.message : e));
    }
    ctx.stdout.end();
  };

  obj.cd = async (ctx: StreamCtx, args: string[]) => {
    try {
      const msg = await unix.cd(args && args[0] ? args[0] : '/');
      if (msg) ctx.stdout.write(String(msg));
    } catch (e: any) {
      ctx.stderr.write(String(e && e.message ? e.message : e));
    }
    ctx.stdout.end();
  };

  obj.head = async (ctx: StreamCtx, args: string[]) => {
    try {
      if (!args || args.length === 0) {
        // read from stdin
        const buf: string[] = [];
        const src = ctx.stdin as unknown as Readable;
        for await (const ch of src) buf.push(String(ch));
        const out = buf.join('').split('\n').slice(0, 10).join('\n');
        ctx.stdout.write(out);
      } else {
        // support '-n 5' and '-n5' forms
        let n = 10;
        let fileArg: string | undefined;
        // find explicit -n option
        const nIndex = args.findIndex(a => a === '-n' || a.startsWith('-n'));
        if (nIndex !== -1) {
          const nOpt = args[nIndex];
          if (nOpt === '-n') {
            n = parseInt(args[nIndex + 1]) || 10;
          } else {
            n = parseInt(nOpt.replace('-n', '')) || 10;
          }
        }
        // find file arg (first non-option)
        const nonOpts = args.filter(a => !a.startsWith('-'));
        fileArg = nonOpts[0];
        const out = await unix.head(fileArg, n);
        ctx.stdout.write(String(out));
      }
    } catch (e: any) {
      ctx.stderr.write(String(e && e.message ? e.message : e));
    }
    ctx.stdout.end();
  };

  obj.tail = async (ctx: StreamCtx, args: string[]) => {
    try {
      if (!args || args.length === 0) {
        const buf: string[] = [];
        const src = ctx.stdin as unknown as Readable;
        for await (const ch of src) buf.push(String(ch));
        const out = buf.join('').split('\n').slice(-10).join('\n');
        ctx.stdout.write(out);
      } else {
        // support '-n 5' and '-n5' forms
        let n = 10;
        let fileArg: string | undefined;
        const nIndex = args.findIndex(a => a === '-n' || a.startsWith('-n'));
        if (nIndex !== -1) {
          const nOpt = args[nIndex];
          if (nOpt === '-n') {
            n = parseInt(args[nIndex + 1]) || 10;
          } else {
            n = parseInt(nOpt.replace('-n', '')) || 10;
          }
        }
        const nonOpts = args.filter(a => !a.startsWith('-'));
        fileArg = nonOpts[0];
        const out = await unix.tail(fileArg, n);
        ctx.stdout.write(String(out));
      }
    } catch (e: any) {
      ctx.stderr.write(String(e && e.message ? e.message : e));
    }
    ctx.stdout.end();
  };

  obj.grep = async (ctx: StreamCtx, args: string[]) => {
    try {
      if (!args || args.length === 0) {
        ctx.stderr.write('grep: missing pattern');
        ctx.stderr.end();
        ctx.stdout.end();
        return;
      }
      const pattern = args[0];
      const files = args.slice(1);
      if (files.length === 0) {
        const buf: string[] = [];
        const src = ctx.stdin as unknown as Readable;
        for await (const ch of src) buf.push(String(ch));
        const joined = buf.join('');
        const regex = new RegExp(pattern);
        const lines = joined.split('\n').filter(l => regex.test(l));
        if (lines.length === 0) {
          // no match -> signal non-zero exit by throwing with silent message
          throw { message: '', code: 1 };
        }
        ctx.stdout.write(lines.join('\n'));
      } else {
        const out = await unix.grep(pattern, files);
        if (!out || String(out).length === 0) throw { message: '', code: 1 };
        ctx.stdout.write(String(out));
      }
    } catch (e: any) {
      // If this is a silent exit-code signal (we threw {code: N}), rethrow so
      // the caller (createProcessForSegment) can set the process exit code.
      if (e && typeof e.code === 'number') throw e;
      // otherwise write error message if present
      const msg = (e && e.message) ? String(e.message) : '';
      if (msg) ctx.stderr.write(msg);
    }
    ctx.stdout.end();
  };

  return obj;
}
