/**
 * Shell Executor
 * POSIX-compliant shell execution engine.
 * Directly uses existing handlers (gitHandler, npmHandler, pyxisHandler, unixHandler)
 * without unnecessary provider abstraction layer.
 */

import { Buffer } from 'buffer';
import type TerminalUI from '@/engine/cmd/terminalUI';
import { ANSI } from '@/engine/cmd/terminalUI';
import type { FsApi } from '@/engine/core/fs';
import { fsClient as defaultFsClient } from '@/engine/core/fs';
import { HOME_DIR, resolvePath } from '@/engine/core/pathUtils';
import type { UnixCommands } from '../global/unix';
import { ProcessStdin } from '../terminalProcessBridge';
import adaptBuiltins, { type StreamCtx } from './builtins';
import { expandTokens } from './expansion';
import { runLocalBinary } from './localBinary';
import { ShellOutputHandler } from './outputHandler';
import { parseCommandLine } from './parser';
import { Process } from './process';
import { runScript } from './scriptRunner';
import { isDevNull, type Segment, type TokenObj } from './types';

/**
 * Shell Executor Options
 */
export interface ShellExecutorOptions {
  rootPath: string;
  cwd?: string;
  signal?: AbortSignal;
  fsClient?: FsApi;
  unix?: UnixCommands;
  commandRegistry?: any;
  terminalColumns?: number;
  terminalRows?: number;
  terminalUI?: TerminalUI; // Optional UI instance for advanced display
  env?: Record<string, string>;
  isInteractive?: boolean;
}

/**
 * Shell Run Result
 */
export interface ShellRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Real-time output callbacks
 */
export interface OutputCallbacks {
  stdout?: (data: string) => void;
  stderr?: (data: string) => void;
}

/**
 * Execution Context - simplified version without provider overhead
 */
interface ExecutionContext {
  rootPath: string;
  signal?: AbortSignal;
  cwd: string;
  env: Record<string, string>;
  aliases: Record<string, string>;
  terminalColumns: number;
  terminalRows: number;
}

function createEnvironment(overrides?: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
  return { ...inherited, HOME: HOME_DIR, ...overrides };
}

/**
 * Shell Executor
 * Executes shell commands using existing handlers directly.
 */
export class ShellExecutor {
  private context: ExecutionContext;
  private fsClient: FsApi;
  private outputHandler: ShellOutputHandler;
  private unix: UnixCommands | null = null;
  private commandRegistry: any;
  private terminalUI?: TerminalUI;
  private foregroundProc: Process | null = null;
  private pendingSignal: string | null = null;
  private builtins: Record<string, any> | null = null;

  constructor(options: ShellExecutorOptions) {
    this.context = {
      rootPath: options.rootPath,
      signal: options.signal,
      cwd: options.cwd ?? options.rootPath,
      env: createEnvironment(options.env),
      aliases: {},
      terminalColumns: options.terminalColumns ?? 80,
      terminalRows: options.terminalRows ?? 24,
    };

    this.unix = options.unix ?? null;
    this.fsClient = options.fsClient ?? defaultFsClient;
    this.outputHandler = new ShellOutputHandler(this.fsClient, async () => {
      const unix = await this.getUnix();
      return unix ? unix.pwd() : this.context.cwd;
    });
    this.commandRegistry = options.commandRegistry;
    this.terminalUI = options.terminalUI;
    options.signal?.addEventListener('abort', () => this.killForeground('SIGINT'), { once: true });
    if (options.signal?.aborted) this.pendingSignal = 'SIGINT';
  }

  /**
   * Get unix commands instance
   */
  private async getUnix(): Promise<UnixCommands | null> {
    if (this.unix) return this.unix;

    try {
      const { terminalCommandRegistry } = await import('../terminalRegistry');
      this.unix = terminalCommandRegistry.getUnixCommands(this.context.rootPath);
      return this.unix;
    } catch {
      return null;
    }
  }

  /**
   * Get builtins (lazy initialization)
   */
  private async getBuiltins(): Promise<Record<string, any>> {
    if (this.builtins) return this.builtins;
    const unix = await this.getUnix();
    this.builtins = adaptBuiltins(unix);
    return this.builtins;
  }

  /**
   * Save current working directory for process isolation
   * Returns the saved CWD or null if unable to save
   */
  private async saveCwd(unix: UnixCommands): Promise<string | null> {
    try {
      return await unix.pwd();
    } catch (e) {
      // Non-fatal: CWD save failed, script will run without isolation
      console.warn('[ShellExecutor] Failed to save CWD for process isolation:', e);
      return null;
    }
  }

  /**
   * Restore working directory after script execution (POSIX process isolation)
   * Script's CWD changes are discarded, parent CWD is restored
   */
  private async restoreCwd(unix: UnixCommands, savedCwd: string | null): Promise<void> {
    if (!savedCwd) return;
    try {
      await unix.cd([savedCwd]);
    } catch (e) {
      // Non-fatal: CWD restore failed, may affect subsequent commands
      console.warn('[ShellExecutor] Failed to restore CWD after script execution:', e);
    }
  }

  /**
   * Update terminal size
   */
  setTerminalSize(columns: number, rows: number): void {
    this.context.terminalColumns = columns;
    this.context.terminalRows = rows;
  }

  get terminalColumns(): number {
    return this.context.terminalColumns;
  }

  get terminalRows(): number {
    return this.context.terminalRows;
  }

  /**
   * Run a command line
   */
  async run(line: string, callbacks?: OutputCallbacks): Promise<ShellRunResult> {
    // Parse command line
    let segments: Segment[];
    try {
      segments = parseCommandLine(line, this.context.env) as Segment[];
    } catch (parseErr: any) {
      const msg = String(parseErr?.message || parseErr);
      return { stdout: '', stderr: `Parse error: ${msg}\n`, code: 2 };
    }

    // Empty command
    if (!segments || segments.length === 0) {
      return { stdout: '', stderr: '', code: 0 };
    }

    // Group segments by logical operators (&&, ||)
    const groups = this.groupByLogicalOperators(segments);

    // Execution state
    const fdBuffers: Record<number, Buffer[]> = { 1: [], 2: [] };
    let lastExitCode: number | null = 0;

    // Execute groups sequentially
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];

      // Check if we should skip based on previous logical operator
      if (gi > 0) {
        const prevOp = groups[gi - 1].opAfter;
        if (prevOp === '&&' && lastExitCode !== 0) {
          lastExitCode = 1;
          continue;
        }
        if (prevOp === '||' && lastExitCode === 0) {
          lastExitCode = 0;
          continue;
        }
      }

      const groupBuffers: Record<number, Buffer[]> = { 1: [], 2: [] };
      const procs: Process[] = [];

      for (const seg of group.segs) {
        const proc = await this.createProcessForSegment(seg, line);
        procs.push(proc);
      }

      // Wire up pipes
      for (let i = 0; i < procs.length - 1; i++) {
        procs[i + 1].stdinRedirected = true;
        procs[i].stdout.pipe(procs[i + 1].stdin);
      }

      // Emit pipes-ready for all processes
      for (const p of procs) {
        try {
          p.emit('pipes-ready');
        } catch {}
      }

      // Watch output from last process
      const lastProc = procs[procs.length - 1];
      const lastSegOfGroup = group.segs[group.segs.length - 1];
      this.outputHandler.watch(lastProc, lastSegOfGroup, groupBuffers, callbacks);

      // Set foreground process
      if (gi === groups.length - 1 && !lastSegOfGroup.background) {
        this.foregroundProc = lastProc;
        if (this.pendingSignal) {
          lastProc.kill(this.pendingSignal);
          this.pendingSignal = null;
        }
        lastProc.on('exit', () => {
          if (this.foregroundProc?.pid === lastProc.pid) {
            this.foregroundProc = null;
          }
        });
      }

      // Wait for all processes to complete
      const exits = await Promise.all(procs.map(p => p.wait()));
      const lastExit = exits[exits.length - 1];
      let exitOfLast = lastExit?.code ?? 0;
      if (lastExit?.signal === 'SIGINT') exitOfLast = 130;
      lastExitCode = exitOfLast;
      for (const fd of [1, 2]) {
        if (!this.outputHandler.shouldSuppressOutput(lastSegOfGroup, fd)) {
          fdBuffers[fd].push(...groupBuffers[fd]);
        }
      }
      try {
        await this.outputHandler.handleRedirections(lastSegOfGroup, groupBuffers);
      } catch (error) {
        const message = `Redirection failed: ${String(error)}\n`;
        fdBuffers[2].push(Buffer.from(message));
        callbacks?.stderr?.(message);
        if (exitOfLast !== 130) lastExitCode = 1;
      }
      if (exitOfLast === 130) break;
    }

    // Collect output
    const finalOut = Buffer.concat(fdBuffers[1]).toString('utf8');
    const finalErr = Buffer.concat(fdBuffers[2]).toString('utf8');

    return {
      stdout: finalOut,
      stderr: finalErr,
      code: lastExitCode ?? 0,
    };
  }

  /**
   * Create a process for a single command segment
   */
  private async createProcessForSegment(seg: Segment, originalLine: string): Promise<Process> {
    const proc = new Process();
    const unix = await this.getUnix();

    // Apply fd duplication
    if ((seg as any).fdDup) {
      for (const d of (seg as any).fdDup) {
        try {
          if (typeof d.from === 'number' && typeof d.to === 'number') {
            proc.setFdDup(d.from, d.to);
          }
        } catch {}
      }
    }

    // Resolve command substitutions
    if (seg.tokens?.length > 0) {
      const withCmdSub: TokenObj[] = [];
      for (const tk of seg.tokens) {
        if (typeof tk !== 'string' && tk.cmdSub) {
          try {
            const subRes = await this.run(tk.cmdSub);
            const rawOut = String(subRes.stdout || '');
            const normalized = rawOut.replace(/\r?\n/g, ' ').replace(/\s+$/g, '');
            withCmdSub.push({
              text: normalized,
              quote: tk.quote ?? null,
            });
          } catch {
            withCmdSub.push({ text: '', quote: tk.quote ?? null });
          }
        } else if (typeof tk === 'string') {
          withCmdSub.push({ text: tk, quote: null });
        } else {
          withCmdSub.push(tk as TokenObj);
        }
      }
      seg.tokens = withCmdSub;
    }

    // Expand tokens (IFS, globs, braces)
    const finalWords = await expandTokens(seg.tokens as TokenObj[], {
      rootPath: this.context.rootPath,
      cwd: unix ? await unix.pwd() : this.context.cwd,
      fsClient: this.fsClient,
      env: this.context.env,
    });
    (seg as any).tokens = finalWords;

    proc.stdinRedirected = Boolean(seg.stdinFile);

    // Launch command handler
    this.executeSegment(proc, seg, originalLine, unix);

    return proc;
  }

  /**
   * Execute a command segment
   */
  private async executeSegment(
    proc: Process,
    seg: Segment,
    originalLine: string,
    unix: UnixCommands | null
  ): Promise<void> {
    // Yield to allow caller to attach listeners
    await new Promise(r => setTimeout(r, 0));

    if (seg.stdinFile) {
      try {
        if (!isDevNull(seg.stdinFile)) {
          let cwd = this.context.cwd;
          if (unix) cwd = await unix.pwd();
          proc.stdin.write(await this.fsClient.readFile(resolvePath(cwd, seg.stdinFile)));
        }
        proc.stdin.end();
      } catch (error) {
        proc.writeStderr(`Input redirection failed: ${String(error)}\n`);
        proc.exit(1);
        return;
      }
    }

    const rawTokens = seg.tokens as string[];
    if (!rawTokens || rawTokens.length === 0) {
      proc.endStdout();
      proc.endStderr();
      proc.exit(0);
      return;
    }

    const cmd = String(rawTokens[0] ?? '');
    const args = rawTokens.slice(1).map(t => String(t));
    if (cmd === 'cd' && args.length === 0) args.push(this.context.env.HOME);

    // 'npx' is handled by npm handler now; let executeCommand route it

    // Check for alias expansion
    if (this.context.aliases[cmd]) {
      const expandedLine = `${this.context.aliases[cmd]} ${args.join(' ')}`;
      const result = await this.run(expandedLine);
      proc.writeStdout(result.stdout);
      proc.writeStderr(result.stderr);
      proc.endStdout();
      proc.endStderr();
      proc.exit(result.code ?? 0);
      return;
    }

    try {
      // Check for script files
      // POSIX Process Isolation: Script execution runs in isolated context
      // Changes to CWD inside script do NOT affect parent shell
      if (unix && (cmd.includes('/') || cmd.endsWith('.sh'))) {
        const maybeContent = await unix.cat([cmd]).catch(() => null);
        if (maybeContent !== null) {
          let text = maybeContent;
          if (typeof text !== 'string')
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(text);
          const firstLine = text.split('\n', 1)[0] || '';
          if (cmd.endsWith('.sh') || firstLine.startsWith('#!')) {
            // Detect node shebangs or JS entrypoints and execute via Node runtime
            const isNodeShebang = /node/.test(firstLine);
            const isJsFile = cmd.endsWith('.js') || /\.js$/.test(cmd);

            // Save parent context CWD before script execution (POSIX isolation)
            const savedCwd = await this.saveCwd(unix);

            if (isNodeShebang || isJsFile) {
              try {
                const exitCode = await this.executeCommand('node', [cmd, ...args], proc);
                await this.restoreCwd(unix, savedCwd);
                proc.endStdout();
                proc.endStderr();
                proc.exit(typeof exitCode === 'number' ? exitCode : 0);
                return;
              } catch (e: any) {
                proc.writeStderr(e?.message ?? String(e));
                await this.restoreCwd(unix, savedCwd);
                proc.endStdout();
                proc.endStderr();
                proc.exit(1);
                return;
              }
            }

            // Otherwise treat as a shell script
            const scriptArgs = [cmd, ...args];
            try {
              await runScript(text, scriptArgs, proc, this as any);
            } catch (e: any) {
              proc.writeStderr(e?.message ?? String(e));
            }

            // Restore parent context CWD after script completes
            await this.restoreCwd(unix, savedCwd);

            proc.endStdout();
            proc.endStderr();
            proc.exit(0);
            return;
          }
        }
      }

      // Handle sh/bash command
      // POSIX Process Isolation: Script execution runs in isolated context
      // Changes to CWD inside script do NOT affect parent shell
      if (cmd === 'sh' || cmd === 'bash') {
        if (args.length === 0) {
          proc.writeStderr('Usage: sh <file>\n');
          proc.endStdout();
          proc.exit(2);
          return;
        }
        const content = unix ? await unix.cat([args[0]]).catch(() => null) : null;
        if (content === null) {
          proc.writeStderr(`sh: ${args[0]}: No such file\n`);
          proc.endStdout();
          proc.exit(1);
          return;
        }

        // Save parent context CWD before script execution
        const savedCwd = unix ? await this.saveCwd(unix) : null;

        // Run script in isolated context
        let script = content;
        if (typeof script !== 'string')
          script = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(script);
        await runScript(script, args, proc, this as any).catch(() => {});

        // Restore parent context CWD after script completes
        if (unix) {
          await this.restoreCwd(unix, savedCwd);
        }

        proc.endStdout();
        proc.endStderr();
        proc.exit(0);
        return;
      }

      // Execute command through appropriate handler
      const exitCode = await this.executeCommand(cmd, args, proc);
      proc.endStdout();
      proc.endStderr();
      proc.exit(exitCode);
    } catch (error: any) {
      // Handle silent failures
      if (error?.__silent) {
        const code = typeof error.code === 'number' ? error.code : 1;
        proc.endStdout();
        proc.endStderr();
        proc.exit(code);
        return;
      }

      const msg = error?.message ?? String(error);
      proc.writeStderr(`${msg}\n`);
      proc.endStdout();
      proc.endStderr();
      proc.exit(1);
    }
  }

  /**
   * Execute a command through appropriate handler
   */
  private async executeCommand(cmd: string, args: string[], proc: Process): Promise<number> {
    const writeOutput = async (output: string | Uint8Array) => {
      proc.writeStdout(output);
      if (typeof output === 'string' && !output.endsWith('\n')) {
        proc.writeStdout('\n');
      }
    };

    const writeError = async (output: string) => {
      proc.writeStderr(output);
      if (!output.endsWith('\n')) {
        proc.writeStderr('\n');
      }
    };

    // 1. Git command
    if (cmd === 'git') {
      try {
        const { handleGitCommand } = await import('../handlers/gitHandler');
        await handleGitCommand(args, this.context.rootPath, writeOutput);
        return 0;
      } catch (e: any) {
        await writeError(`git: ${e.message}`);
        return 1;
      }
    }

    // 2. NPM command
    if (cmd === 'npm') {
      try {
        const { handleNPMCommand } = await import('../handlers/npmHandler');
        await handleNPMCommand(
          args,
          this.context.rootPath ?? '/',
          writeOutput,
          () => {} // setLoading - no-op in shell context
        );
        return 0;
      } catch (e: any) {
        await writeError(`npm: ${e.message}`);
        return 1;
      }
    }

    // 2b. NPX command - delegate to npm handler
    if (cmd === 'npx') {
      try {
        const { handleNPXCommand } = await import('../handlers/npmHandler');
        let processStdin: ProcessStdin | undefined;
        if (proc.stdinRedirected) processStdin = new ProcessStdin(proc.stdinStream);
        const code = await handleNPXCommand(
          args,
          writeOutput,
          handler => {
            const listener = (signal: string) => {
              if (signal === 'SIGINT') handler();
            };
            proc.on('signal', listener);
            return () => proc.off('signal', listener);
          },
          this.context.signal,
          processStdin
        );
        return typeof code === 'number' ? code : 0;
      } catch (e: any) {
        await writeError(`npx: ${e.message}`);
        return 1;
      }
    }

    // 3. Pyxis command
    if (cmd === 'pyxis') {
      try {
        const { handlePyxisCommand } = await import('../handlers/pyxisHandler');

        if (args.length === 0) {
          await writeError('pyxis: missing subcommand. Usage: pyxis <category> <action> [args]');
          return 1;
        }

        const category = args[0];
        const action = args[1];

        if (!action && !category.startsWith('-')) {
          await writeError('pyxis: missing action. Usage: pyxis <category> <action> [args]');
          return 1;
        }

        let cmdToCall: string;
        let subArgs: string[];

        if (action?.startsWith('-')) {
          cmdToCall = category;
          subArgs = args.slice(1);
        } else if (action) {
          cmdToCall = `${category}-${action}`;
          subArgs = args.slice(2);
        } else {
          cmdToCall = category;
          subArgs = args.slice(1);
        }

        await handlePyxisCommand(cmdToCall, subArgs, this.context.rootPath, writeOutput);
        return 0;
      } catch (e: any) {
        await writeError(`pyxis: ${e.message}`);
        return 1;
      }
    }

    // 4. Dev command (development/testing utilities)
    if (cmd === 'dev') {
      try {
        const { handleDevCommand } = await import('../handlers/devHandler');
        await handleDevCommand(args, this.context.rootPath, writeOutput);
        return 0;
      } catch (e: any) {
        await writeError(`dev: ${e.message}`);
        return 1;
      }
    }

    // 5. Extension commands
    if (this.commandRegistry?.hasCommand(cmd)) {
      try {
        const unix = await this.getUnix();
        const currentDir = unix ? await unix.pwd() : this.context.cwd;
        const result = await this.commandRegistry.executeCommand(cmd, args, {
          rootPath: this.context.rootPath,
          currentDirectory: currentDir,
          fsClient: this.fsClient,
        });
        await writeOutput(result);
        return 0;
      } catch (e: any) {
        await writeError(`${cmd}: ${e.message}`);
        return 1;
      }
    }

    // 6. Builtin commands (echo, ls, cat, grep, etc.)
    const builtins = await this.getBuiltins();
    if (builtins[cmd]) {
      const ctx: StreamCtx = {
        stdin: proc.stdinStream,
        stdinRedirected: proc.stdinRedirected,
        stdout: proc.stdoutStream,
        stderr: proc.stderrStream,
        onSignal: fn => {
          proc.on('signal', fn);
          return () => proc.off('signal', fn);
        },
        signal: this.context.signal,
        rootPath: this.context.rootPath,
        terminalColumns: this.context.terminalColumns,
        terminalRows: this.context.terminalRows,
      };

      try {
        await builtins[cmd](ctx, args);
        return 0;
      } catch (e: any) {
        if (e?.__silent) {
          return typeof e.code === 'number' ? e.code : 1;
        }
        throw e;
      }
    }

    // 7. Run installed local binaries.
    const unix = await this.getUnix();
    const cwd = unix ? await unix.pwd() : this.context.cwd;
    const localExitCode = await runLocalBinary({
      command: cmd,
      args,
      rootPath: this.context.rootPath,
      cwd,
      fsClient: this.fsClient,
      terminalColumns: this.context.terminalColumns,
      terminalRows: this.context.terminalRows,
      process: proc,
      signal: this.context.signal,
    });
    if (localExitCode !== null) return localExitCode;

    // 8. Command not found
    proc.writeStderr(`${cmd}: command not found\n`);
    return 127;
  }

  /**
   * Group segments by logical operators
   */
  private groupByLogicalOperators(
    segments: Segment[]
  ): Array<{ segs: Segment[]; opAfter?: string }> {
    const groups: Array<{ segs: Segment[]; opAfter?: string }> = [];
    let currentGroup: Segment[] = [];

    for (const seg of segments) {
      currentGroup.push(seg);
      if ((seg as any).logicalOp) {
        groups.push({ segs: currentGroup, opAfter: (seg as any).logicalOp });
        currentGroup = [];
      }
    }

    if (currentGroup.length > 0) {
      groups.push({ segs: currentGroup });
    }

    return groups;
  }

  /**
   * Kill the foreground process
   */
  killForeground(signal = 'SIGINT'): void {
    try {
      this.pendingSignal = signal;
      if (this.foregroundProc) {
        this.foregroundProc.kill(signal);
        this.pendingSignal = null;
      }
    } catch {}
  }

  /**
   * Set an alias
   */
  setAlias(name: string, expansion: string): void {
    this.context.aliases[name] = expansion;
  }

  /**
   * Get an alias
   */
  getAlias(name: string): string | undefined {
    return this.context.aliases[name];
  }

  /**
   * Set an environment variable
   */
  setEnv(key: string, value: string): void {
    this.context.env[key] = value;
  }

  /**
   * Get an environment variable
   */
  getEnv(key: string): string | undefined {
    return this.context.env[key];
  }
}

/**
 * Create a new shell executor
 */
export function createShellExecutor(options: ShellExecutorOptions): ShellExecutor {
  return new ShellExecutor(options);
}
