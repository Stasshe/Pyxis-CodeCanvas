/** Node.js runtime execution and process lifecycle. */

import { getParentPath, HOME_DIR } from '@/engine/core/pathUtils';
import type { RuntimeBridge } from '@/engine/runtime/bridge/client';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import { runtimeError, runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import { ModuleLoader } from '../module/moduleLoader';
import { type BuiltInModules, createBuiltInModules } from './builtInModule';
import { formatNodeError } from './nodeErrors';
import {
  createProcessExitSignal,
  isProcessExitSignal,
  normalizeProcessExitCode,
} from './processExit';
import {
  type ConsumerStream,
  collectStream,
  type ProcessListener,
  type ProcessObject,
  type RuntimeConsole,
  type RuntimeGlobal,
  type RuntimeTimer,
  type RuntimeTimerModule,
} from './runtimeTypes';
import type { RuntimeStdin } from './workerStdin';

/**
 * Runtime execution options.
 */
export interface ExecutionOptions {
  rootPath: string;
  filePath: string;
  cwd?: string;
  bridge: RuntimeBridge;
  filesystem: RuntimeFsMount;
  runShell: (
    command: string,
    options?: { cwd?: string; env?: Record<string, string> }
  ) => Promise<{ stdout: string; stderr: string; code: number | null }>;
  onExit?: (code: number) => void;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  /** Stdin stream for interactive input */
  processStdin: RuntimeStdin;
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
  private builtInModules: BuiltInModules;
  private moduleLoader: ModuleLoader;
  private bridge: RuntimeBridge;
  private filesystem: RuntimeFsMount;
  private runShell: ExecutionOptions['runShell'];
  private onExit: ExecutionOptions['onExit'];
  private onStdout: (data: string) => void;
  private onStderr: (data: string) => void;
  private cwd: string;
  private terminalColumns: number;
  private terminalRows: number;
  private currentProcess: ProcessObject | null = null;
  private exitCode = 0;
  private didExit = false;
  private exitNotified = false;

  // Event loop tracking.
  private activeTimers: Set<object> = new Set();
  private timerCancels = new Map<object, () => void>();
  private pendingIO: Set<Promise<unknown>> = new Set();
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
    this.filesystem = options.filesystem;
    this.bridge = options.bridge;
    this.runShell = options.runShell;
    this.onExit = options.onExit;
    this.onStdout = options.onStdout ?? (data => this.debugConsole?.log(data));
    this.onStderr = options.onStderr ?? (data => this.debugConsole?.error(data));
    this.cwd = options.cwd ?? this.rootPath;
    this.terminalColumns = options.terminalColumns ?? 80;
    this.terminalRows = options.terminalRows ?? 24;

    this.builtInModules = createBuiltInModules({
      rootPath: this.rootPath,
      processStdin: this.processStdin,
      getTrackIO: () => this.trackIO.bind(this),
      requireFactory: (filename: string) => this.createRequire(filename),
      getCwd: () => this.cwd,
      getEnv: () => ({ ...(this.currentProcess?.env ?? {}) }),
      runShell: this.runShell,
      filesystem: this.filesystem,
      bridge: this.bridge,
      terminalColumns: this.terminalColumns,
      terminalRows: this.terminalRows,
    });

    // Initialize the module loader.
    this.moduleLoader = new ModuleLoader({
      rootPath: this.rootPath,
      bridge: this.bridge,
      debugConsole: this.debugConsole,
      builtinResolver: this.resolveBuiltInModule.bind(this),
    });

    runtimeInfo('🚀 NodeRuntime initialized', {
      rootPath: this.rootPath,
      cwd: this.cwd,
    });
  }
  /**
   * Execute a file.
   */
  async execute(filePath: string, argv: string[] = []): Promise<void> {
    this.exitCode = 0;
    this.didExit = false;
    this.exitNotified = false;
    this.processListeners = {};

    try {
      runtimeInfo('▶️ Executing file:', filePath);

      // Initialize the module loader.
      await this.moduleLoader.init();

      // Prepare globals and inject them into the module loader for dependencies.
      const globals = this.createGlobals(filePath, argv);
      this.moduleLoader.setGlobals(globals);

      // Pre-load dependencies ONLY (do not execute the entry file yet)
      runtimeInfo('📦 Pre-loading dependencies...');
      await this.moduleLoader.preloadDependencies(filePath, filePath);
      runtimeInfo('✅ All dependencies pre-loaded');

      // Build the execution sandbox with the shared globals.
      const requireFn = this.createRequire(filePath);
      const sandbox = {
        ...globals,
        require: requireFn,
        __pyxisImport: (s: string) => this.moduleLoader.asyncLoad(s, filePath),
        module: { exports: {} },
        exports: {},
        __filename: filePath,
        __dirname: getParentPath(filePath),
      };

      // Keep exports linked to module.exports.
      sandbox.exports = sandbox.module.exports;

      // Read the entry file.
      const fileBytes = await this.filesystem.getFile(filePath);
      if (fileBytes === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        err.name = 'Error [ERR_FS_ENOENT]';
        throw err;
      }
      const fileContent = new TextDecoder().decode(fileBytes);

      // Dependencies are loaded; retrieve only the entry file's transpiled code.
      const { code } = await this.moduleLoader.getTranspiledCodeWithDeps(filePath, fileContent);

      // Wrap and execute the code synchronously.
      const wrappedCode = this.wrapCode(code, filePath);
      const executeFunc = new Function(...Object.keys(sandbox), wrappedCode);

      runtimeInfo('✅ Code compiled successfully');
      const executionResult = executeFunc(...Object.values(sandbox));
      const executionPromise = this.getExecutionPromise(executionResult);
      if (executionPromise) {
        await this.trackIO(executionPromise);
      }
      runtimeInfo('✅ Execution completed');
    } catch (error) {
      if (isProcessExitSignal(error)) {
        this.finalizeProcessExit(error.code);
        runtimeInfo('✅ Process exited via process.exit()', { code: error.code });
        return;
      }

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
    this.pendingIO.add(p);
    return p.finally(() => {
      this.pendingIO.delete(p);
      this.checkEventLoop();
    });
  }

  /**
   * Wait until the event loop has no active timers or I/O.
   */
  async waitForEventLoop(): Promise<void> {
    while (!this.didExit) {
      if (this.activeTimers.size > 0 || this.pendingIO.size > 0) {
        runtimeInfo('⏳ Waiting for event loop to complete...', {
          activeTimers: this.activeTimers.size,
          pendingIO: this.pendingIO.size,
        });
        await new Promise<void>(resolve => {
          this.eventLoopResolve = resolve;
        });
        continue;
      }

      await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
      if (this.activeTimers.size === 0 && this.pendingIO.size === 0) return;
    }

    runtimeInfo('✅ Event loop wait skipped after process exit');
  }

  private checkEventLoop() {
    if (this.activeTimers.size === 0 && this.pendingIO.size === 0 && this.eventLoopResolve) {
      runtimeInfo('✅ Event loop is now empty');
      this.eventLoopResolve();
      this.eventLoopResolve = null;
    }
  }

  private createTrackedTimer(
    kind: 'timeout' | 'interval',
    handler: (...args: unknown[]) => void,
    timeout?: number,
    args: unknown[] = []
  ): RuntimeTimer {
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
      if (kind === 'timeout') {
        this.activeTimers.delete(timerRef);
        this.timerCancels.delete(timerRef);
      }

      try {
        handler(...args);
      } catch (error) {
        if (isProcessExitSignal(error)) {
          this.finalizeProcessExit(error.code);
          if (kind === 'interval') clearInterval(nativeId);
          return;
        }
        throw error;
      } finally {
        this.checkEventLoop();
      }
    };

    if (kind === 'timeout') {
      nativeId = setTimeout(invoke, timeout);
      this.timerCancels.set(timerRef, () => clearTimeout(nativeId));
    } else {
      nativeId = setInterval(invoke, timeout);
      this.timerCancels.set(timerRef, () => clearInterval(nativeId));
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
    return {
      log: (...args: unknown[]) => {
        if (this.debugConsole?.log) this.debugConsole.log(...args);
        else runtimeInfo(...args);
      },
      error: (...args: unknown[]) => {
        if (this.debugConsole?.error) this.debugConsole.error(...args);
        else runtimeError(...args);
      },
      warn: (...args: unknown[]) => {
        if (this.debugConsole?.warn) this.debugConsole.warn(...args);
        else runtimeWarn(...args);
      },
      clear: () => this.debugConsole?.clear(),
    };
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
        this.createTrackedTimer('timeout', handler, 0, args),
      clearImmediate: (timer?: unknown) => this.clearTrackedTimer(timer),
    };
  }

  getExitCode(): number {
    return this.exitCode;
  }

  private finalizeProcessExit(code: number): void {
    this.exitCode = normalizeProcessExitCode(code);
    this.didExit = true;
    for (const cancel of this.timerCancels.values()) cancel();
    this.timerCancels.clear();
    this.activeTimers.clear();
    this.pendingIO.clear();

    if (this.eventLoopResolve) {
      this.eventLoopResolve();
      this.eventLoopResolve = null;
    }
    if (!this.exitNotified && this.onExit) {
      this.exitNotified = true;
      queueMicrotask(() => this.onExit?.(this.exitCode));
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

  /**
   * Wrap code for synchronous execution.
   */
  private wrapCode(code: string, filePath: string): string {
    // Comment out a shebang because eval and Function do not support it.
    if (code.startsWith('#!')) {
      code = `//${code}`; // Preserve line numbers.
    }

    return `
      return (() => {
        'use strict';
        const module = { exports: {} };
        const exports = module.exports;
        const __filename = ${JSON.stringify(filePath)};
        const __dirname = ${JSON.stringify(getParentPath(filePath))};
        
        ${code}
        
        return module.exports;
      })();
    `;
  }

  /**
   * Create the process object.
   * @param currentFilePath Entry path used in argv.
   * @param argv Command-line arguments.
   */
  private createProcessObject(currentFilePath?: string, argv: string[] = []): ProcessObject {
    // EventEmitter-like listener store for process events (exit, uncaughtException, etc.)
    const listeners = this.processListeners;
    const startedAt = performance.now();
    const runtime = this;
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

    const processObj: ProcessObject = {
      env: {
        HOME: HOME_DIR,
        LANG: 'en',
        // chalk, colors, etc. color libraries check these environment variables
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3', // Force color level 3 (truecolor)
      },
      argv: ['node', currentFilePath || '/'].concat(argv),
      cwd: () => this.cwd,
      platform: 'browser',
      version: 'v18.0.0',
      versions: {
        node: '18.0.0',
        v8: '10.0.0',
      },
      hrtime,
      get exitCode() {
        return runtime.exitCode;
      },
      set exitCode(value: number) {
        runtime.exitCode = normalizeProcessExitCode(value);
      },
      uptime: () => (performance.now() - startedAt) / 1000,
      exit: (code?: number) => {
        let resolvedCode = code;
        if (resolvedCode === undefined)
          resolvedCode = normalizeProcessExitCode(processObj.exitCode);
        this.finalizeProcessExit(normalizeProcessExitCode(resolvedCode));
        processObj.emit('exit', this.exitCode);
        throw createProcessExitSignal(this.exitCode);
      },
      nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
        this.createTrackedTimer(
          'timeout',
          () => {
            try {
              fn(...args);
            } catch (error) {
              if (isProcessExitSignal(error)) {
                this.finalizeProcessExit(error.code);
                return;
              }
              throw error;
            }
          },
          0
        ),
      // EventEmitter methods — many npm packages call process.on('exit', ...)
      on: (event: string, cb: ProcessListener) => {
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
      stdout: {
        write: (data: string | Uint8Array) => {
          this.onStdout(this.formatOutput(data));
          return true;
        },
        isTTY: true,
        columns: this.terminalColumns,
        rows: this.terminalRows,
        getColorDepth: () => 24,
        hasColors: (count?: number) => count === undefined || count <= 16777216,
      },
      stderr: {
        write: (data: string | Uint8Array) => {
          this.onStderr(this.formatOutput(data));
          return true;
        },
        isTTY: true,
        columns: this.terminalColumns,
        rows: this.terminalRows,
        getColorDepth: () => 24,
        hasColors: (count?: number) => count === undefined || count <= 16777216,
      },
    };

    return processObj;
  }

  /**
   * Create the runtime globals.
   */
  private createGlobals(currentFilePath: string, argv: string[] = []) {
    const process = this.createProcessObject(currentFilePath, argv);
    this.currentProcess = process;
    const Buffer = this.builtInModules.buffer.Buffer;
    const runtimeConsole = this.createRuntimeConsole();
    const timers = this.createTimerModule();
    const runtimeGlobal: RuntimeGlobal = {
      ...globalThis,
      ...timers,
      navigator: {
        ...(globalThis.navigator || {}),
        userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
        userAgentData: {
          brands: [{ brand: 'Chromium', version: '120' }],
        },
      },
      process,
      Buffer,
      console: runtimeConsole,
      global: undefined,
      globalThis: undefined,
    };
    runtimeGlobal.global = runtimeGlobal;
    runtimeGlobal.globalThis = runtimeGlobal;

    return {
      // JavaScript globals.
      console: runtimeConsole,
      globalThis: runtimeGlobal,
      ...timers,
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      JSON,
      Error,
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,

      // Node.js globals.
      // Create a custom global with spoofed navigator for color support detection
      // supports-color browser.js checks navigator.userAgent for Chromium
      // Without this, iOS Safari returns 0 (no color) because it doesn't match Chrome/Chromium
      global: runtimeGlobal,
      process,
      Buffer,
    };
  }

  /**
   * Create the require function.
   */
  private createRequire(currentFilePath: string) {
    return (moduleName: string): unknown => {
      const builtInModule = this.resolveBuiltInModule(moduleName);
      if (builtInModule !== null) return builtInModule;
      return this.moduleLoader.requireSync(moduleName, currentFilePath);
    };
  }

  /**
   * Resolve a built-in module, with or without the `node:` prefix.
   */
  private resolveBuiltInModule(moduleName: string): unknown | null {
    // Normalize the optional `node:` prefix.
    let normalizedName = moduleName;
    if (normalizedName.startsWith('node:')) normalizedName = normalizedName.slice(5);

    const builtIns: Record<string, unknown> = {
      fs: this.builtInModules.fs,
      'fs/promises': this.builtInModules.fs.promises,
      path: this.builtInModules.path,
      os: this.builtInModules.os,
      util: this.builtInModules.util,
      http: this.builtInModules.http,
      https: this.builtInModules.https,
      buffer: this.builtInModules.buffer,
      readline: this.builtInModules.readline,
      assert: this.builtInModules.assert,
      events: this.builtInModules.events,
      module: this.builtInModules.module,
      url: this.builtInModules.url,
      stream: this.builtInModules.stream,
      tty: this.builtInModules.tty,
      v8: this.builtInModules.v8,
      crypto: this.builtInModules.crypto,
      child_process: this.builtInModules.child_process,
      'stream/consumers': {
        text: async (stream: ConsumerStream) =>
          new TextDecoder().decode(await collectStream(stream)),
        json: async (stream: ConsumerStream): Promise<unknown> =>
          JSON.parse(new TextDecoder().decode(await collectStream(stream))),
        buffer: collectStream,
      },
      'timers/promises': {
        setTimeout: (delay?: number) =>
          new Promise<void>(resolve => this.createTrackedTimer('timeout', () => resolve(), delay)),
        setImmediate: () =>
          new Promise<void>(resolve => this.createTrackedTimer('timeout', () => resolve(), 0)),
      },
      perf_hooks: {
        performance: globalThis.performance,
      },
      // Share argv, cwd, and env with the running process.
      process: this.currentProcess ?? this.createProcessObject(),
      timers: this.createTimerModule(),
      console: this.createRuntimeConsole(),
    };

    return builtIns[normalizedName] ?? null;
  }

  /**
   * Clear the module cache.
   */
  clearCache(): void {
    this.moduleLoader.clearCache();
  }
}
