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

    seg.tokens = this.tokenize(s);
    return seg;
  }

  // Create a process for a segment. Handler can use streams and listen for 'signal' events.
  private async createProcessForSegment(seg: Segment): Promise<Process> {
    const proc = new Process();
    // lazily obtain unix commands if not injected
    const unix = await this.getUnix().catch(() => this.unix);
    const adaptBuiltins = await import('./builtins').then(m => m.default).catch(() => null);
    const builtins = adaptBuiltins && unix ? adaptBuiltins(unix) : null;

    // Resolve command-substitution markers in tokens before launching handler.
    // parser encoded command-substitution as JSON-stringified objects like
    // '{"cmdSub":"inner"}'. Detect and run them, replacing the token with
    // the stdout split by whitespace.
    if (seg.tokens && seg.tokens.length > 0) {
      const resolvedTokens: string[] = [];
      for (const t of seg.tokens) {
        if (typeof t === 'string') {
          const trimmed = t.trim();
          if (trimmed.startsWith('{') && trimmed.includes('cmdSub')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed && parsed.cmdSub) {
                const subRes = await this.run(parsed.cmdSub);
                const out = String(subRes.stdout || '');
                // If substitution was quoted, preserve as single token (do not split);
                // otherwise split on whitespace into multiple tokens
                if (parsed.quote === 'single' || parsed.quote === 'double') {
                  resolvedTokens.push(out);
                } else {
                  const parts = out.trim().split(/\s+/).filter(Boolean);
                  resolvedTokens.push(...parts);
                }
                continue;
              }
            } catch (e) {}
          }
        }
        resolvedTokens.push(String(t));
      }
      seg.tokens = resolvedTokens;
    }

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
          const content = await unix.cat(path).catch(() => null);
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
    const lines = text.split('\n');

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

        // if ... then ... [else|elif] fi
        if (trimmed.startsWith('if ')) {
          // find matching fi with nesting
          let depth = 0;
          let j = i;
          let thenIndex = -1;
          let elseIndex = -1;
          for (; j < lines.length; j++) {
            const t = (lines[j] || '').trim();
            if (t.startsWith('if ')) depth++;
            if (t === 'then' && thenIndex === -1) thenIndex = j;
            if ((t === 'else' || t.startsWith('elif ')) && elseIndex === -1) elseIndex = j;
            if (t === 'fi') {
              depth--;
              if (depth < 0) break; // matched
            }
          }
          const condLine = trimmed.slice(3).trim();
          const condRes = await this.run(interpolate(condLine, localVars));
          // compute blocks
          const thenStart = thenIndex + 1;
          const thenEnd = elseIndex !== -1 ? elseIndex : j;
          const elseStart = elseIndex !== -1 ? elseIndex + 1 : -1;
          const elseEnd = j;

          if (condRes.code === 0) {
            const r = await runRange(thenStart, thenEnd, { ...localVars });
            if (r !== 'ok') return r;
          } else {
            if (elseIndex !== -1) {
              // handle simple elif by treating the elif line as if it were an if
              const elseLine = (lines[elseIndex] || '').trim();
              if (elseLine.startsWith('elif ')) {
                // convert `elif cond` + rest into an if block by recursion: create a tiny sub-block
                // build a synthetic block: lines[elseIndex] .. lines[j]
                const subLines = lines.slice(elseIndex, j + 1).join('\n');
                await this.runScript(subLines, args, proc);
              } else {
                const r = await runRange(elseStart, elseEnd, { ...localVars });
                if (r !== 'ok') return r;
              }
            }
          }
          i = j; // advance to fi
          continue;
        }

        // for VAR in a b c; do ...; done
        if (trimmed.startsWith('for ')) {
          // parse `for VAR in items`
          const m = trimmed.match(/^for\s+(\w+)\s+in\s+(.*)$/);
          if (!m) continue;
          const varName = m[1];
          const itemsStr = m[2].trim();
          // find `do` and matching `done`
          let doIndex = -1;
          let doneIndex = -1;
          for (let j = i + 1; j < lines.length; j++) {
            const t = (lines[j] || '').trim();
            if (t === 'do' && doIndex === -1) doIndex = j;
            if (t === 'done') {
              doneIndex = j;
              break;
            }
          }
          if (doIndex === -1 || doneIndex === -1) {
            i = doneIndex === -1 ? lines.length : doneIndex;
            continue;
          }
          const bodyStart = doIndex + 1;
          const bodyEnd = doneIndex;

          // split items by whitespace after interpolation
          const interpItems = interpolate(itemsStr, localVars);
          const items = interpItems.split(/\s+/).filter(Boolean);
          let iter = 0;
          for (const it of items) {
            if (++iter > MAX_LOOP) break;
            const lv = { ...localVars };
            lv[varName] = it;
            const r = await runRange(bodyStart, bodyEnd, lv);
            if (r === 'break') break;
            if (r === 'continue') continue;
          }
          i = doneIndex;
          continue;
        }

        // while cond; do ...; done
        if (trimmed.startsWith('while ')) {
          const condLine = trimmed.slice(6).trim();
          // find do/done
          let doIndex = -1;
          let doneIndex = -1;
          for (let j = i + 1; j < lines.length; j++) {
            const t = (lines[j] || '').trim();
            if (t === 'do' && doIndex === -1) doIndex = j;
            if (t === 'done') {
              doneIndex = j;
              break;
            }
          }
          if (doIndex === -1 || doneIndex === -1) {
            i = doneIndex === -1 ? lines.length : doneIndex;
            continue;
          }
          const bodyStart = doIndex + 1;
          const bodyEnd = doneIndex;
          let count = 0;
          while (true) {
            if (++count > MAX_LOOP) break;
            const cres = await this.run(interpolate(condLine, localVars));
            if (cres.code !== 0) break;
            const r = await runRange(bodyStart, bodyEnd, { ...localVars });
            if (r === 'break') break;
            if (r === 'continue') continue;
          }
          i = doneIndex;
          continue;
        }

        // break / continue
        if (trimmed === 'break') return 'break';
        if (trimmed === 'continue') return 'continue';

        // regular command: interpolate and execute
        const execLine = interpolate(trimmed, localVars);
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
    try {
      const parser = await import('./parser');
      segs = parser.parseCommandLine(line);
  // parsed segments (debug removed)
    } catch (e) {
      const pieces = this.splitPipes(line);
      segs = pieces.map(p => this.parseSegment(p));
    }
    // If nothing to run, return immediately
    if (!segs || segs.length === 0) {
      return { stdout: '', stderr: '', code: 0 };
    }
    const procs: Process[] = [];

    // create processes
    for (const seg of segs) {
      const p = await this.createProcessForSegment(seg);
      procs.push(p);
    }

    // foregroundProc will be set after wiring and before waiting for exits

    // wire up pipes: proc[i].stdout -> proc[i+1].stdin
    for (let i = 0; i < procs.length - 1; i++) {
      procs[i].stdout.pipe(procs[i + 1].stdin);
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

  // Kill the current foreground process with given signal
  killForeground(signal: string = 'SIGINT') {
    try {
      if (this.foregroundProc) this.foregroundProc.kill(signal);
    } catch (e) {}
  }
}

export default StreamShell;
