import { PassThrough, Readable, Writable } from 'stream';
import EventEmitter from 'events';
import expandBraces from './braceExpand';

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
  setFdDup(from: number, to: number) {
    const target = this.getFdWrite(to);
    this._fdMap.set(from, target);
    // if duplicating stdout or stderr, update the public streams so builtins
    // that write to ctx.stdout / ctx.stderr see the duplicated destination
    if (from === 1) {
      this._stdout = target;
      this.stdout = this._stdout as unknown as Readable;
      this._fdMap.set(1, target);
    }
    if (from === 2) {
      this._stderr = target;
      this.stderr = this._stderr as unknown as Readable;
      this._fdMap.set(2, target);
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

type TokenObj = { text: string; quote: 'single' | 'double' | null; cmdSub?: string };
type Segment = {
  raw: string;
  // tokens may be TokenObj (from parser) or plain strings (after splitting/globbing)
  tokens: Array<string | TokenObj>;
  stdinFile?: string | null;
  stdoutFile?: string | null;
  stderrFile?: string | null;
  stderrToStdout?: boolean;
  stdoutToStderr?: boolean;
  append?: boolean;
  background?: boolean;
};

export class StreamShell {
  private unix: any;
  private fileRepository: any;
  private projectName: string;
  private projectId: string;
  private commandRegistry: any;
  private foregroundProc: Process | null = null;

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

    // tokenize returns strings (quotes stripped); convert to TokenObj (unknown quote)
    seg.tokens = this.tokenize(s).map(t => ({ text: t, quote: null }));
    return seg;
  }

  // Create a process for a segment. Handler can use streams and listen for 'signal' events.
  private async createProcessForSegment(seg: Segment, originalLine?: string): Promise<Process> {
    const proc = new Process();
    // lazily obtain unix commands if not injected
    const unix = await this.getUnix().catch(() => this.unix);
    const adaptBuiltins = await import('./builtins').then(m => m.default).catch(() => null);
    const builtins = adaptBuiltins && unix ? adaptBuiltins(unix) : null;

    // apply any fd duplication mappings for this segment so that writes to
    // higher-numbered fds route to the intended target fds (e.g. 3>&1)
    if ((seg as any).fdDup && Array.isArray((seg as any).fdDup)) {
      for (const d of (seg as any).fdDup) {
        try {
          if (typeof d.from === 'number' && typeof d.to === 'number') {
            proc.setFdDup(d.from, d.to);
          }
        } catch (e) {}
      }
    }

    // Resolve command-substitution markers in tokens before launching handler.
    // parser now provides tokens as objects with optional cmdSub and quote.
    if (seg.tokens && seg.tokens.length > 0) {
      // debug: inspect incoming token shapes
  const withCmdSub: TokenObj[] = [];
  for (const tk of seg.tokens) {
        // tk may be a plain string or a TokenObj
        if (typeof tk !== 'string' && tk.cmdSub) {
          try {
            const subRes = await this.run(tk.cmdSub);
            const rawOut = String(subRes.stdout || '');
            
            // normalize command-substitution output: remove trailing newline(s)
            // and collapse internal newlines to spaces so quoted substitutions
            // remain a single word. This approximates POSIX behavior for
            // command-substitutions inside quotes.
            const normalized = rawOut.replace(/\r?\n/g, ' ').replace(/\s+$/g, '');
            // If substitution was quoted, preserve as single token
            if (tk.quote === 'single' || tk.quote === 'double') {
              withCmdSub.push({ text: normalized, quote: tk.quote });
            } else {
              // unquoted: place the substitution text (may be split later by IFS)
              withCmdSub.push({ text: rawOut, quote: null });
            }
            continue;
          } catch (e) {
            // on error, leave as empty
            withCmdSub.push({ text: '', quote: typeof tk === 'string' ? null : tk.quote });
            continue;
          }
        }
        // normalize plain strings to TokenObj
        if (typeof tk === 'string') withCmdSub.push({ text: tk, quote: null });
        else withCmdSub.push(tk);
      }
      seg.tokens = withCmdSub;
    }

    // Field splitting (IFS) and pathname expansion (glob)
    const ifs = (process.env.IFS ?? ' \t\n').replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    const isIfsWhitespace = /[ \t\n]/.test(ifs);

    const escapeForCharClass = (ch: string) => {
      // escape regex special chars inside character class
      if (ch === '\\') return '\\\\';
      if (ch === ']') return '\\]';
      if (ch === '-') return '\\-';
      if (ch === '^') return '\\^';
      return ch.replace(/([\\\]\-\^])/g, m => '\\' + m);
    };

    const splitOnIFS = (s: string): string[] => {
      if (!s) return [''];
      if (isIfsWhitespace) {
        // treat runs of whitespace as single separator and trim edges
        return s.split(/\s+/).filter(Boolean);
      }
      // split on any IFS char, preserve empty fields
      const chars = Array.from(new Set(ifs.split(''))).map(c => escapeForCharClass(c)).join('');
      const re = new RegExp('[' + chars + ']');
      return s.split(re).filter(x => x !== undefined);
    };

    const hasGlob = (s: string) => /[*?\[]/.test(s);

    // brace expansion handled by separate utility `expandBraces` imported above

    const globExpand = async (pattern: string): Promise<string[]> => {
      // Prefer unix.glob if available
      if (unix && typeof unix.glob === 'function') {
        try {
          const res = await unix.glob(pattern).catch(() => null);
          if (Array.isArray(res) && res.length > 0) return res;
        } catch (e) {}
      }
      // Fallback to fileRepository listing
      if (this.fileRepository && typeof this.fileRepository.getProjectFiles === 'function') {
        try {
          const files = await this.fileRepository.getProjectFiles(this.projectId);
          const names = files.map((f: any) => (f.path || '').replace(/^\//, ''));
          // convert simple glob pattern to regex (supports *, ?, [..])
              // convert simple glob pattern to regex (supports *, ?, [..]) safely
              const parts: string[] = [];
              for (let i = 0; i < pattern.length; i++) {
                const ch = pattern[i];
                if (ch === '*') {
                  parts.push('[^/]*');
                  continue;
                }
                if (ch === '?') {
                  parts.push('[^/]');
                  continue;
                }
                if (ch === '[') {
                  // consume until matching ]
                  let j = i + 1;
                  let cls = '';
                  while (j < pattern.length && pattern[j] !== ']') {
                    const c = pattern[j++];
                    // escape special inside class
                    if (c === '\\' || c === ']' || c === '-') cls += '\\' + c;
                    else cls += c;
                  }
                  // move i to closing bracket or end
                  i = Math.min(j, pattern.length - 1);
                  parts.push('[' + cls + ']');
                  continue;
                }
                // escape regexp meta
                parts.push(ch.replace(/[\\.\+\^\$\{\}\(\)\|]/g, m => '\\' + m));
              }
              const reStr = '^' + parts.join('') + '$';
              const re = new RegExp(reStr);
          const matched = names.filter((n: string) => re.test(n)).sort();
          if (matched.length > 0) return matched;
        } catch (e) {}
      }
      // no expansion
      return [pattern];
    };

    // Now perform splitting and globbing (and brace expansion) to produce final argv array
    const finalWords: string[] = [];
    const tokenObjs = seg.tokens as TokenObj[];
    for (const tk of tokenObjs) {
      if (tk.quote === 'single' || tk.quote === 'double') {
        // quoted: no field splitting, no globbing
        finalWords.push(tk.text);
        continue;
      }
      // unquoted: perform IFS splitting
      const parts = splitOnIFS(tk.text);
      for (const p of parts) {
        if (p === '') continue;
        // brace expansion (supports nested, comma lists and numeric ranges)
        const bexp = expandBraces(p);
        if (bexp.length > 1 || bexp[0] !== p) {
          for (const bp of bexp) {
            if (hasGlob(bp) && bp !== '') {
              const matches = await globExpand(bp);
              for (const m of matches) finalWords.push(m);
            } else if (bp !== '') {
              finalWords.push(bp);
            }
          }
          continue;
        }
        if (hasGlob(p) && p !== '') {
          const matches = await globExpand(p);
          for (const m of matches) finalWords.push(m);
        } else if (p !== '') {
          finalWords.push(p);
        }
      }
    }
    

    // Replace seg.tokens with final words (plain strings) for execution
    (seg as any).tokens = finalWords;

    // helper to set foreground process (cleared when exits)
    const setForeground = (p: Process | null) => {
      this.foregroundProc = p;
      if (p) {
        p.on('exit', () => {
          if (this.foregroundProc === p) this.foregroundProc = null;
        });
      }
    };

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
  // yield to next tick so caller (StreamShell.run) can attach stdout/stderr
  // listeners to this proc. Prevents races where a fast builtin writes
  // and ends before listeners are attached. Use setTimeout(0) for broad
  // environment compatibility.
  await new Promise(r => setTimeout(r, 0));
      if (!seg.tokens || seg.tokens.length === 0) {
        proc.endStdout();
        proc.endStderr();
        proc.exit(0);
        return;
      }

      // seg.tokens may be string[] or TokenObj[]; coerce to strings for execution
      const rawTokens = seg.tokens as any[];
      const cmd = String(rawTokens[0] ?? '');
      const args = rawTokens.slice(1).map((t: any) => String(t));

      // Provide a small context for handlers
      // Note: use the readable side of stdin (stdinStream) so builtins can
      // read from it when connected via pipe. stdout/stderr use the writable
      // stream backing so handlers can write into them.
      const ctx = {
        stdin: proc.stdinStream,
        stdout: proc.stdoutStream,
        stderr: proc.stderrStream,
        onSignal: (fn: (sig: string) => void) => proc.on('signal', fn),
        projectName: this.projectName,
        projectId: this.projectId,
      } as any;

      // Builtin implementations stream-aware
      try {
        // If the command looks like a path to a file (./script.sh or /path/to/script)
        // attempt to read it from the project's filesystem and, if it's a shell
        // script (ends with .sh or has a shebang), execute it line-by-line.
        if (unix && (cmd.includes('/') || cmd.endsWith('.sh'))) {
          const maybeContent = await unix.cat(cmd).catch(() => null);
          if (maybeContent !== null) {
            const text = String(maybeContent);
            const firstLine = text.split('\n', 1)[0] || '';
            if (cmd.endsWith('.sh') || firstLine.startsWith('#!')) {
              // Execute the script using the shell's script runner so that
              // multi-line control flow, functions and quoting are handled
              // as a single unit instead of naive per-line execution.
              // Build argv with script name followed by provided args.
              const scriptArgs = [cmd, ...args];
              try {
                await this.runScript(String(text), scriptArgs, proc);
              } catch (e) {
                // propagate error to stderr
                try {
                  proc.writeStderr(String((e as any)?.message ?? e));
                } catch {}
              }
              proc.endStdout();
              proc.endStderr();
              proc.exit(0);
              return;
            }
          }
        }
        // sh / bash => execute script file by reading and running lines sequentially
        if (cmd === 'sh' || cmd === 'bash') {
          if (args.length === 0) {
            proc.writeStderr('Usage: sh <file>\n');
            proc.endStdout();
            proc.exit(2);
            return;
          }
          const path = args[0];
          let content = await unix.cat(path).catch(() => null);
          // Special-case: when the command line came from a Windows environment the
          // path may contain backslashes which the parser treats as escapes and
          // removes. If initial attempt failed, try to recover the original
          // argument from the unparsed originalLine (if provided) so that
          // absolute Windows paths can be read by unix.cat.
          if ((content === null || content === undefined) && originalLine) {
            try {
              const re = /\bsh\s+([^\s]+)/i;
              const m = originalLine.match(re);
              if (m && m[1]) {
                let origPath = m[1];
                // strip surrounding quotes if any
                if ((origPath.startsWith('"') && origPath.endsWith('"')) || (origPath.startsWith("'") && origPath.endsWith("'"))) {
                  origPath = origPath.slice(1, -1);
                }
                content = await unix.cat(origPath).catch(() => null);
              }
            } catch (e) {}
          }
          if (content === null) {
            proc.writeStderr(`sh: ${path}: No such file\n`);
            proc.endStdout();
            proc.exit(1);
            return;
          }
          // Improved script execution: handle control flow (if/for/while) and positional args
          await this.runScript(String(content), args, proc).catch(() => {});
          proc.endStdout();
          proc.endStderr();
          proc.exit(0);
          return;
        }

        // Use the builtins adapter if available (stream-friendly wrappers)
        if (builtins && typeof builtins[cmd] === 'function') {
          try {
            
            await builtins[cmd](ctx, args);
            // builtins are expected to manage stdout/stderr end; ensure process exit
            proc.endStdout();
            proc.endStderr();
            proc.exit(0);
            return;
          } catch (e: any) {
            
            proc.writeStderr(String(e && e.message ? e.message : e));
            proc.endStdout();
            proc.endStderr();
            proc.exit(1);
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

        // Fallback to unix handler (returns structured {code, output})
        try {
          const { handleUnixCommand } = await import('../handlers/unixHandler');
          // collect stdin content (if any) before invoking handler; the stdin stream
          // may already be piped from a previous process by the time this runs
          // Wait for run() to wire up pipes before attempting to read any stdin buffer
          await new Promise<void>((resolve) => {
            let resolved = false;
            const onReady = () => {
              if (resolved) return;
              resolved = true;
              resolve();
            };
            proc.once('pipes-ready', onReady);
            // Safety timeout: if run() doesn't emit pipes-ready soon, continue
            setTimeout(() => {
              if (resolved) return;
              resolved = true;
              resolve();
            }, 50);
          });

          const readStdin = async (): Promise<string | null> => {
            return await new Promise((resolve) => {
              let buf = '';
              const s = proc.stdinStream as any;
              if (!s || typeof s.on !== 'function') return resolve(null);
              s.on('data', (c: any) => { buf += String(c); });
              s.on('end', () => resolve(buf));
              s.on('close', () => resolve(buf));
              // small delay to allow piped producer to write
              setTimeout(() => {
                if (buf.length > 0) return resolve(buf);
                resolve(null);
              }, 20);
            });
          };
          const stdinContent = await readStdin();
          const res = await handleUnixCommand(cmd, args, this.projectName, this.projectId, async (out: string) => {
            // also stream partial output immediately where possible
            try {
              proc.writeStdout(out);
            } catch (e) {}
          }, stdinContent);
          // ensure any returned output is written; on non-zero exit treat as stderr
          if (res && res.output) {
            try {
              if (res.code && res.code !== 0) proc.writeStderr(String(res.output).trimEnd());
              else proc.writeStdout(String(res.output).trimEnd());
            } catch (e) {}
          }
          proc.endStdout();
          proc.endStderr();
          proc.exit(res && typeof res.code === 'number' ? res.code : 0);
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

  // Defensive watchdog: if a handler never calls proc.exit(), avoid hanging forever.
  // Timeout can be configured via process.env.SHELL_PROCESS_TIMEOUT_MS (milliseconds).
  // Use a shorter default to fail fast and avoid large log bursts in constrained environments.
  const defaultTimeout = 5000; // 5s
    const toMs = Number(process.env.SHELL_PROCESS_TIMEOUT_MS || defaultTimeout) || defaultTimeout;
    let finished = false;
    proc.on('exit', () => {
      finished = true;
    });

    const watchdog = setTimeout(() => {
      if (finished) return;
      // Minimal, single-line message to avoid log storms. Prefer console.error so it
      // is visible even if consumer hasn't attached stderr listeners yet.
      console.error(`StreamShell: command timed out after ${toMs}ms (pid=${proc.pid})`);
      try {
        proc.writeStderr(`StreamShell: command timed out after ${toMs}ms\n`);
      } catch (e) {}
      try {
        proc.endStdout();
      } catch (e) {}
      try {
        proc.endStderr();
      } catch (e) {}
      try {
        proc.exit(124); // 124 like timeout
      } catch (e) {}
    }, toMs);

    // Clear watchdog when the process exits normally
    proc.on('exit', () => {
      try {
        clearTimeout(watchdog);
      } catch (e) {}
    });

    return proc;
  }

  // Execute a script text with simple control flow support (if/for/while)
  // args: positional args passed to the script (argv[1..])
  private async runScript(text: string, args: string[], proc: Process) {
    // Split the script into physical lines first BUT respect quotes, backticks and $(...)
    // so multi-line quoted strings are preserved as a single logical line.
    const splitPhysicalLines = (src: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inS = false;
      let inD = false;
      let inBT = false;
      let parenDepth = 0; // for $(...)
      for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === '\\') {
          // copy escape and next char if present
          cur += ch;
          if (i + 1 < src.length) cur += src[++i];
          continue;
        }
        if (ch === '`' && !inS && !inD) {
          inBT = !inBT;
          cur += ch;
          continue;
        }
        if (ch === '"' && !inS && !inBT) {
          inD = !inD;
          cur += ch;
          continue;
        }
        if (ch === "'" && !inD && !inBT) {
          inS = !inS;
          cur += ch;
          continue;
        }
        if (!inS && !inD && !inBT) {
          if (ch === '$' && src[i + 1] === '(') {
            parenDepth++;
            cur += ch;
            continue;
          }
          if (ch === '(' && parenDepth > 0) {
            cur += ch;
            continue;
          }
          if (ch === ')') {
            if (parenDepth > 0) parenDepth--;
            cur += ch;
            continue;
          }
          if (ch === '\n' && parenDepth === 0) {
            out.push(cur);
            cur = '';
            continue;
          }
        }
        cur += ch;
      }
      if (cur !== '') out.push(cur);
      return out;
    };

    const rawLines = splitPhysicalLines(text);
    // Helper: split a line at top-level semicolons (not inside quotes, backticks, or $(...)).
    // This lets us treat `if cond; then cmd; fi` and multi-line variants uniformly.
    const splitTopLevelSemicolons = (s: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inS = false;
      let inD = false;
      let inBT = false; // backtick
      let parenDepth = 0; // for $( ... )
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        // handle escapes
        if (ch === '\\') {
          cur += ch;
          if (i + 1 < s.length) cur += s[++i];
          continue;
        }
        if (ch === '`' && !inS && !inD) {
          inBT = !inBT;
          cur += ch;
          continue;
        }
        if (ch === "'" && !inD && !inBT) {
          inS = !inS;
          cur += ch;
          continue;
        }
        if (ch === '"' && !inS && !inBT) {
          inD = !inD;
          cur += ch;
          continue;
        }
        if (!inS && !inD && !inBT) {
          if (ch === '$' && s[i + 1] === '(') {
            parenDepth++;
            cur += ch;
            continue;
          }
          if (ch === '(' && parenDepth > 0) {
            cur += ch;
            continue;
          }
          if (ch === ')') {
            if (parenDepth > 0) parenDepth--;
            cur += ch;
            continue;
          }
          if (ch === ';' && parenDepth === 0) {
            out.push(cur);
            cur = '';
            continue;
          }
        }
        cur += ch;
      }
      if (cur !== '') out.push(cur);
      return out;
    };

    // Build statement list by splitting each physical line at top-level semicolons.
    const lines: string[] = [];
    for (const rl of rawLines) {
      const parts = splitTopLevelSemicolons(rl);
      for (const p of parts) {
        lines.push(p);
      }
    }
    // Evaluate simple arithmetic $(( ... )) where used in assignments
    // This helper evaluates numeric arithmetic expressions found as $((...)).
    // Note: it intentionally only supports numeric expressions composed of
    // digits, whitespace and arithmetic operators. Variable names are replaced
    // with numeric values from `localVars` before evaluation.
    const evalArithmeticInString = (s: string, localVars: Record<string, string>) => {
      return s.replace(/\$\(\((.*?)\)\)/g, (_, expr) => {
        // replace variable names with numeric values from localVars
        const safe = expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m: string) => {
          if (/^\d+$/.test(m)) return m;
          const v = localVars[m];
          return String(Number(v || 0));
        });
        // allow only digits, spaces and arithmetic operators
        if (!/^[0-9+\-*/()%\s]+$/.test(safe)) return '0';
        try {
          // eslint-disable-next-line no-new-func
          const val = Function(`return (${safe})`)();
          return String(Number(val));
        } catch (e) {
          return '0';
        }
      });
    };

    // Helper: evaluate command-substitutions in a string (supports $(...) and `...`)
    // Replaces occurrences with the stdout of the inner command (trimmed).
    // ALSO: after expanding command-substitutions, run arithmetic expansion
    // ($((...))) so arithmetic expressions inside the result are evaluated.
    // Previously this function did not evaluate $((...)); that caused some
    // scripts to leave arithmetic expressions unexpanded. We now evaluate
    // arithmetic here using the localVars context.
    const evalCommandSubstitutions = async (s: string, localVars: Record<string, string>): Promise<string> => {
      // handle backticks first (non-nested simple support)
      let out = s;
      // backticks: `...` (non nested)
      while (true) {
        const bt = out.indexOf('`');
        if (bt === -1) break;
        let j = bt + 1;
        let buf = '';
        while (j < out.length && out[j] !== '`') {
          buf += out[j++];
        }
        if (j >= out.length) break; // unterminated - leave as-is
        const inner = buf;
        const res = await this.run(inner);
        const replacement = String(res.stdout || '');
        out = out.slice(0, bt) + replacement + out.slice(j + 1);
      }

      // handle $(...) with nesting
      const findMatching = (str: string, start: number) => {
        let depth = 0;
        for (let k = start; k < str.length; k++) {
          if (str[k] === '(') depth++;
          if (str[k] === ')') {
            depth--;
            if (depth === 0) return k;
          }
        }
        return -1;
      };

      while (true) {
        const idx = out.indexOf('$(');
        if (idx === -1) break;
        const openPos = idx + 1; // position of '('
        const end = findMatching(out, openPos);
        if (end === -1) break; // unterminated - stop
        const inner = out.slice(openPos + 1, end);
        // recursively evaluate inner substitutions first
        const innerEval = await evalCommandSubstitutions(inner, localVars);
        const res = await this.run(innerEval);
        const replacement = String(res.stdout || '');
        out = out.slice(0, idx) + replacement + out.slice(end + 1);
      }

      // After command-substitutions, also perform arithmetic expansion $((...))
      // so expressions inside the resulting string are evaluated using localVars.
      try {
        out = evalArithmeticInString(out, localVars);
      } catch (e) {
        // if arithmetic expansion fails, leave the string as-is
      }

      return out;
    };

    

    const interpolate = (line: string, localVars: Record<string, string>) => {
      // Supports $0 (script name), $1..$9, $@ (all args), and local vars $VAR or ${VAR}
      let out = line;
      // Replace $@ with context-sensitive expansion:
      // - inside single quotes: no expansion
      // - inside double quotes: join args with spaces (escape double-quotes inside args)
      // - unquoted: expand to individually single-quoted args so word boundaries are preserved
      const replaceAt = (s: string) => {
        let res = '';
        let i = 0;
        while (i < s.length) {
          const idx = s.indexOf('$@', i);
          if (idx === -1) {
            res += s.slice(i);
            break;
          }
          res += s.slice(i, idx);
          // determine quote context at idx
          let inS = false;
          let inD = false;
          for (let j = 0; j < idx; j++) {
            const ch = s[j];
            if (ch === "'" && !inD) inS = !inS;
            if (ch === '"' && !inS) inD = !inD;
          }
          if (inS) {
            // no expansion inside single quotes
            res += '$@';
          } else if (inD) {
            // join args and escape double quotes
            const joined = (args && args.length > 1 ? args.slice(1) : []).map(a => String(a).replace(/"/g, '\\"')).join(' ');
            res += joined;
          } else {
            // unquoted: expand to individually single-quoted args
            const parts = (args && args.length > 1 ? args.slice(1) : []).map(a => {
              const s = String(a);
              // escape single quotes by closing, inserting \"'\", and reopening
              const esc = s.replace(/'/g, "'\\''");
              return "'" + esc + "'";
            });
            res += parts.join(' ');
          }
          i = idx + 2;
        }
        return res;
      };
      out = replaceAt(out);
      // $0 -> script name (args[0])
      out = out.replace(/\$0\b/g, args[0] || '');
      // positional $1..$9 -> args[1]..args[9]
      for (let i = 1; i <= 9; i++) {
        const val = args[i] || '';
        out = out.replace(new RegExp(`\\$${i}\\b`, 'g'), val);
      }
      // ${VAR} style
      out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
        if (name in localVars) return localVars[name];
        return '';
      });
      // $VAR style (word boundary)
      for (const k of Object.keys(localVars)) {
        out = out.replace(new RegExp('\\$' + k + '\\b', 'g'), localVars[k]);
      }
      return out;
    };

    // Unified evaluation pipeline for a script fragment:
    // 1) parameter/variable and positional interpolation (interpolate)
    // 2) command substitutions (`...` and $(...))
    // 3) arithmetic expansion $((...))
    // This centralizes the expansion order so callers don't need to mix
    // interpolate/evalCommandSubstitutions/evalArithmeticInString calls.
    const evaluateLine = async (lineStr: string, localVars: Record<string, string>) => {
      // first do variable/positional interpolation
      const afterInterp = interpolate(lineStr, localVars);
      // then expand command substitutions and nested arithmetic
      const afterCmdSub = await evalCommandSubstitutions(afterInterp, localVars);
      // finally arithmetic expansion (already applied inside evalCommandSubstitutions for nested results,
      // but run again here for safety on direct inputs)
      try {
        return evalArithmeticInString(afterCmdSub, localVars);
      } catch (e) {
        return afterCmdSub;
      }
    };

    // Evaluate a condition used in if/elif/while. Supports leading '!' negation
    // operators (possibly multiple) by stripping them, evaluating the inner
    // command, and inverting the exit code if needed. Returns the same shape
    // as this.run() (stdout, stderr, code) with code possibly inverted.
    const runCondition = async (condExpr: string, localVars: Record<string, string>) => {
      if (!condExpr) return { stdout: '', stderr: '', code: 1 };
      // count leading ! operators
      let s = condExpr.trimStart();
      let neg = 0;
      while (s.startsWith('!')) {
        neg++;
        s = s.slice(1).trimStart();
      }
      if (!s) return { stdout: '', stderr: '', code: neg % 2 === 1 ? 0 : 1 };
      // evaluate expansions then run
      const evaled = await evaluateLine(s, localVars);
      const res = await this.run(evaled);
      const codeNum = typeof res.code === 'number' ? res.code : 0;
      const finalCode = neg % 2 === 1 ? (codeNum === 0 ? 1 : 0) : codeNum;
      return { stdout: res.stdout, stderr: res.stderr, code: finalCode };
    };

    // brace expansion for runScript uses shared expandBraces utility (handles nested, lists, ranges)

    const MAX_LOOP = 10000;

    // run a range [start, end) of lines; supports break/continue signaling via return value
    const runRange = async (
      start: number,
      end: number,
      localVars: Record<string, string>
    ): Promise<'ok' | 'break' | 'continue'> => {
      for (let i = start; i < end; i++) {
        let raw = lines[i] ?? '';
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // Skip structural tokens that may appear as separate statements after splitting
        if (trimmed === 'then' || trimmed === 'fi' || trimmed === 'do' || trimmed === 'done' || trimmed === 'else' || trimmed.startsWith('elif ')) {
          continue;
        }

        // Helper to find matching end index for a block starting at `i`.
        // Works for if/fi (handling elif/else), for/done, while/done.
        // Note: lines is the pre-split statement array, so `then`/`do`/`fi` appear as separate statements
        // or may be on the same statement (e.g. 'if cond then' or 'do echo'). We handle both.

        // IF block
        if (/^if\b/.test(trimmed)) {
          // extract conditional expression between 'if' and 'then' (may be on same statement)
          let condLine = trimmed.replace(/^if\s+/, '').trim();
          let thenIdx = -1;
          // if this statement contains 'then' (e.g. 'if cond then' or 'if cond; then')
          const thenMatch = condLine.match(/\bthen\b(.*)$/);
          if (thenMatch) {
            // split cond and trailing body
            condLine = condLine.slice(0, thenMatch.index).trim();
            const trailing = thenMatch[1] ? thenMatch[1].trim() : '';
            // insert trailing part as next statement if present
            if (trailing) {
              lines.splice(i + 1, 0, trailing);
            }
            thenIdx = i;
          } else {
            // search for a 'then' statement in subsequent statements
            for (let j = i + 1; j < lines.length; j++) {
              const t = (lines[j] || '').trim();
              if (/^then\b/.test(t)) {
                thenIdx = j;
                const trailing = t.replace(/^then\b/, '').trim();
                if (trailing) lines.splice(j + 1, 0, trailing);
                break;
              }
            }
          }

          // find matching fi, and collect top-level elif/else positions
          let depth = 1;
          let fiIdx = -1;
          const elifs: number[] = [];
          let elseIdx = -1;
          for (let j = (thenIdx === -1 ? i + 1 : thenIdx + 1); j < lines.length; j++) {
            const t = (lines[j] || '').trim();
            if (/^if\b/.test(t)) {
              depth++;
            }
            if (/^fi\b/.test(t)) {
              depth--;
              if (depth === 0) {
                fiIdx = j;
                break;
              }
            }
            if (depth === 1) {
              if (/^elif\b/.test(t)) elifs.push(j);
              if (/^else\b/.test(t) && elseIdx === -1) elseIdx = j;
            }
          }
          if (fiIdx === -1) {
            // unterminated if - treat remainder as block
            fiIdx = lines.length - 1;
          }

          // evaluate condition
          const condEval = await runCondition(condLine, localVars);

          // forward any output from condition evaluation to the script process
          if (condEval.stdout) proc.writeStdout(condEval.stdout);
          if (condEval.stderr) proc.writeStderr(condEval.stderr);
          if (condEval.code === 0) {
            // then block starts after thenIdx
            const thenStart = (thenIdx === -1 ? i + 1 : thenIdx + 1);
            const thenEnd = (elifs.length > 0 ? elifs[0] : (elseIdx !== -1 ? elseIdx : fiIdx));
            const r = await runRange(thenStart, thenEnd, localVars);
            if (r !== 'ok') return r;
          } else {
            // check elifs in order
            let matched = false;
            for (let k = 0; k < elifs.length; k++) {
              const eIdx = elifs[k];
              // extract condition after 'elif'
              const eLine = (lines[eIdx] || '').trim();
              let eCond = eLine.replace(/^elif\s+/, '').trim();
              // if 'then' on same line, split trailing
              const m = eCond.match(/\bthen\b(.*)$/);
              if (m) {
                eCond = eCond.slice(0, m.index).trim();
                const trailing = m[1] ? m[1].trim() : '';
                if (trailing) lines.splice(eIdx + 1, 0, trailing);
              }
              const eRes = await runCondition(eCond, localVars);

              // forward outputs from elif condition
              if (eRes.stdout) proc.writeStdout(eRes.stdout);
              if (eRes.stderr) proc.writeStderr(eRes.stderr);
              if (eRes.code === 0) {
                const eThenStart = eIdx + 1;
                const eThenEnd = (k + 1 < elifs.length ? elifs[k + 1] : (elseIdx !== -1 ? elseIdx : fiIdx));
                const r = await runRange(eThenStart, eThenEnd, localVars);
                if (r !== 'ok') return r;
                matched = true;
                break;
              }
            }
            if (!matched && elseIdx !== -1) {
              const r = await runRange(elseIdx + 1, fiIdx, { ...localVars });
              if (r !== 'ok') return r;
            }
          }
          // advance i to fiIdx
          i = fiIdx;
          continue;
        }

        // FOR block
        if (/^for\b/.test(trimmed)) {
          const m = trimmed.match(/^for\s+(\w+)\s+in\s*(.*)$/);
          if (!m) {
            continue;
          }
          const varName = m[1];
          let itemsStr = m[2] ? m[2].trim() : '';
          // if itemsStr contains 'do' (inline), split
          if (/\bdo\b/.test(itemsStr)) {
            const parts = itemsStr.split(/\bdo\b/);
            itemsStr = parts[0].trim();
            const trailing = parts.slice(1).join('do').trim();
            if (trailing) lines.splice(i + 1, 0, trailing);
          }
          // find do and matching done
          let doIdx = -1;
          let doneIdx = -1;
          for (let j = i + 1; j < lines.length; j++) {
            const t = (lines[j] || '').trim();
            if (/^do\b/.test(t) && doIdx === -1) {
              // if 'do' has trailing content, push it as next stmt
              const trailing = t.replace(/^do\b/, '').trim();
              if (trailing) lines.splice(j + 1, 0, trailing);
              doIdx = j;
            }
            if (/^done\b/.test(t)) {
              doneIdx = j;
              break;
            }
          }
          if (doIdx === -1 || doneIdx === -1) {
            i = doneIdx === -1 ? lines.length - 1 : doneIdx;
            continue;
          }
          const bodyStart = doIdx + 1;
          const bodyEnd = doneIdx;
          const interpItems = await evaluateLine(itemsStr, localVars);
          // split items and support simple brace expansion (e.g. {1..5})
          const rawItems = interpItems.split(/\s+/).filter(Boolean);
          const items: string[] = [];
          for (const it of rawItems) {
            const expanded = expandBraces(it);
            if (expanded.length > 1 || expanded[0] !== it) items.push(...expanded);
            else items.push(it);
          }
          let iter = 0;
          for (const it of items) {
            if (++iter > MAX_LOOP) break;
            // set loop variable in localVars (shell variables are global in this scope)
            localVars[varName] = it;
            const r = await runRange(bodyStart, bodyEnd, localVars);
            if (r === 'break') break;
            if (r === 'continue') continue;
          }
          i = doneIdx;
          continue;
        }

        // WHILE block
        if (/^while\b/.test(trimmed)) {
          let condLine = trimmed.replace(/^while\s+/, '').trim();
          // handle inline do
          if (/\bdo\b/.test(condLine)) {
            const parts = condLine.split(/\bdo\b/);
            condLine = parts[0].trim();
            const trailing = parts.slice(1).join('do').trim();
            if (trailing) lines.splice(i + 1, 0, trailing);
          }
          let doIdx = -1;
          let doneIdx = -1;
          for (let j = i + 1; j < lines.length; j++) {
            const t = (lines[j] || '').trim();
            if (/^do\b/.test(t) && doIdx === -1) {
              const trailing = t.replace(/^do\b/, '').trim();
              if (trailing) lines.splice(j + 1, 0, trailing);
              doIdx = j;
            }
            if (/^done\b/.test(t)) {
              doneIdx = j;
              break;
            }
          }
          if (doIdx === -1 || doneIdx === -1) {
            i = doneIdx === -1 ? lines.length - 1 : doneIdx;
            continue;
          }
          const bodyStart = doIdx + 1;
          const bodyEnd = doneIdx;
          let count = 0;
          while (true) {
            if (++count > MAX_LOOP) break;
            const cres = await runCondition(condLine, localVars);
            // (condition evaluation output is forwarded below when appropriate)
            // forward outputs from while condition
            if (cres.stdout) proc.writeStdout(cres.stdout);
            if (cres.stderr) proc.writeStderr(cres.stderr);
            // trace removed; condition outputs are forwarded above
            if (cres.code !== 0) break;
            const r = await runRange(bodyStart, bodyEnd, localVars);
            if (r === 'break') break;
            if (r === 'continue') continue;
          }
          i = doneIdx;
          continue;
        }

        // break / continue
        if (trimmed === 'break') return 'break';
        if (trimmed === 'continue') return 'continue';

        // regular command or assignment: interpolate and execute
  let execLine = interpolate(trimmed, localVars);

        // handle `set ...` as a noop for now (common in scripts)
        if (execLine.startsWith('set ')) {
          // ignore set flags (e.g. -euo pipefail) for now
          continue;
        }

        // assignment-only: VAR=VALUE (no command)
        const assignMatch = execLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s);
        if (assignMatch) {
          const name = assignMatch[1];
          let rhs = assignMatch[2] ?? '';
          // trim surrounding quotes if present
          rhs = rhs.trim();
          if ((rhs.startsWith("'") && rhs.endsWith("'")) || (rhs.startsWith('"') && rhs.endsWith('"'))) {
            rhs = rhs.slice(1, -1);
          }
          // handle arithmetic expansion $((...)) before command-substitution
          rhs = evalArithmeticInString(rhs, localVars);
          // evaluate command substitutions in rhs
          try {
            const evaluated = await evalCommandSubstitutions(rhs, localVars);
            // store into localVars for subsequent interpolation
            localVars[name] = evaluated;
          } catch (e) {
            // fallback: raw assignment
            localVars[name] = rhs;
          }
          continue;
        }
        // For non-assignment commands, perform full evaluation pipeline
        try {
          execLine = await evaluateLine(execLine, localVars);
        } catch (e) {
          // ignore evaluation errors and use original execLine
        }
        const res = await this.run(execLine);
        if (res.stdout) proc.writeStdout(res.stdout);
        if (res.stderr) proc.writeStderr(res.stderr);
        // continue even on non-zero exit - matching simple shell behavior unless script uses conditional
      }
      return 'ok';
    };

    await runRange(0, lines.length, {});
  }

  // Run full pipeline line and resolve final stdout/stderr and code
  async run(line: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    let segs: any[] = [];
    // Prefer the dedicated parser. If the parser module cannot be imported
    // (e.g. not present in some environments), fall back to the simple
    // tokenizer. BUT if the parser is present and throws during parsing,
    // treat that as a real parse error and abort immediately (do not retry).
    let parserModule: any = null;
    try {
      parserModule = await import('./parser');
    } catch (impErr) {
      // import failed: fallback to simpler parser
      const pieces = this.splitPipes(line);
      segs = pieces.map(p => this.parseSegment(p));
    }

    if (parserModule) {
      try {
        segs = parserModule.parseCommandLine(line);
      } catch (parseErr: any) {
        // Return an immediate parse error result. Use exit code 2 to signal
        // a shell misuse/parse error (conventional), and include the message
        // on stderr so callers/tests can assert on it.
        const msg = String(parseErr && parseErr.message ? parseErr.message : parseErr);
        return { stdout: '', stderr: `Parse error: ${msg}\n`, code: 2 };
      }
    }
    // If nothing to run, return immediately
    if (!segs || segs.length === 0) {
      return { stdout: '', stderr: '', code: 0 };
    }
    const procs: Process[] = [];

    // create processes
    for (const seg of segs) {
      const p = await this.createProcessForSegment(seg, line);
      procs.push(p);
    }

    // foregroundProc will be set after wiring and before waiting for exits

    // wire up pipes: proc[i].stdout -> proc[i+1].stdin
    for (let i = 0; i < procs.length - 1; i++) {
      procs[i].stdout.pipe(procs[i + 1].stdin);
    }

    // Notify processes that pipes have been wired so handlers that may pre-read
    // stdin can safely inspect the stream. This avoids races where handlers
    // start reading before the pipes are connected.
    for (const p of procs) {
      try {
        p.emit('pipes-ready');
      } catch (e) {}
    }

    // Collect output from last process
    const last = procs[procs.length - 1];

    // If last has stdout redirection, capture and write to file when done
    const lastSeg = segs[segs.length - 1];

    // set foreground to last process unless background flag
    if (lastSeg && !lastSeg.background) {
      this.foregroundProc = procs[procs.length - 1];
      // clear when exited
      this.foregroundProc.on('exit', () => {
        if (this.foregroundProc && this.foregroundProc?.pid === procs[procs.length - 1].pid) {
          this.foregroundProc = null;
        }
      });
    } else {
      this.foregroundProc = null;
    }

    // Collect data for every fd we care about into per-fd buffers.
    const fdBuffers: Record<number, string[]> = {};
    // per-path serialization promises to avoid concurrent read/save races
    const writeQueues: Record<string, Promise<void>> = {};
    const pathState: Record<string, { created: boolean }> = {};

    const enqueueWrite = (path: string, append: boolean, chunk: string) => {
      const key = path.startsWith('/') ? path : `/${path}`;
      const job = async () => {
        try {
          // if append mode, read existing once per write; for overwrite, if not created, treat as truncate on first write
          const files = await this.fileRepository.getProjectFiles(this.projectId);
          const existing = files.find((f: any) => f.path === key || f.path === key.replace(/^\//, ''));
          if (!existing) {
            // create new file
            await this.fileRepository.createFile(this.projectId, key, chunk, 'file');
            pathState[key] = { created: true };
          } else {
            // append to existing content
            const newContent = existing.content + chunk;
            await this.fileRepository.saveFile({ ...existing, content: newContent, updatedAt: new Date() });
            pathState[key] = { created: true };
          }
        } catch (e) {
          // swallow write errors to avoid crashing the shell
        }
      };
      writeQueues[key] = (writeQueues[key] || Promise.resolve()).then(job).catch(() => {});
      return writeQueues[key];
    };
    const watchFd = (fd: number) => {
      if (fdBuffers[fd]) return;
      fdBuffers[fd] = [];
      try {
        const stream = last.getFdWrite(fd);
        // If this fd is configured to write to a file, stream writes directly
        // to fileRepository as chunks arrive. Otherwise accumulate in buffer.
        const fdFiles = (lastSeg as any)?.fdFiles || {};
        const fileInfo = fdFiles[fd];
        if (fileInfo && this.fileRepository) {
          // streaming write: on each chunk, enqueue a write
          stream.on('data', (chunk: Buffer | string) => {
            const s = String(chunk);
            enqueueWrite(fileInfo.path, !!fileInfo.append, s);
            // also keep buffer so returned outputs (if any) can be composed when needed
            fdBuffers[fd].push(s);
          });
        } else {
          stream.on('data', (chunk: Buffer | string) => {
            fdBuffers[fd].push(String(chunk));
          });
        }
      } catch (e) {
        // ignore
      }
    };

    // always watch stdout(1) and stderr(2)
    watchFd(1);
    watchFd(2);
    // also watch any fd-files configured on last segment
    if (lastSeg && (lastSeg as any).fdFiles) {
      for (const k of Object.keys((lastSeg as any).fdFiles)) {
        const fdn = Number(k);
        if (!Number.isNaN(fdn)) watchFd(fdn);
      }
    }

    const exits = await Promise.all(procs.map(p => p.wait()));

    const finalOut = (fdBuffers[1] || []).join('');
    const finalErr = (fdBuffers[2] || []).join('');

    // Debug: optionally print final outputs when debugging is enabled
    if (process.env.DEBUG_STREAMSHELL) {
      try {
        // Use console.error so it's visible in test output even when stdout is captured
        // stringify to avoid binary chunks causing display issues
        // eslint-disable-next-line no-console
        console.error('StreamShell: finalOut:', JSON.stringify(String(finalOut)));
        // eslint-disable-next-line no-console
        console.error('StreamShell: finalErr:', JSON.stringify(String(finalErr)));
      } catch (e) {}
    }

    // handle stdout/stderr/fd redirection to files (support &>, 2>&1, 1>&2, N>file)
    if (lastSeg && this.fileRepository && ((lastSeg as any).fdFiles || lastSeg.stdoutFile || lastSeg.stderrFile || lastSeg.stderrToStdout || lastSeg.stdoutToStderr)) {
      const writes: Record<string, string> = {};
      const appendMap: Record<string, boolean> = {};
      const add = (path: string | undefined | null, content: string, append: boolean = false) => {
        if (!path) return;
        const key = path.startsWith('/') ? path : `/${path}`;
        writes[key] = (writes[key] || '') + content;
        appendMap[key] = appendMap[key] || append;
      };

      // fdFiles entries (explicit numeric fd -> file)
      if ((lastSeg as any).fdFiles) {
        for (const k of Object.keys((lastSeg as any).fdFiles)) {
          const fdn = Number(k);
          if (Number.isNaN(fdn)) continue;
          const info = (lastSeg as any).fdFiles[fdn];
          const content = (fdBuffers[fdn] || []).join('');
          add(info.path, content, !!info.append);
        }
      }

      // backward-compatible stdout/stderr fields
      if (lastSeg.stdoutFile) add(lastSeg.stdoutFile, finalOut, !!lastSeg.append);
      else if (lastSeg.stdoutToStderr && lastSeg.stderrFile) add(lastSeg.stderrFile, finalOut, !!lastSeg.append);

      if (lastSeg.stderrFile) add(lastSeg.stderrFile, finalErr, false);
      else if (lastSeg.stderrToStdout && lastSeg.stdoutFile) add(lastSeg.stdoutFile, finalErr, !!lastSeg.append);

      // Perform writes respecting per-path append flags
      for (const pth of Object.keys(writes)) {
        try {
          let contentToWrite = writes[pth];
          if (appendMap[pth]) {
            const files = await this.fileRepository.getProjectFiles(this.projectId);
            const existing = files.find((f: any) => f.path === pth || f.path === pth.replace(/^\//, ''));
            if (existing && existing.content) contentToWrite = existing.content + contentToWrite;
          }
          const files = await this.fileRepository.getProjectFiles(this.projectId);
          const existing = files.find((f: any) => f.path === pth || f.path === pth.replace(/^\//, ''));
          if (existing) {
            await this.fileRepository.saveFile({ ...existing, content: contentToWrite, updatedAt: new Date() });
          } else {
            await this.fileRepository.createFile(this.projectId, pth, contentToWrite, 'file');
          }
        } catch (e) {
          // ignore
        }
      }
    }

    // Determine returned stdout/stderr: if redirected to files, do not include in return
    const code = exits.length ? exits[exits.length - 1].code : 0;
    const lastFdFiles = lastSeg ? (lastSeg as any).fdFiles : undefined;
    const returnedStdout = lastSeg && ((lastSeg.stdoutFile) || (lastSeg.stdoutToStderr) || (lastFdFiles && lastFdFiles[1])) ? '' : finalOut;
    // Suppress returned stderr if it was redirected to a file or merged into stdout via 2>&1
    const returnedStderr = lastSeg && ((lastSeg.stderrFile) || lastSeg.stderrToStdout || (lastFdFiles && lastFdFiles[2])) ? '' : finalErr;
    return { stdout: returnedStdout, stderr: returnedStderr, code };
  }

  // Kill the current foreground process with given signal
  killForeground(signal: string = 'SIGINT') {
    try {
      if (this.foregroundProc) this.foregroundProc.kill(signal);
    } catch (e) {}
  }
}

export default StreamShell;
