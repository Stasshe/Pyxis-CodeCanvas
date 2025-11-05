import { PassThrough, Readable, Writable } from 'stream';
import EventEmitter from 'events';

/**
 * Stream-based Shell
 * - Process abstraction with stdin/stdout/stderr as streams
 * - Pipeline support using stream.pipe
 * - Redirections: >, >>, < handled by shell (uses FileRepository when provided)
 * - Signal handling (SIGINT) via EventEmitter and Process.kill()
 * - Delegates filesystem commands to UnixCommands when available
 */

export type ProcExit = { code: number | null; signal?: string | null };

export class Process extends EventEmitter {
  public stdin: Writable;
  public stdout: Readable;
  public stderr: Readable;
  private _stdin: PassThrough;
  private _stdout: PassThrough;
  private _stderr: PassThrough;
  public pid: number;
  private exited = false;
  private exitPromise: Promise<ProcExit>;
  private resolveExit!: (r: ProcExit) => void;

  constructor() {
    super();
    this._stdin = new PassThrough();
    this._stdout = new PassThrough();
    this._stderr = new PassThrough();
    this.stdin = this._stdin as unknown as Writable;
    this.stdout = this._stdout as unknown as Readable;
    this.stderr = this._stderr as unknown as Readable;
    this.pid = Math.floor(Math.random() * 1e9);
    this.exitPromise = new Promise(resolve => {
      this.resolveExit = resolve;
    });
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
    this._stdout.write(chunk);
  }

  writeStderr(chunk: string | Buffer) {
    this._stderr.write(chunk);
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

  kill(signal: string = 'SIGINT') {
    // Emit the signal event so the running handler may react
    this.emit('signal', signal);
    // default behavior: mark as killed
    this.exit(null, signal);
  }
}

type ShellOptions = {
  projectName: string;
  projectId: string;
  unix?: any; // injection for tests
  fileRepository?: any; // injection for tests
  commandRegistry?: any;
};

type Segment = {
  raw: string;
  tokens: string[];
  stdinFile?: string | null;
  stdoutFile?: string | null;
  append?: boolean;
  background?: boolean;
};

export class StreamShell {
  private unix: any;
  private fileRepository: any;
  private projectName: string;
  private projectId: string;
  private commandRegistry: any;

  constructor(opts: ShellOptions) {
    this.projectName = opts.projectName;
    this.projectId = opts.projectId;
    this.unix = opts.unix || null;
    this.fileRepository = opts.fileRepository; // optional
    this.commandRegistry = opts.commandRegistry;
  }

  private async getUnix() {
    if (this.unix) return this.unix;
    const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
    this.unix = terminalCommandRegistry.getUnixCommands(this.projectName, this.projectId);
    return this.unix;
  }

  // Split pipeline segments while respecting quotes
  private splitPipes(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inS = false;
    let inD = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inD) {
        inS = !inS;
        cur += ch;
      } else if (ch === '"' && !inS) {
        inD = !inD;
        cur += ch;
      } else if (ch === '|' && !inS && !inD) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim() !== '') out.push(cur.trim());
    return out;
  }

  // Basic tokenizer (strips outer quotes)
  private tokenize(s: string): string[] {
    const tokens: string[] = [];
    let cur = '';
    let inS = false;
    let inD = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "'" && !inD) {
        inS = !inS;
        continue;
      }
      if (ch === '"' && !inS) {
        inD = !inD;
        continue;
      }
      if (ch === ' ' && !inS && !inD) {
        if (cur !== '') {
          tokens.push(cur);
          cur = '';
        }
      } else {
        cur += ch;
      }
    }
    if (cur !== '') tokens.push(cur);
    return tokens;
  }

  // Parse a single segment for tokens and redirections
  private parseSegment(raw: string): Segment {
    const seg: Segment = { raw, tokens: [], stdinFile: null, stdoutFile: null, append: false, background: false };
    // Handle background symbol & at end
    let s = raw.trim();
    if (s.endsWith('&')) {
      seg.background = true;
      s = s.slice(0, -1).trim();
    }

    // parse redirections (<, >, >>) - simple approach: find them with regex
    // handle >> (append) first
    const appendMatch = s.match(/(.*)>>(\s*)([^\s]+)\s*$/);
    if (appendMatch) {
      s = appendMatch[1].trim();
      seg.stdoutFile = appendMatch[3];
      seg.append = true;
    } else {
      const outMatch = s.match(/(.*)>(\s*)([^\s]+)\s*$/);
      if (outMatch) {
        s = outMatch[1].trim();
        seg.stdoutFile = outMatch[3];
        seg.append = false;
      }
    }

    const inMatch = s.match(/(.*)<(\s*)([^\s]+)\s*$/);
    if (inMatch) {
      s = inMatch[1].trim();
      seg.stdinFile = inMatch[3];
    }

    seg.tokens = this.tokenize(s);
    return seg;
  }

  // Create a process for a segment. Handler can use streams and listen for 'signal' events.
  private async createProcessForSegment(seg: Segment): Promise<Process> {
    const proc = new Process();
    // lazily obtain unix commands if not injected
    const unix = await this.getUnix().catch(() => this.unix);

    // If stdinFile is provided, read it and pipe into proc.stdin
    if (seg.stdinFile && unix) {
      (async () => {
        try {
          const content = await unix.cat(seg.stdinFile).catch(() => '');
          if (content !== undefined && content !== null) {
            proc.stdin.write(String(content));
          }
        } catch (e) {}
        proc.stdin.end();
      })();
    }

    // Launch handler async
    (async () => {
      if (!seg.tokens || seg.tokens.length === 0) {
        proc.endStdout();
        proc.endStderr();
        proc.exit(0);
        return;
      }

      const cmd = seg.tokens[0];
      const args = seg.tokens.slice(1);

      // Provide a small context for handlers
      const ctx = {
        stdin: proc.stdin,
        stdout: proc.stdoutStream,
        stderr: proc.stderrStream,
        onSignal: (fn: (sig: string) => void) => proc.on('signal', fn),
        projectName: this.projectName,
        projectId: this.projectId,
      } as any;

      // Builtin implementations stream-aware
      try {
        // sh / bash => execute script file by reading and running lines sequentially
  if (cmd === 'sh' || cmd === 'bash') {
          if (args.length === 0) {
            proc.writeStderr('Usage: sh <file>\n');
            proc.endStdout();
            proc.exit(2);
            return;
          }
          const path = args[0];
          const content = await unix.cat(path).catch(() => null);
          if (content === null) {
            proc.writeStderr(`sh: ${path}: No such file\n`);
            proc.endStdout();
            proc.exit(1);
            return;
          }
          const lines = String(content).split('\n');
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const res = await this.run(line);
            // pipe stdout of subcommand into this proc's stdout
            if (res.stdout) proc.writeStdout(res.stdout);
            if (res.stderr) proc.writeStderr(res.stderr);
            if (res.code !== 0) {
              // continue executing by default (like /bin/sh) - not stopping
            }
          }
          proc.endStdout();
          proc.endStderr();
          proc.exit(0);
          return;
        }

        // Common builtins
        switch (cmd) {
          case 'echo': {
            const text = args.join(' ');
            proc.writeStdout(text + '\n');
            proc.endStdout();
            proc.exit(0);
            return;
          }
      case 'pwd': {
        const p = await unix.pwd();
            proc.writeStdout(p + '\n');
            proc.endStdout();
            proc.exit(0);
            return;
          }
          case 'cat': {
            if (args.length === 0) {
              // pipe stdin to stdout
              proc.stdinStream.pipe(proc.stdoutStream);
              proc.stdinStream.on('end', () => {
                proc.endStdout();
                proc.exit(0);
              });
              // ensure if signal, we exit
              proc.on('signal', () => {
                proc.exit(null, 'SIGINT');
              });
              return;
            }
            const out = await unix.cat(args[0]);
            proc.writeStdout(String(out));
            proc.endStdout();
            proc.exit(0);
            return;
          }
          case 'head': {
            if (args.length === 0) {
              // read stdin first 10 lines
              const buf: string[] = [];
              for await (const chunk of proc.stdinStream) {
                buf.push(String(chunk));
              }
              const text = buf.join('');
              const out = text.split('\n').slice(0, 10).join('\n');
              proc.writeStdout(out);
              proc.endStdout();
              proc.exit(0);
              return;
            }
            const nOpt = args.find(a => a.startsWith('-n'));
            let n = 10;
            let fileArg = args[0];
            if (nOpt) {
              n = parseInt(nOpt.replace('-n', '')) || 10;
              fileArg = args[1] || fileArg;
            }
            const out = await unix.head(fileArg, n);
            proc.writeStdout(out);
            proc.endStdout();
            proc.exit(0);
            return;
          }
          case 'tail': {
            if (args.length === 0) {
              const buf: string[] = [];
                for await (const chunk of proc.stdinStream) {
                  buf.push(String(chunk));
                }
              const text = buf.join('');
              const out = text.split('\n').slice(-10).join('\n');
              proc.writeStdout(out);
              proc.endStdout();
              proc.exit(0);
              return;
            }
            const nOpt = args.find(a => a.startsWith('-n'));
            let n = 10;
            let fileArg = args[0];
            if (nOpt) {
              n = parseInt(nOpt.replace('-n', '')) || 10;
              fileArg = args[1] || fileArg;
            }
            const out = await unix.tail(fileArg, n);
            proc.writeStdout(out);
            proc.endStdout();
            proc.exit(0);
            return;
          }
          case 'grep': {
            if (args.length === 0) {
              proc.writeStderr('grep: missing pattern\n');
              proc.endStdout();
              proc.exit(2);
              return;
            }
            const pattern = args[0];
            const files = args.slice(1);
            if (files.length === 0) {
              // operate on stdin
              const buf: string[] = [];
              for await (const chunk of proc.stdinStream) buf.push(String(chunk));
              const regex = new RegExp(pattern);
              const lines = buf.join('').split('\n').filter(l => regex.test(l));
              proc.writeStdout(lines.join('\n'));
              proc.endStdout();
              proc.exit(0);
              return;
            }
            const out = await unix.grep(pattern, files);
            proc.writeStdout(out);
            proc.endStdout();
            proc.exit(0);
            return;
          }
        }

        // Extension/registered command
        if (this.commandRegistry && this.commandRegistry.hasCommand && this.commandRegistry.hasCommand(cmd)) {
          try {
            const cwd = await unix.pwd();
            const res: any = await this.commandRegistry.executeCommand(cmd, args, {
              projectName: this.projectName,
              projectId: this.projectId,
              currentDirectory: cwd,
              stdin: proc.stdinStream,
              stdout: proc.stdoutStream,
              stderr: proc.stderrStream,
            });
            if (typeof res === 'string') proc.writeStdout(res);
            proc.endStdout();
            proc.endStderr();
            proc.exit(0);
            return;
          } catch (e: any) {
            proc.writeStderr(String(e.message || e));
            proc.endStdout();
            proc.endStderr();
            proc.exit(1);
            return;
          }
        }

        // Fallback to unix handler
        try {
          const { handleUnixCommand } = await import('../handlers/unixHandler');
          let captured = '';
          await handleUnixCommand(cmd, args, this.projectName, this.projectId, async (out: string) => {
            captured += out + '\n';
          });
          if (captured) proc.writeStdout(captured.trimEnd());
          proc.endStdout();
          proc.exit(0);
          return;
        } catch (e: any) {
          proc.writeStderr(`Command not found: ${cmd}\n`);
          proc.endStdout();
          proc.endStderr();
          proc.exit(127);
          return;
        }
      } catch (err: any) {
        proc.writeStderr(String(err.message || err));
        proc.endStdout();
        proc.endStderr();
        proc.exit(1);
        return;
      }
    })();

    return proc;
  }

  // Run full pipeline line and resolve final stdout/stderr and code
  async run(line: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    let segs: any[] = [];
    try {
      const parser = await import('./parser');
      segs = parser.parseCommandLine(line);
    } catch (e) {
      const pieces = this.splitPipes(line);
      segs = pieces.map(p => this.parseSegment(p));
    }
    const procs: Process[] = [];

    // create processes
    for (const seg of segs) {
      const p = await this.createProcessForSegment(seg);
      procs.push(p);
    }

    // wire up pipes: proc[i].stdout -> proc[i+1].stdin
    for (let i = 0; i < procs.length - 1; i++) {
      procs[i].stdout.pipe(procs[i + 1].stdin);
    }

    // Collect output from last process
    const last = procs[procs.length - 1];

    // If last has stdout redirection, capture and write to file when done
    const lastSeg = segs[segs.length - 1];

    const outChunks: string[] = [];
    last.stdout.on('data', (chunk: Buffer | string) => {
      outChunks.push(String(chunk));
    });
    const errChunks: string[] = [];
    last.stderr.on('data', (chunk: Buffer | string) => {
      errChunks.push(String(chunk));
    });

    const exits = await Promise.all(procs.map(p => p.wait()));

    const finalOut = outChunks.join('');
    const finalErr = errChunks.join('');

    // handle stdout redirection
    if (lastSeg.stdoutFile && this.fileRepository) {
      // resolve path relative to project (UnixCommands helpers can normalize)
      const targetPath = lastSeg.stdoutFile;
      try {
        const fullContent = finalOut;
        // read existing if append
        let contentToWrite = fullContent;
        if (lastSeg.append) {
          const files = await this.fileRepository.getProjectFiles(this.projectId);
          const existing = files.find((f: any) => f.path === targetPath || f.path === `/${targetPath}`);
          if (existing && existing.content) {
            contentToWrite = existing.content + contentToWrite;
          }
        }
        // create or save
        const files = await this.fileRepository.getProjectFiles(this.projectId);
        const existing = files.find((f: any) => f.path === targetPath || f.path === `/${targetPath}`);
        if (existing) {
          await this.fileRepository.saveFile({ ...existing, content: contentToWrite, updatedAt: new Date() });
        } else {
          await this.fileRepository.createFile(this.projectId, targetPath.startsWith('/') ? targetPath : `/${targetPath}`, contentToWrite, 'file');
        }
      } catch (e) {
        // ignore but include in stderr
      }
    }

    // return last exit code or first non-zero
    const code = exits.length ? exits[exits.length - 1].code : 0;
    return { stdout: finalOut, stderr: finalErr, code };
  }
}

export default StreamShell;
