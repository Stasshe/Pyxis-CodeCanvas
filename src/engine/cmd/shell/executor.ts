import type TerminalUI from '@/engine/cmd/terminalUI';
import { fsClient as defaultFsClient, type FsApi } from '@/engine/core/fs';
import type { UnixCommands } from '../global/unix';
import { startBackgroundJob } from './backgroundJob';
import adaptBuiltins from './builtins';
import { dispatchCommand } from './commandDispatch';
import { groupCommands } from './commandGroups';
import { createEnvironment, unsetEnvironmentValue } from './environment';
import { ParseError, SilentCommandError } from './errors';
import { createForkedShell } from './forkShell';
import { ShellJobs } from './jobs';
import { ShellLifecycle } from './lifecycle';
import { ShellOutputHandler } from './outputHandler';
import { parseCommandLine } from './parser';
import { runPipeline } from './pipeline';
import { Process } from './process';
import { expandProcessSegmentForShell } from './processExpansion';
import {
  createProcessSubstitutionHandler,
  type ProcessSubstitutionHandler,
} from './processSubstitution';
import {
  assignArray,
  cloneScriptControlState,
  createScriptControlState,
  enterFunctionArguments,
  type ScriptControlState,
} from './scriptControls';
import {
  executeControlWords,
  runCompound,
  runInteractiveExitTrap,
  runScript,
  type ScriptExecutionOptions,
  SHELL_CONTROL_COMMANDS,
} from './scriptRunner';
import type {
  CompoundCommand,
  OutputCallbacks,
  Segment,
  ShellExecutionOptions,
  ShellExecutorOptions,
  ShellRunResult,
  StreamBuiltin,
} from './types';
import {
  type ExpansionResources,
  expandTextForShell,
  expandWordsForShell,
  type ShellExpansionContext,
} from './wordExpansion';

export type { OutputCallbacks, ShellExecutorOptions, ShellRunResult } from './types';

interface ExecutionContext {
  rootPath: string;
  signal?: AbortSignal;
  cwd: string;
  env: Record<string, string>;
  terminalColumns: number;
  terminalRows: number;
  pipefail: boolean;
  nounset: boolean;
  errexit: boolean;
  errtrace: boolean;
  interactive: boolean;
}

export class ShellExecutor {
  private context: ExecutionContext;
  private scriptState = createScriptControlState();
  private requestedExit: number | null = null;
  private requestedReturn: number | null = null;
  private activeRuns = 0;
  private lifecycle = new ShellLifecycle();
  private trackDetachedProcess = this.lifecycle.trackDetachedProcess.bind(this.lifecycle);
  private jobs = new ShellJobs();
  private fsClient: FsApi;
  private outputHandler: ShellOutputHandler;
  private unix: UnixCommands | null = null;
  private commandRegistry: ShellExecutorOptions['commandRegistry'];
  private terminalUI?: TerminalUI;
  private foregroundProc: Process | null = null;
  private foregroundProcesses = new Set<Process>();
  private processSubstitutionHandler: ProcessSubstitutionHandler;
  private pendingSignal: string | null = null;
  private builtins: Record<string, StreamBuiltin> | null = null;
  private abortSignal?: AbortSignal;
  private abortListener?: () => void;
  private disposed = false;

  constructor(options: ShellExecutorOptions) {
    this.trackDetachedProcess = options.trackDetachedProcess ?? this.trackDetachedProcess;
    this.context = {
      rootPath: options.rootPath,
      signal: options.signal,
      cwd: options.cwd ?? options.rootPath,
      env: createEnvironment(options.env),
      terminalColumns: options.terminalColumns ?? 80,
      terminalRows: options.terminalRows ?? 24,
      pipefail: false,
      nounset: false,
      errexit: false,
      errtrace: false,
      interactive: options.isInteractive ?? false,
    };
    this.context.env.PWD = this.context.cwd;
    this.context.env['?'] = '0';

    this.unix = options.unix ?? null;
    this.fsClient = options.fsClient ?? defaultFsClient;
    this.outputHandler = new ShellOutputHandler(this.fsClient, async () => {
      const unix = await this.getUnix();
      if (unix) return unix.pwd();
      return this.context.cwd;
    });
    this.processSubstitutionHandler = createProcessSubstitutionHandler({
      fsClient: this.fsClient,
      fork: () => this.fork(),
      registerParentFifoOwner: (path, ownerId) =>
        this.outputHandler.registerFifoOwner(path, ownerId),
      releaseParentFifoOwner: path => this.outputHandler.releaseFifoOwner(path),
      trackChild: (child, tracked) => this.lifecycle.trackChild(child, tracked),
      addJob: (completion, callbacks, cancel, pid) =>
        this.jobs.add(completion, callbacks, cancel, pid),
      setLastJob: pid => {
        this.context.env['!'] = String(pid);
      },
    });
    this.commandRegistry = options.commandRegistry;
    this.terminalUI = options.terminalUI;
    if (options.signal) {
      this.abortSignal = options.signal;
      this.abortListener = () => {
        const reason = options.signal?.reason;
        if (typeof reason === 'string') this.killForeground(reason);
        else this.killForeground('SIGINT');
      };
      options.signal.addEventListener('abort', this.abortListener, { once: true });
    }
    if (options.signal?.aborted) this.pendingSignal = 'SIGINT';
  }

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

  private async getBuiltins(): Promise<Record<string, StreamBuiltin>> {
    if (this.builtins) return this.builtins;
    const unix = await this.getUnix();
    if (!unix) throw new Error('Unix command support is unavailable');
    this.builtins = adaptBuiltins(unix);
    return this.builtins;
  }

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

  async getCommandNames(): Promise<string[]> {
    const names = new Set(Object.keys(await this.getBuiltins()));
    for (const name of SHELL_CONTROL_COMMANDS) names.add(name);
    for (const name of this.commandRegistry?.getRegisteredCommands() ?? []) names.add(name);
    return [...names].sort();
  }

  async run(
    line: string,
    callbacks?: OutputCallbacks,
    execution: ShellExecutionOptions = {}
  ): Promise<ShellRunResult> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let status = 0;
    let errexitEligible = false;
    let interrupted = false;
    this.activeRuns++;
    try {
      const segments = parseCommandLine(line);
      const groups = groupCommands(segments);
      for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        const previous = groups[index - 1]?.operator;
        if (previous === '&&' && status !== 0) continue;
        if (previous === '||' && status === 0) continue;
        const ignored =
          execution.errexitIgnored ||
          group.segments[0]?.inverted ||
          group.operator === '&&' ||
          group.operator === '||';
        const run = () =>
          this.runPipelineGroup(group.segments, callbacks, execution, Boolean(ignored), true);
        if (group.operator === '&') {
          const identity = await startBackgroundJob(this.jobs, callbacks, async pid => {
            const child = await this.fork();
            return {
              completion: child.runPipelineGroup(
                group.segments,
                callbacks,
                { ...execution, processPid: pid },
                Boolean(execution.errexitIgnored || group.segments[0]?.inverted),
                false
              ),
              dispose: () => child.dispose(),
            };
          });
          this.context.env['!'] = String(identity.pid);
          status = 0;
          this.context.env['?'] = '0';
          continue;
        }
        const result = await run();
        stdout.push(result.stdout);
        stderr.push(result.stderr);
        status = result.code ?? 0;
        interrupted = result.interrupted === true;
        for (const name of Object.keys(this.context.env)) {
          if (/^PIPESTATUS\[\d+\]$/.test(name)) delete this.context.env[name];
        }
        for (let stage = 0; stage < result.statuses.length; stage++) {
          this.context.env[`PIPESTATUS[${stage}]`] = String(result.statuses[stage]);
        }
        this.context.env['?'] = String(status);
        errexitEligible = !ignored;
        if (
          this.requestedExit !== null ||
          this.requestedReturn !== null ||
          this.scriptState.loopControl ||
          interrupted
        )
          break;
        if (this.context.errexit && errexitEligible && status !== 0) break;
      }
      if (this.requestedExit !== null) status = this.requestedExit;
      this.context.env['?'] = String(status);
      return {
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        code: status,
        errexitEligible,
        exitShell: this.requestedExit !== null,
        interrupted,
      };
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      const diagnostic = `Shell error: ${message}\n`;
      stderr.push(diagnostic);
      callbacks?.stderr?.(diagnostic);
      let code = 1;
      if (error instanceof ParseError) code = 2;
      this.context.env['?'] = String(code);
      return {
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        code,
        errexitEligible: true,
        fatalError: true,
      };
    } finally {
      this.activeRuns--;
      if (this.activeRuns === 0 && !this.lifecycle.insideScript) this.requestedExit = null;
      if (this.activeRuns === 0 && this.foregroundProcesses.size === 0) this.pendingSignal = null;
    }
  }

  private async runPipelineGroup(
    segments: Segment[],
    callbacks: OutputCallbacks | undefined,
    execution: ShellExecutionOptions,
    ignored: boolean,
    foreground: boolean
  ): Promise<ShellRunResult & { statuses: number[] }> {
    const shells = new Map<Process, ShellExecutor>();
    const result = await runPipeline(segments, {
      createProcess: async segment => {
        let shell: ShellExecutor = this;
        if (segments.length > 1) shell = await this.fork();
        try {
          const processPid =
            segment === segments[segments.length - 1] ? execution.processPid : undefined;
          const process = await shell.createProcessForSegment(segment, callbacks, processPid);
          shells.set(process, shell);
          if (shell.disposed) {
            process.kill('SIGTERM');
            process.exit(null, 'SIGTERM');
          }
          let removeSignalHandler = () => {};
          if (shell !== this) {
            removeSignalHandler = process.handleSignal(signal => {
              if (shell.foregroundProcesses.size === 0) process.exit(null, signal);
              else shell.killForeground(signal);
            });
          }
          if (foreground) this.foregroundProcesses.add(process);
          process.on('exit', () => {
            removeSignalHandler();
          });
          process.once('io-complete', () => {
            this.foregroundProcesses.delete(process);
            if (this.foregroundProc === process) this.foregroundProc = null;
            if (shell !== this) shell.dispose();
          });
          return process;
        } catch (error) {
          if (shell !== this) shell.dispose();
          throw error;
        }
      },
      startProcess: (process, segment) => {
        const shell = shells.get(process) ?? this;
        const ignoreStage = ignored || segment !== segments[segments.length - 1];
        return shell.startSegment(process, segment, ignoreStage, execution.inFunction ?? false);
      },
      outputHandler: this.outputHandler,
      pipefail: this.context.pipefail,
      callbacks,
      stdin: execution.stdin,
      interactive: this.context.interactive,
      isForeground: foreground,
      stdinIsTTY: execution.stdinIsTTY,
      stdinDestination: execution.stdinDestination,
      stdoutIsTTY: execution.stdoutIsTTY,
      stderrIsTTY: execution.stderrIsTTY,
      foreground: process => {
        if (!foreground) return;
        this.foregroundProc = process;
        if (this.pendingSignal) {
          for (const process of this.foregroundProcesses) process.kill(this.pendingSignal);
          this.pendingSignal = null;
        }
      },
    });
    if (segments[0]?.inverted && !result.interrupted) {
      if (result.code === 0) result.code = 1;
      else result.code = 0;
    }
    return result;
  }

  private async startSegment(
    proc: Process,
    segment: Segment,
    ignored: boolean,
    inFunction: boolean
  ): Promise<void> {
    try {
      const unix = await this.getUnix();
      if (proc.hasExited) return;
      if (this.pendingSignal === 'SIGINT') {
        this.pendingSignal = null;
        proc.exit(130);
        return;
      }
      await this.executeSegment(proc, segment, unix, ignored, inFunction);
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      proc.writeStderr(`${message}\n`);
      proc.exit(1);
    }
  }

  private runScript(
    text: string | CompoundCommand,
    args: string[],
    proc: Process,
    execution?: ScriptExecutionOptions
  ): Promise<number> {
    return this.lifecycle.runScript(() => {
      if (typeof text === 'string') return runScript(text, args, proc, this, execution);
      if (text.kind === 'group' || text.kind === 'subshell')
        return runScript(text.source, args, proc, this, execution);
      return runCompound(text, proc, this, execution);
    });
  }

  async runInSubshell(line: string): Promise<ShellRunResult> {
    this.activeRuns++;
    try {
      const child = await this.fork();
      child.setErrexit(false);
      return await this.lifecycle.captureSubshell(
        child,
        proc =>
          child.runScript(line, [], proc, {
            initializeArguments: false,
            initialStatus: Number(this.context.env['?']),
            finalizesShell: true,
          }),
        this.pendingSignal
      );
    } finally {
      this.activeRuns--;
      if (this.activeRuns === 0 && this.foregroundProcesses.size === 0) this.pendingSignal = null;
    }
  }

  async expandWords(source: string, callbacks?: OutputCallbacks): Promise<string[]> {
    return expandWordsForShell(source, this.getExpansionContext(), this, callbacks);
  }

  async expandText(source: string): Promise<string> {
    return expandTextForShell(source, this.getExpansionContext(), this);
  }

  private getExpansionContext(cwd = this.context.cwd): ShellExpansionContext {
    return {
      rootPath: this.context.rootPath,
      cwd,
      fsClient: this.fsClient,
      env: this.context.env,
      nounset: this.context.nounset,
      getWorkingDirectory: async () => {
        const unix = await this.getUnix();
        if (unix) return unix.pwd();
        return this.context.cwd;
      },
    };
  }

  async processSubstitution(
    command: string,
    direction: 'input' | 'output',
    resources?: ExpansionResources
  ): Promise<string> {
    if (!resources)
      throw new Error('Process substitution requires command-owned expansion resources');
    return this.processSubstitutionHandler(command, direction, resources);
  }

  registerFifoOwner(path: string, ownerId: string): void {
    this.outputHandler.registerFifoOwner(path, ownerId);
  }

  releaseFifoOwner(path: string): void {
    this.outputHandler.releaseFifoOwner(path);
  }

  async fork(): Promise<ShellExecutor> {
    const unix = await this.getUnix();
    const child = await createForkedShell(
      {
        rootPath: this.context.rootPath,
        cwd: this.context.cwd,
        signal: this.context.signal,
        fsClient: this.fsClient,
        unix: unix ?? undefined,
        commandRegistry: this.commandRegistry,
        terminalColumns: this.context.terminalColumns,
        terminalRows: this.context.terminalRows,
        terminalUI: this.terminalUI,
        env: this.context.env,
        pipefail: this.context.pipefail,
        nounset: this.context.nounset,
        trackDetachedProcess: this.trackDetachedProcess,
      },
      options => new ShellExecutor(options)
    );
    child.context.env['?'] = this.context.env['?'];
    child.context.errexit = this.context.errexit;
    child.context.errtrace = this.context.errtrace;
    child.scriptState = cloneScriptControlState(this.scriptState);
    for (const [signal, handler] of child.scriptState.traps) {
      if (handler === '') continue;
      if (signal === 'ERR' && this.context.errtrace) continue;
      child.scriptState.traps.delete(signal);
    }
    return child;
  }

  private async runScriptInChild(text: string, args: string[], proc: Process): Promise<number> {
    const child = await this.fork();
    return this.lifecycle.runChildScript(child, proc, () => child.runScript(text, args, proc));
  }

  setPipefail(enabled: boolean): void {
    this.context.pipefail = enabled;
  }

  setNounset(enabled: boolean): void {
    this.context.nounset = enabled;
  }

  private async createProcessForSegment(
    seg: Segment,
    callbacks?: OutputCallbacks,
    processPid?: number
  ): Promise<Process> {
    const proc = new Process(processPid);
    proc.outputCallbacks = callbacks;
    await expandProcessSegmentForShell(
      seg,
      proc,
      this.getExpansionContext(this.context.env.PWD),
      this,
      this.fsClient,
      this.outputHandler,
      callbacks
    );

    proc.stdinRedirected =
      seg.redirections?.some(redirection => redirection.kind === 'input') === true ||
      seg.stdinText !== undefined;

    return proc;
  }

  private async executeSegment(
    proc: Process,
    seg: Segment,
    unix: UnixCommands | null,
    errexitIgnored: boolean,
    inFunction: boolean
  ): Promise<void> {
    if (seg.stdinText !== undefined) {
      let text = seg.stdinText;
      if (seg.stdinExpand) text = await this.expandText(text);
      proc.stdin.end(text);
    }
    if (seg.functionDefinition) {
      this.scriptState.functions.set(seg.functionDefinition.name, seg.functionDefinition.source);
      proc.exit(0);
      return;
    }
    if (seg.compound) {
      let shell: ShellExecutor = this;
      if (seg.compound.kind === 'subshell') shell = await this.fork();
      if (proc.hasExited) {
        if (shell !== this) shell.dispose();
        return;
      }
      const forwardSignal = (signal: string) => shell.killForeground(signal);
      let removeSignalHandler = () => {};
      if (shell !== this) removeSignalHandler = proc.handleSignal(forwardSignal);
      try {
        const code = await shell.runScript(seg.compound, [], proc, {
          initializeArguments: false,
          errexitIgnored,
          inFunction,
          initialStatus: Number(shell.getEnv('?') ?? 0),
          finalizesShell: seg.compound.kind === 'subshell',
        });
        proc.exit(code);
      } finally {
        if (shell !== this) {
          removeSignalHandler();
          shell.dispose();
        }
      }
      return;
    }
    if (await assignArray(seg.raw, this)) {
      proc.exit(0);
      return;
    }
    if (seg.assignmentOnly) {
      proc.endStdout();
      proc.endStderr();
      proc.exit(seg.commandSubStatus ?? 0);
      return;
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
    const control = await executeControlWords([cmd, ...args], proc, this, inFunction);
    if (control) {
      if (control.kind === 'return') this.requestedReturn = control.code;
      proc.exit(control.code);
      return;
    }
    const body = this.scriptState.functions.get(cmd);
    if (body !== undefined) {
      const restoreArguments = enterFunctionArguments(this, args);
      const outerReturn = this.requestedReturn;
      this.requestedReturn = null;
      try {
        proc.exit(
          await this.runScript(body, [], proc, {
            initializeArguments: false,
            inFunction: true,
            errexitIgnored,
          })
        );
      } finally {
        this.requestedReturn = outerReturn;
        restoreArguments();
      }
      return;
    }
    if (cmd === 'wait') {
      proc.exit(await this.jobs.wait(args, proc));
      return;
    }
    if (cmd === 'cd' && args.length === 0) args.push(this.context.env.HOME);

    try {
      if (unix && (cmd.includes('/') || cmd.endsWith('.sh'))) {
        const maybeContent = await unix.cat([cmd]).catch(() => null);
        if (maybeContent !== null) {
          let text = maybeContent;
          if (typeof text !== 'string')
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(text);
          const firstLine = text.split('\n', 1)[0] || '';
          if (cmd.endsWith('.sh') || firstLine.startsWith('#!')) {
            const isNodeShebang = /node/.test(firstLine);
            const isJsFile = cmd.endsWith('.js') || /\.js$/.test(cmd);

            if (isNodeShebang || isJsFile) {
              try {
                const exitCode = await this.executeCommand('node', [cmd, ...args], proc);
                proc.endStdout();
                proc.endStderr();
                proc.exit(exitCode);
                return;
              } catch (error) {
                let message = String(error);
                if (error instanceof Error) message = error.message;
                proc.writeStderr(message);
                proc.endStdout();
                proc.endStderr();
                proc.exit(1);
                return;
              }
            }

            const scriptArgs = [cmd, ...args];
            const exitCode = await this.runScriptInChild(text, scriptArgs, proc);
            proc.endStdout();
            proc.endStderr();
            proc.exit(exitCode);
            return;
          }
        }
      }

      if (cmd === 'sh' || cmd === 'bash') {
        if (args.length === 0) {
          proc.writeStderr('Usage: sh <file>\n');
          proc.endStdout();
          proc.exit(2);
          return;
        }
        let content: string | Uint8Array | null = null;
        if (unix) content = await unix.cat([args[0]]).catch(() => null);
        if (content === null) {
          proc.writeStderr(`sh: ${args[0]}: No such file\n`);
          proc.endStdout();
          proc.exit(1);
          return;
        }

        let script = content;
        if (typeof script !== 'string')
          script = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(script);
        const exitCode = await this.runScriptInChild(script, args, proc);

        proc.endStdout();
        proc.endStderr();
        proc.exit(exitCode);
        return;
      }

      const exitCode = await this.executeCommand(cmd, args, proc);
      proc.endStdout();
      proc.endStderr();
      proc.exit(exitCode);
    } catch (error) {
      if (error instanceof SilentCommandError) {
        const code = error.code;
        proc.endStdout();
        proc.endStderr();
        proc.exit(code);
        return;
      }

      let msg = String(error);
      if (error instanceof Error) msg = error.message;
      proc.writeStderr(`${msg}\n`);
      proc.endStdout();
      proc.endStderr();
      proc.exit(1);
    }
  }

  private async executeCommand(cmd: string, args: string[], proc: Process): Promise<number> {
    return dispatchCommand(cmd, args, proc, {
      ...this.context,
      fsClient: this.fsClient,
      commandRegistry: this.commandRegistry,
      trackDetachedProcess: this.trackDetachedProcess,
      getUnix: () => this.getUnix(),
      setPwd: value => {
        this.context.env.PWD = value;
        this.unix?.setCurrentDir(value);
      },
    });
  }

  getScriptState(): ScriptControlState {
    return this.scriptState;
  }
  setErrexit(enabled: boolean): void {
    this.context.errexit = enabled;
  }
  getErrexit(): boolean {
    return this.context.errexit;
  }
  setErrtrace(enabled: boolean): void {
    this.context.errtrace = enabled;
  }
  getErrtrace(): boolean {
    return this.context.errtrace;
  }
  getNounset(): boolean {
    return this.context.nounset;
  }
  finalizeInteractiveExit(proc: Process, status: number): Promise<number> {
    return runInteractiveExitTrap(status, proc, this, this.lifecycle.insideScript);
  }
  requestExit(code: number): void {
    this.requestedExit = code;
  }
  getRequestedExit(): number | undefined {
    return this.requestedExit ?? undefined;
  }
  clearRequestedExit(): void {
    this.requestedExit = null;
  }

  requestReturn(code: number): void {
    this.requestedReturn = code;
  }
  getRequestedReturn(): number | undefined {
    return this.requestedReturn ?? undefined;
  }
  clearRequestedReturn(): void {
    this.requestedReturn = null;
  }

  killForeground(signal = 'SIGINT'): void {
    this.lifecycle.killForeground(
      signal,
      this.activeRuns > 0,
      this.foregroundProcesses,
      this.foregroundProc !== null,
      pendingSignal => {
        this.pendingSignal = pendingSignal;
      }
    );
  }

  setEnv(key: string, value: string): void {
    this.context.env[key] = value;
  }

  getEnv(key: string): string | undefined {
    return this.context.env[key];
  }
  getEnvironment(): Readonly<Record<string, string>> {
    return { ...this.context.env };
  }
  unsetEnv(key: string): void {
    unsetEnvironmentValue(this.context.env, key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.activeRuns > 0) this.pendingSignal = 'SIGTERM';
    this.lifecycle.dispose(
      () => this.jobs.cancelAll(),
      this.foregroundProcesses,
      this.abortSignal,
      this.abortListener
    );
  }
}
