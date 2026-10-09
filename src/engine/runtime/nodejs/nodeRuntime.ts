/** Node.js runtime execution and process lifecycle. */

import type { Readable } from 'node:stream';
import { getParentPath, HOME_DIR, resolvePath } from '@/engine/core/pathUtils';
import type { RuntimeBridge } from '@/engine/runtime/bridge/client';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import { runtimeError, runtimeInfo } from '../core/runtimeLogger';
import { createRuntimeFunction } from '../module/dynamicFunction';
import { ModuleLoader } from '../module/moduleLoader';
import { type BuiltInModules, createBuiltInModules } from './builtInModule';
import { formatNodeError } from './nodeErrors';
import {
  createProcessExitSignal,
  isProcessExitSignal,
  normalizeProcessExitCode,
  validateProcessExitCode,
} from './processExit';
import { RuntimeBuiltinResolver } from './runtimeBuiltinResolver';
import { createRuntimeConsole } from './runtimeConsole';
import {
  nativeClearInterval,
  nativeClearTimeout,
  nativeQueueMicrotask,
  nativeSetInterval,
  nativeSetTimeout,
  RuntimeGlobals,
} from './runtimeGlobals';
import { RuntimeTaskScheduler } from './runtimeTaskScheduler';
import type {
  ProcessListener,
  ProcessObject,
  RuntimeConsole,
  RuntimeTimer,
  RuntimeTimerModule,
} from './runtimeTypes';
import { wrapRuntimeCode } from './runtimeWrapper';
import { createRuntimeWritable } from './runtimeWritable';
import type { RuntimeStdin } from './workerStdin';

const retiredPromises = new WeakSet<Promise<unknown>>();
const NativeFunction = Function;

export function isRetiredRuntimePromise(promise: Promise<unknown>): boolean {
  return retiredPromises.has(promise);
}

/**
 * Runtime execution options.
 */
export interface ExecutionOptions {
  rootPath: string;
  filePath: string;
  cwd?: string;
  env?: Record<string, string>;
  bridge: RuntimeBridge;
  filesystem: RuntimeFsMount;
  runShell: (
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      signal?: AbortSignal;
      stdin?: Readable;
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
    }
  ) => Promise<{ stdout: string; stderr: string; code: number | null }>;
  onExit?: (code: number) => void;
  onStdout?: (data: string | Uint8Array) => void;
  onStderr?: (data: string | Uint8Array) => void;
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  /** Stdin stream for interactive input */
  processStdin: RuntimeStdin;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  /** Terminal columns (width). If not provided, defaults to 80. */
  terminalColumns?: number;
  /** Terminal rows (height). If not provided, defaults to 24. */
  terminalRows?: number;
}

/**
 * Node.js Runtime Emulator
 */
export class NodeRuntime {
  private rootPath: string;
  private debugConsole: ExecutionOptions['debugConsole'];
  private processStdin: RuntimeStdin;
  private stdoutIsTTY: boolean;
  private stderrIsTTY: boolean;
  private builtInModules: BuiltInModules;
  private builtInResolver: RuntimeBuiltinResolver;
  private moduleLoader: ModuleLoader;
  private taskScheduler: RuntimeTaskScheduler;
  private bridge: RuntimeBridge;
  private filesystem: RuntimeFsMount;
  private runShell: ExecutionOptions['runShell'];
  private onExit: ExecutionOptions['onExit'];
  private onStdout: (data: string | Uint8Array) => void;
  private onStderr: (data: string | Uint8Array) => void;
  private cwd: string;
  private env: Record<string, string>;
  private terminalColumns: number;
  private terminalRows: number;
  private currentProcess: ProcessObject | null = null;
  private currentConsole: RuntimeConsole | null = null;
  private readonly globals = new RuntimeGlobals();
  private exitCode = 0;
  private didExit = false;
  private emittingExitListeners = false;
  private exitEventEmitted = false;
  private exitNotified = false;
  private disposed = false;
  private resolveProcessExit!: (code: number) => void;
  private readonly processExit = new Promise<number>(resolve => {
    this.resolveProcessExit = resolve;
  });

  // Event loop tracking.
  private activeTimers: Set<object> = new Set();
  private timerCancels = new Map<object, () => void>();
  private pendingIO: Set<Promise<unknown>> = new Set();
  private pendingMicrotasks = 0;
  private eventLoopResolve: (() => void) | null = null;
  private processListeners: Record<string, ProcessListener[]> = {};

  private isPromiseLike(value: unknown): value is Promise<unknown> {
    if (typeof value !== 'object' || value === null || !('then' in value)) return false;
    return typeof value.then === 'function';
  }

  private getExecutionPromise(moduleExports: unknown): Promise<unknown> | null {
    if (this.isPromiseLike(moduleExports)) {
      return moduleExports;
    }

    if (moduleExports && typeof moduleExports === 'object' && '__promise' in moduleExports) {
      const promise = moduleExports.__promise;
      if (this.isPromiseLike(promise)) return promise;
    }

    return null;
  }

  constructor(options: ExecutionOptions) {
    this.rootPath = options.rootPath;
    this.debugConsole = options.debugConsole;
    this.processStdin = options.processStdin;
    this.stdoutIsTTY = options.stdoutIsTTY === true;
    this.stderrIsTTY = options.stderrIsTTY === true;
    this.filesystem = options.filesystem;
    this.bridge = options.bridge;
    this.runShell = options.runShell;
    this.onExit = options.onExit;
    this.onStdout = options.onStdout ?? (data => this.debugConsole?.log(this.formatOutput(data)));
    this.onStderr = options.onStderr ?? (data => this.debugConsole?.error(this.formatOutput(data)));
    this.cwd = options.cwd ?? this.rootPath;
    this.env = options.env ?? {};
    this.terminalColumns = options.terminalColumns ?? 80;
    this.terminalRows = options.terminalRows ?? 24;
    this.currentConsole = this.createRuntimeConsole();

    this.builtInModules = createBuiltInModules({
      rootPath: this.rootPath,
      processStdin: this.processStdin,
      getTrackIO: () => this.trackIO.bind(this),
      requireFactory: (filename: string) => this.createRequire(filename),
      scheduleNextTick: callback => this.taskScheduler.scheduleNextTick(callback),
      getCwd: () => this.cwd,
      getEnv: () => ({ ...(this.currentProcess?.env ?? {}) }),
      writeStdout: this.onStdout,
      writeStderr: this.onStderr,
      runShell: this.runShell,
      filesystem: this.filesystem,
      bridge: this.bridge,
      terminalColumns: this.terminalColumns,
      terminalRows: this.terminalRows,
    });
    this.builtInResolver = new RuntimeBuiltinResolver({
      modules: this.builtInModules,
      getProcess: () => this.currentProcess ?? this.createProcessObject(),
      createConsole: () => this.currentConsole ?? this.createRuntimeConsole(),
      createTimerModule: () => this.createTimerModule(),
    });
    this.taskScheduler = new RuntimeTaskScheduler({
      activeTasks: this.activeTimers,
      cancelTasks: this.timerCancels,
      canRun: () => !this.disposed && (!this.didExit || this.emittingExitListeners),
      onMicrotaskChange: change => {
        this.pendingMicrotasks += change;
      },
      checkEventLoop: () => this.checkEventLoop(),
      finalizeProcessExit: code => this.finalizeProcessExit(code),
    });

    // Initialize the module loader.
    this.moduleLoader = new ModuleLoader({
      rootPath: this.rootPath,
      bridge: this.bridge,
      debugConsole: this.debugConsole,
      trackIO: promise => this.trackIO(promise),
      builtinResolver: this.builtInResolver.resolve.bind(this.builtInResolver),
    });

    runtimeInfo('🚀 NodeRuntime initialized', {
      rootPath: this.rootPath,
      cwd: this.cwd,
    });
  }
  /**
   * Execute a file.
   */
  async execute(
    filePath: string,
    argv: string[] = [],
    source?: string,
    execArgv: string[] = []
  ): Promise<void> {
    this.exitCode = 0;
    this.didExit = false;
    this.exitNotified = false;
    this.exitEventEmitted = false;
    this.processListeners = {};

    try {
      runtimeInfo('▶️ Executing file:', filePath);
      const invocationPath = filePath;
      if (source === undefined) filePath = await this.moduleLoader.realpath(filePath);

      // Install shared globals before entry and dependency evaluation.
      const importModule = (specifier: string) => this.moduleLoader.asyncLoad(specifier, filePath);
      this.createGlobals(
        invocationPath,
        argv,
        createRuntimeFunction(importModule),
        source !== undefined,
        execArgv
      );

      // Pre-load dependencies ONLY (do not execute the entry file yet)
      runtimeInfo('📦 Pre-loading dependencies...');
      const code = await this.moduleLoader.preloadDependencies(filePath, filePath, source);
      runtimeInfo('✅ All dependencies pre-loaded');

      let executionPromise = this.getExecutionPromise(undefined);
      if (this.moduleLoader.isEsmEntry(filePath)) {
        executionPromise = this.moduleLoader.executeEsmEntry(filePath);
      } else {
        // Build the execution sandbox with the shared globals.
        const requireFn = this.createRequire(filePath);
        const mainModule = this.moduleLoader.createMainModule(filePath);
        let filename = filePath;
        let dirname = getParentPath(filePath);
        if (source !== undefined) {
          filename = '[eval]';
          dirname = '.';
        }
        const sandbox = {
          require: requireFn,
          __pyxisImport: importModule,
          __pyxisRequireCommonJs: requireFn,
          __pyxisRequireImport: (specifier: string) =>
            this.moduleLoader.requireSync(specifier, filePath, 'import'),
          module: mainModule,
          exports: mainModule.exports,
          __filename: filename,
          __dirname: dirname,
        };

        // Wrap and execute the code synchronously.
        const wrappedCode = wrapRuntimeCode(code, source === undefined);
        const executeFunc = new NativeFunction(...Object.keys(sandbox), wrappedCode);

        runtimeInfo('✅ Code compiled successfully');
        executeFunc(...Object.values(sandbox));
        this.moduleLoader.completeMainModule(filePath);
        executionPromise = this.getExecutionPromise(mainModule.exports);
      }
      if (executionPromise) {
        await Promise.race([
          this.trackIO(executionPromise).then(() => undefined),
          this.processExit.then(() => undefined),
        ]);
      }
      if (this.didExit) return;
      runtimeInfo('✅ Execution completed');
    } catch (error) {
      if (isProcessExitSignal(error)) {
        this.finalizeProcessExit(error.code);
        runtimeInfo('✅ Process exited via process.exit()', { code: error.code });
        return;
      }
      if (this.handleUncaughtException(error)) return;

      // Format error in Node.js style
      const formattedError = formatNodeError(error, { filePath });
      runtimeError(formattedError);
      throw error;
    }
  }

  /**
   * Track interactive I/O such as readline until its promise settles.
   */
  trackIO<T>(p: Promise<T>): Promise<T> {
    if (this.disposed) {
      retiredPromises.add(p);
      void p.catch(() => {});
      return p;
    }
    const tracked = p.finally(() => {
      this.pendingIO.delete(tracked);
      this.checkEventLoop();
    });
    this.pendingIO.add(tracked);
    return tracked;
  }

  waitForProcessExit(): Promise<number> {
    return this.processExit;
  }

  /**
   * Wait until the event loop has no active timers or I/O.
   */
  async waitForEventLoop(): Promise<void> {
    while (!this.didExit) {
      if (this.hasActiveWork()) {
        runtimeInfo('⏳ Waiting for event loop to complete...', {
          activeTimers: this.activeTimers.size,
          pendingIO: this.pendingIO.size,
        });
        await new Promise<void>(resolve => {
          this.eventLoopResolve = resolve;
        });
        continue;
      }

      // Let the current task's microtask checkpoint queue rejection notifications before checking exit.
      await new Promise<void>(resolve => nativeSetTimeout(resolve, 0));
      await new Promise<void>((resolve, reject) => {
        nativeSetTimeout(() => {
          try {
            if (!this.didExit && !this.hasActiveWork()) {
              this.completeNaturalProcessExit();
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        }, 0);
      });
      if (this.didExit) return;
    }

    runtimeInfo('✅ Event loop wait skipped after process exit');
  }

  private checkEventLoop() {
    if (this.disposed) return;
    if (!this.hasActiveWork() && this.eventLoopResolve) {
      runtimeInfo('✅ Event loop is now empty');
      this.eventLoopResolve();
      this.eventLoopResolve = null;
    }
  }

  private hasActiveWork(): boolean {
    return this.activeTimers.size > 0 || this.pendingIO.size > 0 || this.pendingMicrotasks > 0;
  }

  private createTrackedTimer(
    kind: 'timeout' | 'interval',
    handler: (...args: unknown[]) => void,
    timeout?: number,
    args: unknown[] = []
  ): RuntimeTimer {
    if (this.disposed || this.didExit) {
      const timer: RuntimeTimer = {
        ref: () => timer,
        unref: () => timer,
        hasRef: () => false,
        [Symbol.toPrimitive]: () => 0,
      };
      return timer;
    }
    let nativeId: ReturnType<typeof setTimeout>;
    const timerRef: RuntimeTimer = {
      ref: () => {
        this.activeTimers.add(timerRef);
        return timerRef;
      },
      unref: () => {
        this.activeTimers.delete(timerRef);
        this.checkEventLoop();
        return timerRef;
      },
      hasRef: () => this.activeTimers.has(timerRef),
      [Symbol.toPrimitive]: () => Number(nativeId),
    };

    const invoke = () => {
      if (this.disposed || (this.didExit && !this.emittingExitListeners)) return;
      if (kind === 'timeout') {
        this.activeTimers.delete(timerRef);
        this.timerCancels.delete(timerRef);
      }

      try {
        handler(...args);
      } catch (error) {
        if (isProcessExitSignal(error)) {
          this.finalizeProcessExit(error.code);
          if (kind === 'interval') nativeClearInterval(nativeId);
          return;
        }
        throw error;
      } finally {
        this.checkEventLoop();
      }
    };

    if (kind === 'timeout') {
      nativeId = nativeSetTimeout(invoke, timeout);
      this.timerCancels.set(timerRef, () => nativeClearTimeout(nativeId));
    } else {
      nativeId = nativeSetInterval(invoke, timeout);
      this.timerCancels.set(timerRef, () => nativeClearInterval(nativeId));
    }
    this.activeTimers.add(timerRef);
    return timerRef;
  }

  private clearTrackedTimer(timer: unknown): void {
    if (typeof timer !== 'object' || timer === null) return;
    const cancel = this.timerCancels.get(timer);
    if (!cancel) return;
    cancel();
    this.timerCancels.delete(timer);
    this.activeTimers.delete(timer);
    this.checkEventLoop();
  }

  private createRuntimeConsole(): RuntimeConsole {
    return createRuntimeConsole(
      this.debugConsole,
      () => !this.disposed && (!this.didExit || this.emittingExitListeners),
      () => this.debugConsole?.clear()
    );
  }

  private formatOutput(data: string | Uint8Array): string {
    if (typeof data === 'string') return data;
    return new TextDecoder().decode(data);
  }

  private createTimerModule(): RuntimeTimerModule {
    return {
      setTimeout: (handler: ProcessListener, delay?: number, ...args: unknown[]) =>
        this.createTrackedTimer('timeout', handler, delay, args),
      clearTimeout: (timer?: unknown) => this.clearTrackedTimer(timer),
      setInterval: (handler: ProcessListener, delay?: number, ...args: unknown[]) =>
        this.createTrackedTimer('interval', handler, delay, args),
      clearInterval: (timer?: unknown) => this.clearTrackedTimer(timer),
      setImmediate: (handler: ProcessListener, ...args: unknown[]) =>
        this.taskScheduler.createImmediate(handler, args),
      clearImmediate: (timer?: unknown) => this.clearTrackedTimer(timer),
    };
  }

  getExitCode(): number {
    return this.exitCode;
  }

  private finalizeProcessExit(code: number): void {
    this.exitCode = normalizeProcessExitCode(code);
    this.didExit = true;
    this.resolveProcessExit(this.exitCode);
    for (const cancel of this.timerCancels.values()) cancel();
    this.timerCancels.clear();
    this.activeTimers.clear();
    if (this.eventLoopResolve) {
      this.eventLoopResolve();
      this.eventLoopResolve = null;
    }
    if (!this.exitNotified && this.onExit) {
      this.exitNotified = true;
      nativeQueueMicrotask(() => this.onExit?.(this.exitCode));
    }
  }

  private completeNaturalProcessExit(): void {
    const process = this.currentProcess;
    if (!process || this.didExit || this.hasActiveWork()) return;
    process.emit('beforeExit', process.exitCode ?? 0);
    if (this.didExit || this.hasActiveWork()) return;
    this.finalizeProcessExit(this.exitCode);
    this.emitExitEvent(process);
  }

  private emitExitEvent(process: ProcessObject): void {
    if (this.exitEventEmitted) return;
    this.exitEventEmitted = true;
    this.emittingExitListeners = true;
    try {
      process.emit('exit', process.exitCode ?? 0);
    } finally {
      this.emittingExitListeners = false;
    }
  }

  interrupt(): boolean {
    if (!this.currentProcess) return false;
    try {
      return this.currentProcess.emit('SIGINT');
    } catch (error) {
      if (!isProcessExitSignal(error)) throw error;
      this.finalizeProcessExit(error.code);
      return true;
    }
  }

  handleUncaughtException(error: unknown): boolean {
    return this.currentProcess?.emit('uncaughtException', error) ?? false;
  }

  handleUnhandledRejection(reason: unknown, promise: Promise<unknown>): boolean {
    return this.currentProcess?.emit('unhandledRejection', reason, promise) ?? false;
  }

  /**
   * Create the process object.
   * @param currentFilePath Entry path used in argv.
   * @param argv Command-line arguments.
   */
  private createProcessObject(
    currentFilePath?: string,
    argv: string[] = [],
    evalMode = false,
    execArgv: string[] = []
  ): ProcessObject {
    // EventEmitter-like listener store for process events (exit, uncaughtException, etc.)
    const listeners = this.processListeners;
    const startedAt = performance.now();
    const runtime = this;
    let guestExitCode: number | undefined;
    const hrtime = Object.assign(
      (time?: [number, number]): [number, number] => {
        const elapsedNs = BigInt(Math.floor((performance.now() - startedAt) * 1_000_000));
        if (!time) {
          return [Number(elapsedNs / 1_000_000_000n), Number(elapsedNs % 1_000_000_000n)];
        }
        const baseNs = BigInt(time[0]) * 1_000_000_000n + BigInt(time[1]);
        const diffNs = elapsedNs - baseNs;
        return [Number(diffNs / 1_000_000_000n), Number(diffNs % 1_000_000_000n)];
      },
      { bigint: () => BigInt(Math.floor((performance.now() - startedAt) * 1_000_000)) }
    );
    const createOutputStream = (fd: number, write: (data: Uint8Array) => void, isTTY: boolean) =>
      Object.assign(
        createRuntimeWritable(data => {
          if (this.disposed || (this.didExit && !this.emittingExitListeners)) return;
          write(data);
        }),
        {
          fd,
          isTTY,
          columns: this.terminalColumns,
          rows: this.terminalRows,
          getColorDepth: () => 24,
          hasColors: (count?: number) => count === undefined || count <= 16777216,
        }
      );

    let processArgv = ['node', currentFilePath || '/'];
    if (evalMode) processArgv = ['node'];
    processArgv = processArgv.concat(argv);

    const processObj: ProcessObject = {
      env: {
        HOME: HOME_DIR,
        LANG: 'en',
        // chalk, colors, etc. color libraries check these environment variables
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3', // Force color level 3 (truecolor)
        ...this.env,
      },
      argv: processArgv,
      execArgv,
      execPath: 'node',
      cwd: () => this.cwd,
      chdir: (directory: string) => {
        const nextCwd = resolvePath(this.cwd, directory);
        const stat = this.filesystem.statSync(nextCwd);
        if (stat === null) {
          const error = new Error(`ENOENT: no such file or directory, chdir '${nextCwd}'`);
          Object.assign(error, { code: 'ENOENT' });
          throw error;
        }
        if (stat.type !== 'directory') {
          const error = new Error(`ENOTDIR: not a directory, chdir '${nextCwd}'`);
          Object.assign(error, { code: 'ENOTDIR' });
          throw error;
        }
        this.cwd = this.filesystem.realpathSync(nextCwd);
      },
      emitWarning: (
        warning: string | Error,
        warningOptions?: { type?: string; code?: string; detail?: string }
      ) => {
        const error = typeof warning === 'string' ? new Error(warning) : warning;
        if (warningOptions?.type) error.name = warningOptions.type;
        if (warningOptions?.code) Object.assign(error, { code: warningOptions.code });
        processObj.emit('warning', error);
        let output = error.stack ?? `${error.name}: ${error.message}`;
        if (warningOptions?.detail) output = `${output}\n${warningOptions.detail}`;
        this.onStderr(`${output}\n`);
      },
      platform: 'browser',
      arch: this.builtInModules.os.arch(),
      version: 'v18.0.0',
      versions: {
        node: '18.0.0',
        v8: '10.0.0',
      },
      hrtime,
      get exitCode() {
        return guestExitCode;
      },
      set exitCode(value: number | string | undefined) {
        guestExitCode = validateProcessExitCode(value);
        runtime.exitCode = normalizeProcessExitCode(guestExitCode);
      },
      uptime: () => (performance.now() - startedAt) / 1000,
      exit: (code?: number | string) => {
        if (code !== undefined) processObj.exitCode = code;
        this.finalizeProcessExit(this.exitCode);
        this.emitExitEvent(processObj);
        throw createProcessExitSignal(this.exitCode);
      },
      nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
        this.taskScheduler.scheduleNextTick(() => {
          try {
            fn(...args);
          } catch (error) {
            if (isProcessExitSignal(error)) {
              this.finalizeProcessExit(error.code);
              return;
            }
            throw error;
          }
        });
      },
      // EventEmitter methods — many npm packages call process.on('exit', ...)
      on: (event: string, cb: ProcessListener) => {
        if (this.disposed || this.didExit) return processObj;
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        return processObj;
      },
      once: (event: string, cb: ProcessListener) => {
        const wrapped = (...args: unknown[]) => {
          processObj.removeListener(event, wrapped);
          cb(...args);
        };
        return processObj.on(event, wrapped);
      },
      off: (event: string, cb: ProcessListener) => {
        return processObj.removeListener(event, cb);
      },
      removeListener: (event: string, cb: ProcessListener) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(fn => fn !== cb);
        }
        return processObj;
      },
      addListener: (event: string, cb: ProcessListener) => {
        return processObj.on(event, cb);
      },
      emit: (event: string, ...args: unknown[]) => {
        if (this.disposed || (this.didExit && !this.emittingExitListeners)) return false;
        if (listeners[event]?.length) {
          for (const fn of [...listeners[event]]) {
            fn(...args);
          }
          return true;
        }
        return false;
      },
      listeners: (event: string) => {
        const eventListeners = listeners[event];
        if (!eventListeners) return [];
        return [...eventListeners];
      },
      removeAllListeners: (event?: string) => {
        if (event) {
          delete listeners[event];
        } else {
          for (const key of Object.keys(listeners)) delete listeners[key];
        }
        return processObj;
      },
      stdin: this.processStdin,
      stdout: createOutputStream(1, data => this.onStdout(data), this.stdoutIsTTY),
      stderr: createOutputStream(2, data => this.onStderr(data), this.stderrIsTTY),
    };

    return processObj;
  }

  /**
   * Create the runtime globals.
   */
  private createGlobals(
    currentFilePath: string,
    argv: string[],
    runtimeFunction: FunctionConstructor,
    evalMode = false,
    execArgv: string[] = []
  ) {
    const process = this.createProcessObject(currentFilePath, argv, evalMode, execArgv);
    this.currentProcess = process;
    const Buffer = this.builtInModules.buffer.Buffer;
    const runtimeConsole = this.currentConsole ?? this.createRuntimeConsole();
    this.currentConsole = runtimeConsole;
    const timers = this.createTimerModule();
    const runtimeGlobal = this.globals.global;
    const globals = {
      console: runtimeConsole,
      globalThis: runtimeGlobal,
      ...timers,
      queueMicrotask: (callback: VoidFunction) => this.taskScheduler.scheduleMicrotask(callback),
      Function: runtimeFunction,
      global: runtimeGlobal,
      process,
      Buffer,
    };
    this.globals.install(globals);
  }

  /**
   * Create the require function.
   */
  private createRequire(currentFilePath: string) {
    return this.moduleLoader.createRequire(currentFilePath);
  }

  /**
   * Clear the module cache.
   */
  clearCache(): void {
    this.moduleLoader.clearCache();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cancel of this.timerCancels.values()) cancel();
    this.timerCancels.clear();
    this.activeTimers.clear();
    for (const event of Object.keys(this.processListeners)) delete this.processListeners[event];
    for (const promise of this.pendingIO) {
      retiredPromises.add(promise);
      void promise.catch(() => {});
    }
    this.pendingIO.clear();
    this.eventLoopResolve?.();
    this.eventLoopResolve = null;
    this.moduleLoader.clearCache();
    this.currentProcess?.stdout.destroy();
    this.currentProcess?.stderr.destroy();
    this.globals.restore();
    this.currentProcess = null;
    this.currentConsole = null;
    this.onExit = undefined;
    this.onStdout = () => {};
    this.onStderr = () => {};
    this.debugConsole = undefined;
  }
}
