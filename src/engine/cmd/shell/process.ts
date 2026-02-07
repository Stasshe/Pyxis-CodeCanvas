import EventEmitter from 'node:events';
import { PassThrough, type Readable, type Writable } from 'node:stream';

/**
 * Process - Stream-based process abstraction
 * Provides stdin/stdout/stderr streams and signal handling
 */
export type ProcExit = { code: number | null; signal?: string | null };

export class Process extends EventEmitter {
  public stdin: Writable;
  public stdout: Readable;
  public stderr: Readable;
  private _stdin: PassThrough;
  private _stdout: PassThrough;
  private _stderr: PassThrough;
  // map of additional file-descriptor write streams (1 and 2 point to stdout/stderr)
  private _fdMap: Map<number, PassThrough>;
  public pid: number;
  private exited = false;
  private exitPromise: Promise<ProcExit>;
  private resolveExit!: (r: ProcExit) => void;

  constructor() {
    super();
    this._stdin = new PassThrough();
    this._stdout = new PassThrough();
    this._stderr = new PassThrough();
    this._fdMap = new Map();
    // fd 1 -> stdout, fd 2 -> stderr
    this._fdMap.set(1, this._stdout);
    this._fdMap.set(2, this._stderr);
    this.stdin = this._stdin as unknown as Writable;
    this.stdout = this._stdout as unknown as Readable;
    this.stderr = this._stderr as unknown as Readable;
    this.pid = Math.floor(Math.random() * 1e9);
    this.exitPromise = new Promise(resolve => {
      this.resolveExit = resolve;
    });
  }

  // Return a writable stream for the given fd. Creates a PassThrough for unknown fds.
  getFdWrite(fd: number): PassThrough {
    if (!this._fdMap.has(fd)) {
      const p = new PassThrough();
      this._fdMap.set(fd, p);
    }
    return this._fdMap.get(fd)!;
  }

  // Duplicate fd 'from' to 'to' within this process (so writes to `from` go to same stream as `to`).
  // Also, if duplicating stdout/stderr, keep fd 3 (debug) in sync so debug output
  // can follow the primary output destination when desired.
  setFdDup(from: number, to: number) {
    const target = this.getFdWrite(to);
    this._fdMap.set(from, target);
    // if duplicating stdout or stderr, update the public streams so builtins
    // that write to ctx.stdout / ctx.stderr see the duplicated destination
    if (from === 1) {
      this._stdout = target;
      this.stdout = this._stdout as unknown as Readable;
      this._fdMap.set(1, target);
      // keep debug fd (3) pointing to same target by default
      this._fdMap.set(3, target);
    }
    if (from === 2) {
      this._stderr = target;
      this.stderr = this._stderr as unknown as Readable;
      this._fdMap.set(2, target);
      // keep debug fd (3) pointing to same target by default
      this._fdMap.set(3, target);
    }
  }

  // expose internal streams where needed
  get stdinStream() {
    return this._stdin;
  }

  get stdoutStream() {
    return this._stdout;
  }

  get stderrStream() {
    return this._stderr;
  }

  writeStdout(chunk: string | Buffer) {
    try {
      if (chunk === undefined || chunk === null) {
        this._stdout.write('');
      } else if (typeof chunk === 'object') {
        try {
          this._stdout.write(JSON.stringify(chunk));
        } catch (e) {
          this._stdout.write(String(chunk));
        }
      } else if (typeof chunk === 'string') {
        this._stdout.write(chunk);
      } else {
        this._stdout.write(String(chunk));
      }
    } catch (e) {
      try {
        this._stdout.write(String(chunk));
      } catch {}
    }
  }

  writeStderr(chunk: string | Buffer) {
    try {
      if (chunk === undefined || chunk === null) {
        this._stderr.write('');
      } else if (typeof chunk === 'object') {
        try {
          this._stderr.write(JSON.stringify(chunk));
        } catch (e) {
          this._stderr.write(String(chunk));
        }
      } else if (typeof chunk === 'string') {
        this._stderr.write(chunk);
      } else {
        this._stderr.write(String(chunk));
      }
    } catch (e) {
      try {
        this._stderr.write(String(chunk));
      } catch {}
    }
  }

  // Debug output channel. By default writes to fd 3 if it exists (so callers can redirect `3>`).
  // If fd 3 is not set, fall back to stderr with a `[debug] ` prefix for backward compatibility.
  // This is not POSIX standard, but a useful convention for internal debug logging.
  writeDebug(chunk: string | Buffer) {
    const fd = 3;
    // If fd 3 exists, write raw debug content there so callers can redirect `3>` to a file.
    if (this._fdMap.has(fd)) {
      const p = this._fdMap.get(fd)!;
      try {
        if (chunk === undefined || chunk === null) {
          p.write('');
        } else if (typeof chunk === 'string') {
          p.write(chunk);
        } else {
          try {
            p.write(JSON.stringify(chunk));
          } catch (e) {
            p.write(String(chunk));
          }
        }
      } catch (e) {
        try { p.write(String(chunk)); } catch {}
      }
      return;
    }

    // Fallback: stderr with a debug prefix
    if (chunk === undefined || chunk === null) return this.writeStderr('');
    if (typeof chunk === 'string') return this.writeStderr(`[debug] ${chunk}`);
    try {
      return this.writeStderr(`[debug] ${JSON.stringify(chunk)}`);
    } catch (e) {
      return this.writeStderr(`[debug] ${String(chunk)}`);
    }
  }

  endStdout() {
    this._stdout.end();
  }

  endStderr() {
    this._stderr.end();
  }

  async wait(): Promise<ProcExit> {
    return this.exitPromise;
  }

  exit(code: number | null = 0, signal: string | null = null) {
    if (this.exited) return;
    this.exited = true;
    // end streams
    try {
      this._stdin.end();
    } catch {}
    try {
      this._stdout.end();
    } catch {}
    try {
      this._stderr.end();
    } catch {}
    this.resolveExit({ code, signal });
    this.emit('exit', code, signal);
  }

  kill(signal = 'SIGINT') {
    // Emit the signal event so the running handler may react
    this.emit('signal', signal);
    // default behavior: mark as killed
    this.exit(null, signal);
  }
}
