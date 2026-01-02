import type { UnixCommands } from '../global/unix';
import type { StreamCtx } from './builtins';
import adaptBuiltins from './builtins';
import { expandTokens } from './expansion';
import { parseCommandLine } from './parser';
import { Process, type ProcExit } from './process';
import { runScript } from './scriptRunner';
import {
  isDevNull,
  type Segment,
  type ShellOptions,
  type ShellRunResult,
  type TokenObj,
} from './types';

import type { fileRepository } from '@/engine/core/fileRepository';

// Re-export for backward compatibility
export { Process, type ProcExit } from './process';

/**
 * Stream-based Shell
 * - Process abstraction with stdin/stdout/stderr as streams
 * - Pipeline support using stream.pipe
 * - Redirections: >, >>, < handled by shell (uses FileRepository when provided)
 * - Signal handling (SIGINT) via EventEmitter and Process.kill()
 * - Delegates filesystem commands to UnixCommands when available
 * - Supports /dev/null and other special files
 */

export class StreamShell {
  private unix: UnixCommands;
  private fileRepository: typeof fileRepository | undefined;
  private projectName: string;
  private projectId: string;
  private commandRegistry: any;
  private foregroundProc: Process | null = null;
  private _terminalColumns: number;
  private _terminalRows: number;

  constructor(opts: ShellOptions) {
    this.projectName = opts.projectName;
    this.projectId = opts.projectId;
    this.unix = opts.unix || null;
    this.fileRepository = opts.fileRepository; // optional
    this.commandRegistry = opts.commandRegistry;
    this._terminalColumns = opts.terminalColumns ?? 80;
    this._terminalRows = opts.terminalRows ?? 24;
  }

  /** Update terminal size (call on resize) */
  setTerminalSize(columns: number, rows: number) {
    this._terminalColumns = columns;
    this._terminalRows = rows;
  }

  get terminalColumns() {
    return this._terminalColumns;
  }

  get terminalRows() {
    return this._terminalRows;
  }

  private async getUnix() {
    if (this.unix) return this.unix;
    const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
    this.unix = terminalCommandRegistry.getUnixCommands(this.projectName, this.projectId);
    return this.unix;
  }

  // Create a process for a segment. Handler can use streams and listen for 'signal' events.
  private async createProcessForSegment(seg: Segment, originalLine?: string): Promise<Process> {
    const proc = new Process();
    // lazily obtain unix commands if not injected
    const unix = await this.getUnix().catch(() => this.unix);
    const builtins = adaptBuiltins(unix);

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

    // Field splitting (IFS), pathname expansion (glob), and brace expansion
    // Use the expandTokens utility from expansion.ts
    const finalWords = await expandTokens(seg.tokens as TokenObj[], {
      projectId: this.projectId,
      projectName: this.projectName,
      fileRepository: this.fileRepository,
      unix,
    });
    // Replace seg.tokens with final words (plain strings) for execution
    (seg as any).tokens = finalWords;

    // If stdinFile is provided, read it and pipe into proc.stdin
    // Handle /dev/null specially: provide empty input
    if (seg.stdinFile && unix) {
      if (isDevNull(seg.stdinFile)) {
        // /dev/null as stdin: end immediately with no data
        proc.stdin.end();
      } else {
        (async () => {
          try {
            const content = await unix.cat(seg.stdinFile!).catch(() => '');
            if (content !== undefined && content !== null) {
              proc.stdin.write(String(content));
            }
          } catch (e) {}
          proc.stdin.end();
        })();
      }
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
      let cmd = String(rawTokens[0] ?? '');
      let args = rawTokens.slice(1).map((t: any) => String(t));

      // Basic npx support: `npx <cmd> [args...]` -> treat as running local/bin <cmd>
      if (cmd === 'npx') {
        if (!args || args.length === 0) {
          proc.writeStderr('npx: missing command\n');
          proc.endStdout();
          proc.endStderr();
          proc.exit(2);
          return;
        }
        // consume first arg as the command to run
        cmd = String(args[0]);
        args = args.slice(1);
      }

      // Try to resolve local package bin (node_modules/.bin/<cmd>) when available.
      // This helps `npx cowsay` and similar invocations work by running the
      // installed script via the node runtime in-project.
      if (this.fileRepository) {
        try {
          // Strategy 1: Try to find the package directly and read its bin configuration
          // This is better than .bin because .bin files might be copies, breaking relative requires.
          const packageJsonPath = `/node_modules/${cmd}/package.json`;
          const pkgFile = await this.fileRepository
            .getFileByPath(this.projectId, packageJsonPath)
            .catch(() => null);

          let resolvedBin: string | null = null;

          if (pkgFile && pkgFile.content) {
            try {
              const pkg = JSON.parse(pkgFile.content);
              if (pkg.bin) {
                if (typeof pkg.bin === 'string') {
                  resolvedBin = `/node_modules/${cmd}/${pkg.bin}`;
                } else if (typeof pkg.bin === 'object') {
                  // If bin is an object, look for the command name, or default to the package name
                  if (pkg.bin[cmd]) {
                    resolvedBin = `/node_modules/${cmd}/${pkg.bin[cmd]}`;
                  } else {
                    // Fallback: take the first bin entry
                    const first = Object.values(pkg.bin)[0];
                    if (typeof first === 'string') {
                      resolvedBin = `/node_modules/${cmd}/${first}`;
                    }
                  }
                }
              }
            } catch (e) {
              // ignore parse error
            }

            // If the bin entry omits an extension (e.g. "./index"), try common completions
            if (resolvedBin) {
              try {
                // Normalize any ./ segments (e.g. /node_modules/pkg/./index -> /node_modules/pkg/index)
                // Also normalize Windows backslashes to forward slashes
                const cleaned = resolvedBin.replace(/\\/g, '/').replace(/(^|\/)\.\//g, '$1');

                const candidates = [
                  cleaned,
                  cleaned + '.js',
                  cleaned + '.mjs',
                  cleaned + '.ts',
                  cleaned + '.tsx',
                  cleaned + '/index.js',
                  cleaned + '/index.mjs',
                  cleaned + '/index.ts',
                ];

                for (const cand of candidates) {
                  const f = await this.fileRepository
                    .getFileByPath(this.projectId, cand)
                    .catch(() => null);
                  if (f && f.content) {
                    resolvedBin = cand;
                    break;
                  }
                }
              } catch (e) {
                // ignore lookup errors and keep original resolvedBin
              }
            }
          }

          // Strategy 2: Fallback to .bin if package lookup failed (e.g. command name != package name)
          if (!resolvedBin) {
            const binPath = `/node_modules/.bin/${cmd}`;
            const bf = await this.fileRepository
              .getFileByPath(this.projectId, binPath)
              .catch(() => null);
            if (bf && bf.content) {
              resolvedBin = binPath;
            }
          }

          if (resolvedBin) {
            // If we found a local bin, run it with node: replace cmd/args to invoke node
            // Example: `npx cowsay hi` -> becomes `node /node_modules/cowsay/index.js hi`
            args = [resolvedBin, ...args];
            cmd = 'node';
          }
        } catch (e) {
          // ignore resolution errors and continue fallback behavior
        }
      }

      // Provide a small context for handlers
      // Note: use the readable side of stdin (stdinStream) so builtins can
      // read from it when connected via pipe. stdout/stderr use the writable
      // stream backing so handlers can write into them.
      const ctx: StreamCtx = {
        stdin: proc.stdinStream,
        stdout: proc.stdoutStream,
        stderr: proc.stderrStream,
        onSignal: (fn: (sig: string) => void) => proc.on('signal', fn),
        projectName: this.projectName,
        projectId: this.projectId,
        terminalColumns: this.terminalColumns,
        terminalRows: this.terminalRows,
      };

      // Normalizer for values written to stdout/stderr to avoid '[object Object]'
      const normalizeForWrite = (v: any) => {
        if (v === undefined || v === null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
      };

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
                await runScript(String(text), scriptArgs, proc, this);
              } catch (e) {
                // propagate error to stderr
                try {
                  proc.writeStderr(normalizeForWrite((e as any)?.message ?? e));
                } catch {}
              }
              // finished running script
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

          // Windows-style path fallback: recover original argument from originalLine
          if ((content === null || content === undefined) && originalLine) {
            try {
              const re = /\b(sh|bash)\s+([^\s]+)/i;
              const m = originalLine.match(re);
              if (m && m[2]) {
                let origPath = m[2];
                // strip surrounding quotes if any
                if (
                  (origPath.startsWith('"') && origPath.endsWith('"')) ||
                  (origPath.startsWith("'") && origPath.endsWith("'"))
                ) {
                  origPath = origPath.slice(1, -1);
                }
                content = await unix.cat(origPath).catch(() => null);
              }
            } catch (e) {}
          }

          if (content === null) {
            proc.writeStderr(`sh: ${args[0]}: No such file\n`);
            proc.endStdout();
            proc.exit(1);
            return;
          }

          // Improved script execution: handle control flow (if/for/while) and positional args
          await runScript(String(content), args, proc, this).catch(() => {});
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
            // Some builtins (like the test/[ implementation) signal failures by
            // throwing a special marker { __silent: true, code: n } so callers can
            // treat them as normal non-zero exits without emitting text. Ensure
            // we handle that here (previously only the outer catch handled it),
            // otherwise the thrown object may be printed as JSON.
            if (e && (e as any).__silent) {
              const code = typeof (e as any).code === 'number' ? (e as any).code : 1;
              try {
                proc.endStdout();
              } catch {}
              try {
                proc.endStderr();
              } catch {}
              proc.exit(code);
              return;
            }
            proc.writeStderr(normalizeForWrite(e && e.message ? e.message : e));
            proc.endStdout();
            proc.endStderr();
            proc.exit(1);
            return;
          }
        }

        // Extension/registered command
        if (
          this.commandRegistry &&
          this.commandRegistry.hasCommand &&
          this.commandRegistry.hasCommand(cmd)
        ) {
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
            proc.writeStderr(normalizeForWrite(e.message || e));
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
          await new Promise<void>(resolve => {
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
            return await new Promise(resolve => {
              let buf = '';
              const s = proc.stdinStream as any;
              if (!s || typeof s.on !== 'function') return resolve(null);
              s.on('data', (c: any) => {
                buf += String(c);
              });
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
          const res = await handleUnixCommand(
            cmd,
            args,
            this.projectName,
            this.projectId,
            async (out: string) => {
              // stream partial output to stdout
              try {
                const s = normalizeForWrite(out);
                proc.writeStdout(s);
              } catch (e) {}
            },
            async (errOut: string) => {
              // stream partial errors to stderr
              try {
                const s = normalizeForWrite(errOut);
                proc.writeStderr(s);
              } catch (e) {}
            },
            stdinContent
          );
          // ensure any returned output is written; on non-zero exit treat as stderr
          if (res && res.output) {
            try {
              const outStr = normalizeForWrite(res.output).trimEnd();
              if (res.code && res.code !== 0) proc.writeStderr(outStr);
              else proc.writeStdout(outStr);
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
      } catch (e: any) {
        // Support silent failure marker objects thrown by builtins (e.g. { __silent: true, code: 1 })
        // If present, do not print the object to stderr — just exit with provided code.
        if (e && (e as any).__silent) {
          const code = typeof (e as any).code === 'number' ? (e as any).code : 1;
          try {
            proc.endStdout();
          } catch {}
          try {
            proc.endStderr();
          } catch {}
          proc.exit(code);
          return;
        }
        proc.writeStderr(normalizeForWrite(e && e.message ? e.message : e));
        proc.endStdout();
        proc.endStderr();
        proc.exit(1);
        return;
      }
    })();

    // Defensive watchdog: if a handler never calls proc.exit(), avoid hanging forever.
    // Timeout can be configured via process.env.SHELL_PROCESS_TIMEOUT_MS (milliseconds).
    // Use a shorter default to fail fast and avoid large log bursts in constrained environments.
    const defaultTimeout = 1500000; // 1500s
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

  // Run full pipeline line and resolve final stdout/stderr and code
  async run(
    line: string,
    onData?: {
      stdout?: (data: string) => void;
      stderr?: (data: string) => void;
    }
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    let segs: any[] = [];
    // Use the AST-based parser exclusively. If importing or parsing fails,
    // surface a parse error (exit code 2) instead of falling back to the
    // simpler regex/tokenizer implementation.
    try {
      segs = parseCommandLine(line);
    } catch (parseErr: any) {
      const msg = String(parseErr && parseErr.message ? parseErr.message : parseErr);
      return { stdout: '', stderr: `Parse error: ${msg}\n`, code: 2 };
    }
    // If nothing to run, return immediately
    if (!segs || segs.length === 0) {
      return { stdout: '', stderr: '', code: 0 };
    }
    // Support logical operators (&&, ||) by grouping segments into command-groups
    // separated by logical operators. Each group is executed as a pipeline, and
    // the group's exit code controls whether the next group runs based on the
    // logical operator linking them.
    const groups: Array<{ segs: any[]; opAfter?: string | null }> = [];
    let curGroup: any[] = [];
    for (const s of segs) {
      curGroup.push(s);
      if ((s as any).logicalOp) {
        groups.push({ segs: curGroup, opAfter: (s as any).logicalOp });
        curGroup = [];
      }
    }
    if (curGroup.length > 0) groups.push({ segs: curGroup, opAfter: null });

    // Collect data for every fd we care about into per-fd buffers.
    const fdBuffers: Record<number, string[]> = {};
    // per-path serialization promises to avoid concurrent read/save races
    const writeQueues: Record<string, Promise<void>> = {};
    const pathState: Record<string, { created: boolean }> = {};

    const watchProc = (proc: Process, seg: any) => {
      // attach watchers for fds of interest on the provided process
      try {
        const watchFdFor = (fd: number) => {
          if (fdBuffers[fd]) return;
          fdBuffers[fd] = [];
          try {
            const stream = proc.getFdWrite(fd);
            const fdFiles = (seg as any)?.fdFiles || {};
            const fileInfo = fdFiles[fd];
            
            // Check if redirecting to /dev/null - discard output silently
            if (fileInfo && isDevNull(fileInfo.path)) {
              // Intentionally discard all data sent to /dev/null by attaching
              // a no-op handler. This mimics Unix /dev/null behavior.
              const discardData = () => { /* /dev/null: discard data */ };
              stream.on('data', discardData);
              return;
            }
            
            if (fileInfo && this.fileRepository) {
              // Collect data into buffers and notify real-time callbacks,
              // but defer actual repository writes until the end of the pipeline.
              // Performing repository writes here caused races where a later
              // final write would overwrite earlier streamed writes.
              stream.on('data', (chunk: Buffer | string) => {
                const s = String(chunk);
                fdBuffers[fd].push(s);
                // リアルタイムコールバック通知
                if (fd === 1 && onData?.stdout) {
                  onData.stdout(s);
                } else if (fd === 2 && onData?.stderr) {
                  onData.stderr(s);
                }
              });
            } else {
              stream.on('data', (chunk: Buffer | string) => {
                const s = String(chunk);
                fdBuffers[fd].push(s);
                // リアルタイムコールバック通知
                if (fd === 1 && onData?.stdout) {
                  onData.stdout(s);
                } else if (fd === 2 && onData?.stderr) {
                  onData.stderr(s);
                }
              });
            }
          } catch (e) {
            // ignore
          }
        };
        watchFdFor(1);
        watchFdFor(2);
        if (seg && (seg as any).fdFiles) {
          for (const k of Object.keys((seg as any).fdFiles)) {
            const fdn = Number(k);
            if (!Number.isNaN(fdn)) watchFdFor(fdn);
          }
        }
      } catch (e) {
        // ignore
      }
    };

    // Execute groups sequentially honoring logical ops
    let lastExitCode: number | null = 0;
    let overallLastSeg: any = segs[segs.length - 1];
    let overallLastProcs: Process[] = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      // Determine if we should skip this group based on previous group's opAfter
      if (gi > 0) {
        const prevOp = groups[gi - 1].opAfter;
        if (prevOp === '&&' && (lastExitCode === null || lastExitCode !== 0)) {
          // skip this group
          lastExitCode = 1;
          continue;
        }
        if (prevOp === '||' && (lastExitCode === null || lastExitCode === 0)) {
          // skip this group
          lastExitCode = 0;
          continue;
        }
      }

      // create processes for this group's segments
      const procs: Process[] = [];
      for (const seg of group.segs) {
        const p = await this.createProcessForSegment(seg, line);
        procs.push(p);
      }

      // wire up pipes within the group
      for (let i = 0; i < procs.length - 1; i++) {
        procs[i].stdout.pipe(procs[i + 1].stdin);
      }

      // notify pipes-ready
      for (const p of procs) {
        try {
          p.emit('pipes-ready');
        } catch (e) {}
      }

      // watch the group's last proc outputs so we accumulate stdout/stderr
      const lastProc = procs[procs.length - 1];
      const lastSegOfGroup = group.segs[group.segs.length - 1];
      watchProc(lastProc, lastSegOfGroup);

      // set foregroundProc only if this group is the final overall group and not background
      if (gi === groups.length - 1 && lastSegOfGroup && !lastSegOfGroup.background) {
        this.foregroundProc = lastProc;
        this.foregroundProc.on('exit', () => {
          if (this.foregroundProc && this.foregroundProc?.pid === lastProc.pid)
            this.foregroundProc = null;
        });
      } else if (gi === groups.length - 1) {
        this.foregroundProc = null;
      }

      // wait for group's procs to exit
      const exits = await Promise.all(procs.map(p => p.wait()));
      const exitOfLast = exits.length ? exits[exits.length - 1].code : 0;
      lastExitCode = exitOfLast === null ? 0 : exitOfLast;

      // keep reference to overall last procs/seg for post-processing
      overallLastProcs = procs;
      overallLastSeg = lastSegOfGroup;
    }

    // Ensure any pending stdout/stderr 'data' events have been processed
    // before we snapshot fdBuffers. Some handlers may emit data very
    // close to the proc.exit() call; wait for the readable streams to
    // emit 'end' (or timeout) to avoid races that cause partial writes.
    const waitForProcStreams = (p: Process, ms = 2000) => {
      return new Promise<void>(resolve => {
        let done = false;
        const tryResolve = () => {
          if (done) return;
          done = true;
          resolve();
        };

        try {
          const streams: Array<any> = [];
          try {
            streams.push(p.stdoutStream);
          } catch {}
          try {
            streams.push(p.stderrStream);
          } catch {}

          if (streams.length === 0) return tryResolve();

          let remaining = streams.length;
          const onEnd = () => {
            remaining--;
            if (remaining <= 0) tryResolve();
          };
          for (const s of streams) {
            if (!s || typeof s.on !== 'function') {
              onEnd();
              continue;
            }
            // If stream already ended, count it done
            if ((s as any).readableEnded || (s as any)._readableState?.ended) {
              onEnd();
              continue;
            }
            s.once('end', onEnd);
            s.once('close', onEnd);
            // safety: also resolve after ms
            setTimeout(onEnd, ms);
          }
        } catch (e) {
          tryResolve();
        }
      });
    };

    // Wait for all processes' streams to finish (bounded timeout)
    try {
      await Promise.all(overallLastProcs.map(p => waitForProcStreams(p)));
    } catch (e) {}

    const finalOut = (fdBuffers[1] || []).join('');
    const finalErr = (fdBuffers[2] || []).join('');

    // Debug: optionally print final outputs when debugging is enabled
    if (process.env.log_STREAMSHELL) {
      try {
        // Use console.error so it's visible in test output even when stdout is captured
        // stringify to avoid binary chunks causing display issues

        console.error('StreamShell: finalOut:', JSON.stringify(String(finalOut)));

        console.error('StreamShell: finalErr:', JSON.stringify(String(finalErr)));
      } catch (e) {}
    }

    // handle stdout/stderr/fd redirection to files (support &>, 2>&1, 1>&2, N>file)
    if (
      overallLastSeg &&
      this.fileRepository &&
      ((overallLastSeg as any).fdFiles ||
        overallLastSeg.stdoutFile ||
        overallLastSeg.stderrFile ||
        overallLastSeg.stderrToStdout ||
        overallLastSeg.stdoutToStderr)
    ) {
      const writes: Record<string, string> = {};
      const appendMap: Record<string, boolean> = {};
      const add = (path: string | undefined | null, content: string, append = false) => {
        if (!path) return;
        // Skip /dev/null - don't write anything
        if (isDevNull(path)) return;
        const key = path.startsWith('/') ? path : `/${path}`;
        writes[key] = (writes[key] || '') + content;
        appendMap[key] = appendMap[key] || append;
      };

      // fdFiles entries (explicit numeric fd -> file)
      if ((overallLastSeg as any).fdFiles) {
        for (const k of Object.keys((overallLastSeg as any).fdFiles)) {
          const fdn = Number(k);
          if (Number.isNaN(fdn)) continue;
          const info = (overallLastSeg as any).fdFiles[fdn];
          // Skip /dev/null
          if (isDevNull(info.path)) continue;
          const content = (fdBuffers[fdn] || []).join('');
          add(info.path, content, !!info.append);
        }
      }

      // backward-compatible stdout/stderr fields
      // If fdFiles were explicitly specified by the parser (e.g. "1>file"),
      // those entries have already been added above. Avoid adding the same
      // path twice by preferring fdFiles when present.
      const hasFdFiles =
        (overallLastSeg as any).fdFiles && Object.keys((overallLastSeg as any).fdFiles).length > 0;

      if (overallLastSeg.stdoutFile && !hasFdFiles) {
        add(overallLastSeg.stdoutFile, finalOut, !!overallLastSeg.append);
      } else if (overallLastSeg.stdoutToStderr && overallLastSeg.stderrFile && !hasFdFiles) {
        add(overallLastSeg.stderrFile, finalOut, !!overallLastSeg.append);
      }

      if (overallLastSeg.stderrFile && !hasFdFiles) {
        add(overallLastSeg.stderrFile, finalErr, false);
      } else if (overallLastSeg.stderrToStdout && overallLastSeg.stdoutFile && !hasFdFiles) {
        add(overallLastSeg.stdoutFile, finalErr, !!overallLastSeg.append);
      }

      // Perform writes respecting per-path append flags
      for (const pth of Object.keys(writes)) {
        try {
          let contentToWrite = writes[pth];
          if (appendMap[pth]) {
            const existing =
              typeof this.fileRepository.getFileByPath === 'function'
                ? await this.fileRepository.getFileByPath(this.projectId, pth)
                : null;
            if (existing && existing.content) contentToWrite = existing.content + contentToWrite;
          }
          const existing =
            typeof this.fileRepository.getFileByPath === 'function'
              ? await this.fileRepository.getFileByPath(this.projectId, pth)
              : null;
          if (existing) {
            await this.fileRepository.saveFile({
              ...existing,
              content: contentToWrite,
              updatedAt: new Date(),
            });
          } else {
            await this.fileRepository.createFile(this.projectId, pth, contentToWrite, 'file');
          }
        } catch (e) {
          // ignore
        }
      }
    }

    // Determine returned stdout/stderr: if redirected to files (including /dev/null), do not include in return
    const code = typeof lastExitCode === 'number' ? lastExitCode : 0;
    const lastFdFiles = overallLastSeg ? (overallLastSeg as any).fdFiles : undefined;
    
    // Check if stdout/stderr are redirected to /dev/null
    const stdoutToDevNull = (overallLastSeg?.stdoutFile && isDevNull(overallLastSeg.stdoutFile)) ||
                           (lastFdFiles && lastFdFiles[1] && isDevNull(lastFdFiles[1].path));
    const stderrToDevNull = (overallLastSeg?.stderrFile && isDevNull(overallLastSeg.stderrFile)) ||
                           (lastFdFiles && lastFdFiles[2] && isDevNull(lastFdFiles[2].path));
    
    const returnedStdout =
      overallLastSeg &&
      (overallLastSeg.stdoutFile ||
        overallLastSeg.stdoutToStderr ||
        (lastFdFiles && lastFdFiles[1]) ||
        stdoutToDevNull)
        ? ''
        : finalOut;
    // Suppress returned stderr if it was redirected to a file or merged into stdout via 2>&1
    const returnedStderr =
      overallLastSeg &&
      (overallLastSeg.stderrFile ||
        overallLastSeg.stderrToStdout ||
        (lastFdFiles && lastFdFiles[2]) ||
        stderrToDevNull)
        ? ''
        : finalErr;
    return { stdout: returnedStdout, stderr: returnedStderr, code };
  }

  // Kill the current foreground process with given signal
  killForeground(signal = 'SIGINT') {
    try {
      if (this.foregroundProc) this.foregroundProc.kill(signal);
    } catch (e) {}
  }
}

export default StreamShell;
