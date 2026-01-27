/**
 * Shell Executor
 * POSIX-compliant shell execution engine.
 * Directly uses existing handlers (gitHandler, npmHandler, pyxisHandler, unixHandler)
 * without unnecessary provider abstraction layer.
 */

import adaptBuiltins, { type StreamCtx } from './builtins';
import { expandTokens } from './expansion';
import { parseCommandLine } from './parser';
import { Process } from './process';
import { runScript } from './scriptRunner';
import { type Segment, type TokenObj, isDevNull } from './types';

import type { fileRepository as FileRepository } from '@/engine/core/fileRepository';
import { fsPathToAppPath, resolvePath } from '@/engine/core/pathUtils';
import type { UnixCommands } from '../global/unix';
import { ANSI } from '@/engine/cmd/terminalUI';

/**
 * Shell Executor Options
 */
export interface ShellExecutorOptions {
  projectName: string;
  projectId: string;
  unix?: UnixCommands;
  fileRepository?: typeof FileRepository;
  commandRegistry?: any;
  terminalColumns?: number;
  terminalRows?: number;
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
  projectName: string;
  projectId: string;
  cwd: string;
  env: Record<string, string>;
  aliases: Record<string, string>;
  terminalColumns: number;
  terminalRows: number;
}

/**
 * Shell Executor
 * Executes shell commands using existing handlers directly.
 */
export class ShellExecutor {
  private context: ExecutionContext;
  private unix: UnixCommands | null = null;
  private fileRepository: typeof FileRepository | undefined;
  private commandRegistry: any;
  private foregroundProc: Process | null = null;
  private builtins: Record<string, any> | null = null;

  constructor(options: ShellExecutorOptions) {
    this.context = {
      projectName: options.projectName,
      projectId: options.projectId,
      cwd: `/projects/${options.projectName}`,
      env: options.env ?? {},
      aliases: {},
      terminalColumns: options.terminalColumns ?? 80,
      terminalRows: options.terminalRows ?? 24,
    };

    this.unix = options.unix ?? null;
    this.fileRepository = options.fileRepository;
    this.commandRegistry = options.commandRegistry;
  }

  /**
   * Get unix commands instance
   */
  private async getUnix(): Promise<UnixCommands | null> {
    if (this.unix) return this.unix;

    try {
      const { terminalCommandRegistry } = await import('../terminalRegistry');
      this.unix = terminalCommandRegistry.getUnixCommands(
        this.context.projectName,
        this.context.projectId
      );
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
      segments = parseCommandLine(line) as Segment[];
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
    const fdBuffers: Record<number, string[]> = { 1: [], 2: [] };
    let lastExitCode: number | null = 0;
    let overallLastSeg: Segment | null = null;

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

      // Execute all commands in this group as a pipeline
      const procs: Process[] = [];

      for (const seg of group.segs) {
        const proc = await this.createProcessForSegment(seg, line);
        procs.push(proc);
      }

      // Wire up pipes
      for (let i = 0; i < procs.length - 1; i++) {
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
      this.watchProcessOutput(lastProc, lastSegOfGroup, fdBuffers, callbacks);

      // Set foreground process
      if (gi === groups.length - 1 && !lastSegOfGroup.background) {
        this.foregroundProc = lastProc;
        lastProc.on('exit', () => {
          if (this.foregroundProc?.pid === lastProc.pid) {
            this.foregroundProc = null;
          }
        });
      }

      // Wait for all processes to complete
      const exits = await Promise.all(procs.map(p => p.wait()));
      const exitOfLast = exits[exits.length - 1]?.code ?? 0;
      lastExitCode = exitOfLast;
      overallLastSeg = lastSegOfGroup;
    }

    // Collect output
    const finalOut = fdBuffers[1].join('');
    const finalErr = fdBuffers[2].join('');

    // Handle file redirections
    if (overallLastSeg && this.fileRepository) {
      await this.handleRedirections(overallLastSeg, fdBuffers, finalOut, finalErr);
    }

    // Determine returned output (suppress if redirected)
    const returnedStdout = this.shouldSuppressOutput(overallLastSeg, 1) ? '' : finalOut;
    const returnedStderr = this.shouldSuppressOutput(overallLastSeg, 2) ? '' : finalErr;

    return {
      stdout: returnedStdout,
      stderr: returnedStderr,
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
      projectId: this.context.projectId,
      projectName: this.context.projectName,
      fileRepository: this.fileRepository,
      unix: unix ?? undefined,
    });
    (seg as any).tokens = finalWords;

    // Handle stdin redirection
    if (seg.stdinFile && unix) {
      if (isDevNull(seg.stdinFile)) {
        proc.stdin.end();
      } else {
        (async () => {
          try {
            const content = await unix.cat([seg.stdinFile!]).catch(() => '');
            if (content !== undefined && content !== null) {
              proc.stdin.write(String(content));
            }
          } catch {}
          proc.stdin.end();
        })();
      }
    }

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

    const rawTokens = seg.tokens as string[];
    if (!rawTokens || rawTokens.length === 0) {
      proc.endStdout();
      proc.endStderr();
      proc.exit(0);
      return;
    }

    let cmd = String(rawTokens[0] ?? '');
    let args = rawTokens.slice(1).map(t => String(t));

    // Handle npx
    if (cmd === 'npx') {
      if (args.length === 0) {
        proc.writeStderr('npx: missing command\n');
        proc.endStdout();
        proc.endStderr();
        proc.exit(2);
        return;
      }
      cmd = args[0];
      args = args.slice(1);
    }

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
          const text = String(maybeContent);
          const firstLine = text.split('\n', 1)[0] || '';
          if (cmd.endsWith('.sh') || firstLine.startsWith('#!')) {
            // Save parent context CWD before script execution
            const savedCwd = await this.saveCwd(unix);

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
        await runScript(String(content), args, proc, this as any).catch(() => {});

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
    const writeOutput = async (output: string) => {
      proc.writeStdout(output);
      if (!output.endsWith('\n')) {
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
        await handleGitCommand(args, this.context.projectName, this.context.projectId, writeOutput);
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
          this.context.projectName,
          this.context.projectId,
          writeOutput,
          () => {} // setLoading - no-op in shell context
        );
        return 0;
      } catch (e: any) {
        await writeError(`npm: ${e.message}`);
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

        await handlePyxisCommand(
          cmdToCall,
          subArgs,
          this.context.projectName,
          this.context.projectId,
          writeOutput
        );
        return 0;
      } catch (e: any) {
        await writeError(`pyxis: ${e.message}`);
        return 1;
      }
    }

    // 4. Dev command (development/testing utilities)
    if (cmd === 'dev') {
      try {
        const { handleDevCommand } = await import('../handlers/dev');
        await handleDevCommand(args, this.context.projectName, this.context.projectId, writeOutput);
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
          projectName: this.context.projectName,
          projectId: this.context.projectId,
          currentDirectory: currentDir,
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
        stdout: proc.stdoutStream,
        stderr: proc.stderrStream,
        onSignal: fn => proc.on('signal', fn),
        projectName: this.context.projectName,
        projectId: this.context.projectId,
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

    // 7. Command not found
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
   * Watch process output streams
   */
  private watchProcessOutput(
    proc: Process,
    seg: Segment,
    fdBuffers: Record<number, string[]>,
    callbacks?: OutputCallbacks
  ): void {
    const watchFd = (fd: number) => {
      if (!fdBuffers[fd]) fdBuffers[fd] = [];

      try {
        const stream = proc.getFdWrite(fd);
        const fdFiles = (seg as any)?.fdFiles || {};
        const fileInfo = fdFiles[fd];

        if (fileInfo && isDevNull(fileInfo.path)) {
          stream.on('data', () => {}); // Discard
          return;
        }

        stream.on('data', (chunk: Buffer | string) => {
          const sRaw = String(chunk);
          // Store raw output for internal buffers / redirection (no ANSI)
          fdBuffers[fd].push(sRaw);

          // Real-time callbacks (provide raw output; coloring is handled in Terminal layer)
          if (fd === 1 && callbacks?.stdout) {
            callbacks.stdout(sRaw);
          } else if (fd === 2 && callbacks?.stderr) {
            callbacks.stderr(sRaw);
          }
        });
      } catch {}
    };

    watchFd(1);
    watchFd(2);

    // Watch additional fds
    if ((seg as any)?.fdFiles) {
      for (const k of Object.keys((seg as any).fdFiles)) {
        const fdn = Number(k);
        if (!Number.isNaN(fdn) && fdn > 2) {
          watchFd(fdn);
        }
      }
    }
  }

  /**
   * Handle file redirections
   */
  private async handleRedirections(
    seg: Segment,
    fdBuffers: Record<number, string[]>,
    finalOut: string,
    finalErr: string
  ): Promise<void> {
    if (!this.fileRepository) return;

    const writes: Record<string, string> = {};
    const appendMap: Record<string, boolean> = {};

    // Get current working directory for resolving relative paths
    const unix = await this.getUnix();
    const cwd = unix ? await unix.pwd() : this.context.cwd;

    // Helper to resolve path relative to CWD and convert to AppPath
    const resolveRedirectPath = (path: string): string => {
      if (!path || isDevNull(path)) return path;

      // If absolute path (within project), use it
      if (path.startsWith('/')) {
        return path;
      }

      // Resolve relative path against CWD, then convert to AppPath
      const resolvedFsPath = resolvePath(cwd, path);
      return fsPathToAppPath(resolvedFsPath, this.context.projectName);
    };

    const add = (path: string | undefined | null, content: string, append = false) => {
      if (!path || isDevNull(path)) return;
      const key = resolveRedirectPath(path);
      if (!key || isDevNull(key)) return;
      writes[key] = (writes[key] || '') + content;
      appendMap[key] = appendMap[key] || append;
    };

    // Handle fdFiles
    if ((seg as any).fdFiles) {
      for (const k of Object.keys((seg as any).fdFiles)) {
        const fdn = Number(k);
        if (Number.isNaN(fdn)) continue;
        const info = (seg as any).fdFiles[fdn];
        if (isDevNull(info.path)) continue;
        const content = (fdBuffers[fdn] || []).join('');
        add(info.path, content, !!info.append);
      }
    }

    // Legacy stdout/stderr fields
    const hasFdFiles = (seg as any).fdFiles && Object.keys((seg as any).fdFiles).length > 0;
    if (!hasFdFiles) {
      if (seg.stdoutFile) {
        add(seg.stdoutFile, finalOut, !!seg.append);
      }
      if (seg.stderrFile) {
        add(seg.stderrFile, finalErr, false);
      }
    }

    // Perform writes
    for (const pth of Object.keys(writes)) {
      try {
        let contentToWrite = writes[pth];

        if (appendMap[pth]) {
          const existing =
            typeof this.fileRepository.getFileByPath === 'function'
              ? await this.fileRepository.getFileByPath(this.context.projectId, pth)
              : null;
          if (existing?.content) {
            contentToWrite = existing.content + contentToWrite;
          }
        }

        const existing =
          typeof this.fileRepository.getFileByPath === 'function'
            ? await this.fileRepository.getFileByPath(this.context.projectId, pth)
            : null;

        if (existing) {
          await this.fileRepository.saveFile({
            ...existing,
            content: contentToWrite,
            updatedAt: new Date(),
          });
        } else {
          await this.fileRepository.createFile(this.context.projectId, pth, contentToWrite, 'file');
        }
      } catch {}
    }
  }

  /**
   * Check if output should be suppressed (redirected)
   */
  private shouldSuppressOutput(seg: Segment | null, fd: number): boolean {
    if (!seg) return false;

    const fdFiles = (seg as any)?.fdFiles;
    const file = fdFiles?.[fd];
    if (file) return true;

    if (fd === 1) {
      if (seg.stdoutFile || seg.stdoutToStderr) return true;
      if (seg.stdoutFile && isDevNull(seg.stdoutFile)) return true;
    }

    if (fd === 2) {
      if (seg.stderrFile || seg.stderrToStdout) return true;
      if (seg.stderrFile && isDevNull(seg.stderrFile)) return true;
    }

    return false;
  }

  /**
   * Kill the foreground process
   */
  killForeground(signal = 'SIGINT'): void {
    try {
      if (this.foregroundProc) {
        this.foregroundProc.kill(signal);
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
