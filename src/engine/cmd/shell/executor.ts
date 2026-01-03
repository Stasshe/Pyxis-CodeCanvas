/**
 * Shell Executor
 * Core shell execution engine using the provider-based architecture.
 * Handles command parsing, resolution, and execution with full POSIX support.
 */

import { Process, type ProcExit } from './process';
import { parseCommandLine } from './parser';
import { expandTokens } from './expansion';
import { runScript } from './scriptRunner';
import { isDevNull, type Segment, type TokenObj } from './types';
import { ExecutionContext, createExecutionContext } from './context/executionContext';
import { StreamManager, createStreamManager } from './io/streamManager';
import {
  getProviderRegistry,
  setupDefaultProviders,
  CommandResolver,
  createCommandResolver,
  type IExecutionContext,
  type IStreamManager,
  type ResolvedCommand,
  type ExecutionResult,
  CommandNotFoundError,
  ProviderType,
} from './providers';

import type { UnixCommands } from '../global/unix';
import type { fileRepository as FileRepository } from '@/engine/core/fileRepository';

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
 * Shell Executor
 * Executes shell commands using the provider-based architecture.
 */
export class ShellExecutor {
  private context: IExecutionContext;
  private resolver: CommandResolver;
  private unix: UnixCommands | null = null;
  private fileRepository: typeof FileRepository | undefined;
  private commandRegistry: any;
  private foregroundProc: Process | null = null;
  private initialized = false;

  constructor(options: ShellExecutorOptions) {
    // Create system module accessor
    const getSystemModule = async (moduleName: string) => {
      switch (moduleName) {
        case 'unixCommands':
          return this.getUnix();
        case 'fileRepository':
          return this.fileRepository;
        case 'commandRegistry':
          return this.commandRegistry;
        default:
          throw new Error(`Unknown system module: ${moduleName}`);
      }
    };

    // Create execution context
    this.context = createExecutionContext(
      options.projectName,
      options.projectId,
      getSystemModule,
      {
        isInteractive: options.isInteractive ?? true,
        terminalColumns: options.terminalColumns ?? 80,
        terminalRows: options.terminalRows ?? 24,
        env: options.env,
      }
    );

    // Store references
    this.unix = options.unix ?? null;
    this.fileRepository = options.fileRepository;
    this.commandRegistry = options.commandRegistry;

    // Create resolver (registry will be initialized lazily)
    const registry = getProviderRegistry();
    this.resolver = createCommandResolver(registry);
  }

  /**
   * Initialize the shell executor
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Setup default providers
    await setupDefaultProviders();

    // If a custom command registry was provided, configure the extension provider
    if (this.commandRegistry) {
      const registry = getProviderRegistry();
      const extProvider = registry.getProvider('pyxis.provider.extension');
      if (extProvider && typeof (extProvider as any).setCommandRegistry === 'function') {
        (extProvider as any).setCommandRegistry(this.commandRegistry);
      }
    }

    // Initialize providers
    const registry = getProviderRegistry();
    await registry.initializeProviders(this.context.projectId, this.context);

    this.initialized = true;
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
   * Update terminal size
   */
  setTerminalSize(columns: number, rows: number): void {
    (this.context as ExecutionContext).setTerminalSize(columns, rows);
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
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

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
        try { p.emit('pipes-ready'); } catch {}
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
            const content = await unix.cat(seg.stdinFile!).catch(() => '');
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

    // Create stream context
    const streams: IStreamManager = {
      stdin: proc.stdinStream,
      stdout: proc.stdoutStream,
      stderr: proc.stderrStream,
      writeStdout: async (data) => {
        proc.writeStdout(typeof data === 'string' ? data : data.toString());
      },
      writeStderr: async (data) => {
        proc.writeStderr(typeof data === 'string' ? data : data.toString());
      },
      endStdout: () => proc.endStdout(),
      endStderr: () => proc.endStderr(),
    };

    try {
      // Check for script files
      if (unix && (cmd.includes('/') || cmd.endsWith('.sh'))) {
        const maybeContent = await unix.cat(cmd).catch(() => null);
        if (maybeContent !== null) {
          const text = String(maybeContent);
          const firstLine = text.split('\n', 1)[0] || '';
          if (cmd.endsWith('.sh') || firstLine.startsWith('#!')) {
            const scriptArgs = [cmd, ...args];
            try {
              await runScript(text, scriptArgs, proc, this as any);
            } catch (e: any) {
              proc.writeStderr(e?.message ?? String(e));
            }
            proc.endStdout();
            proc.endStderr();
            proc.exit(0);
            return;
          }
        }
      }

      // Handle sh/bash command
      if (cmd === 'sh' || cmd === 'bash') {
        if (args.length === 0) {
          proc.writeStderr('Usage: sh <file>\n');
          proc.endStdout();
          proc.exit(2);
          return;
        }
        let content = unix ? await unix.cat(args[0]).catch(() => null) : null;
        if (content === null) {
          proc.writeStderr(`sh: ${args[0]}: No such file\n`);
          proc.endStdout();
          proc.exit(1);
          return;
        }
        await runScript(String(content), args, proc, this as any).catch(() => {});
        proc.endStdout();
        proc.endStderr();
        proc.exit(0);
        return;
      }

      // Resolve command through provider system
      try {
        const resolved = await this.resolver.resolve(cmd, {
          skipAliases: false,
          skipFunctions: false,
          onlyBuiltins: false,
          context: this.context,
        });

        const result = await this.executeResolved(resolved, cmd, args, streams);
        proc.endStdout();
        proc.endStderr();
        proc.exit(result.exitCode);
      } catch (error) {
        if (error instanceof CommandNotFoundError) {
          proc.writeStderr(`${cmd}: command not found\n`);
          if (error.suggestions.length > 0) {
            proc.writeStderr(`Did you mean: ${error.suggestions.join(', ')}?\n`);
          }
          proc.endStdout();
          proc.endStderr();
          proc.exit(127);
        } else {
          const msg = error instanceof Error ? error.message : String(error);
          proc.writeStderr(`${cmd}: ${msg}\n`);
          proc.endStdout();
          proc.endStderr();
          proc.exit(1);
        }
      }
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
      proc.writeStderr(msg);
      proc.endStdout();
      proc.endStderr();
      proc.exit(1);
    }
  }

  /**
   * Execute a resolved command
   */
  private async executeResolved(
    resolved: ResolvedCommand,
    command: string,
    args: string[],
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    // Handle aliases
    if (resolved.type === 'alias' && resolved.expansion) {
      const expandedLine = `${resolved.expansion} ${args.join(' ')}`;
      const result = await this.run(expandedLine);
      return { exitCode: result.code ?? 0 };
    }

    // Handle functions
    if (resolved.type === 'function' && resolved.body) {
      // Execute function body in subshell
      const childContext = this.context.fork({ copyFunctions: true });
      childContext.setPositionalParams([resolved.body.name, ...args]);

      const result = await this.run(resolved.body.body);
      return { exitCode: result.code ?? 0 };
    }

    // Execute through provider
    if (resolved.provider) {
      return await resolved.provider.execute(command, args, this.context, streams);
    }

    throw new CommandNotFoundError(command);
  }

  /**
   * Group segments by logical operators
   */
  private groupByLogicalOperators(segments: Segment[]): Array<{ segs: Segment[]; opAfter?: string }> {
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
          const s = String(chunk);
          fdBuffers[fd].push(s);

          // Real-time callbacks
          if (fd === 1 && callbacks?.stdout) {
            callbacks.stdout(s);
          } else if (fd === 2 && callbacks?.stderr) {
            callbacks.stderr(s);
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

    const add = (path: string | undefined | null, content: string, append = false) => {
      if (!path || isDevNull(path)) return;
      const key = path.startsWith('/') ? path : `/${path}`;
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
          const existing = typeof this.fileRepository.getFileByPath === 'function'
            ? await this.fileRepository.getFileByPath(this.context.projectId, pth)
            : null;
          if (existing?.content) {
            contentToWrite = existing.content + contentToWrite;
          }
        }

        const existing = typeof this.fileRepository.getFileByPath === 'function'
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
   * Get the execution context
   */
  getContext(): IExecutionContext {
    return this.context;
  }

  /**
   * Set an alias
   */
  setAlias(name: string, expansion: string): void {
    this.context.setAlias(name, expansion);
  }

  /**
   * Get an alias
   */
  getAlias(name: string): string | undefined {
    return this.context.getAlias(name);
  }

  /**
   * Set an environment variable
   */
  setEnv(key: string, value: string): void {
    this.context.setEnv(key, value);
  }

  /**
   * Get an environment variable
   */
  getEnv(key: string): string | undefined {
    return this.context.getEnv(key);
  }
}

/**
 * Create a new shell executor
 */
export function createShellExecutor(options: ShellExecutorOptions): ShellExecutor {
  return new ShellExecutor(options);
}
