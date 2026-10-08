/** Node.js runtime execution and process lifecycle. */

import { getParentPath, HOME_DIR } from '@/engine/core/pathUtils';
import type { RuntimeBridge } from '@/engine/runtime/bridge/client';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import { runtimeError, runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import { createRuntimeFunction } from '../module/dynamicFunction';
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

const retiredPromises = new WeakSet<Promise<unknown>>();

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
  bridge: RuntimeBridge;
  filesystem: RuntimeFsMount;
  runShell: (
    command: string,
    options?: { cwd?: string; env?: Record<string, string> }
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
  private onStdout: (data: string | Uint8Array) => void;
  private onStderr: (data: string | Uint8Array) => void;
  private cwd: string;
  private terminalColumns: number;
  private terminalRows: number;
  private currentProcess: ProcessObject | null = null;
  private exitCode = 0;
  private didExit = false;
  private emittingExitListeners = false;
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
    this.onStdout = options.onStdout ?? (data => this.debugConsole?.log(this.formatOutput(data)));
    this.onStderr = options.onStderr ?? (data => this.debugConsole?.error(this.formatOutput(data)));
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
      trackIO: promise => this.trackIO(promise),
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

      // Prepare globals and inject them into the module loader for dependencies.
      const globals = this.createGlobals(filePath, argv);
      this.moduleLoader.setGlobals(globals);

      // Pre-load dependencies ONLY (do not execute the entry file yet)
      runtimeInfo('📦 Pre-loading dependencies...');
      const code = await this.moduleLoader.preloadDependencies(filePath, filePath);
      runtimeInfo('✅ All dependencies pre-loaded');

      // Build the execution sandbox with the shared globals.
      const requireFn = this.createRequire(filePath);
      const importModule = (specifier: string) => this.moduleLoader.asyncLoad(specifier, filePath);
      const sandbox = {
        ...globals,
        require: requireFn,
        __pyxisImport: importModule,
        __pyxisRequireCommonJs: requireFn,
        __pyxisRequireImport: (specifier: string) =>
          this.moduleLoader.requireSync(specifier, filePath, 'import'),
        Function: createRuntimeFunction(importModule),
        module: { exports: {} },
        exports: {},
        __filename: filePath,
        __dirname: getParentPath(filePath),
      };

      // Keep exports linked to module.exports.
      sandbox.exports = sandbox.module.exports;

      // Wrap and execute the code synchronously.
      const wrappedCode = this.wrapCode(code);
      const executeFunc = new Function(...Object.keys(sandbox), wrappedCode);

      runtimeInfo('✅ Code compiled successfully');
      const executionResult = executeFunc(...Object.values(sandbox));
      const executionPromise = this.getExecutionPromise(executionResult);
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
    if (this.disposed) return;
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
        if (this.disposed || (this.didExit && !this.emittingExitListeners)) return;
        if (this.debugConsole?.log) this.debugConsole.log(...args);
        else runtimeInfo(...args);
      },
      error: (...args: unknown[]) => {
        if (this.disposed || (this.didExit && !this.emittingExitListeners)) return;
        if (this.debugConsole?.error) this.debugConsole.error(...args);
        else runtimeError(...args);
      },
      warn: (...args: unknown[]) => {
        if (this.disposed || (this.didExit && !this.emittingExitListeners)) return;
        if (this.debugConsole?.warn) this.debugConsole.warn(...args);
        else runtimeWarn(...args);
      },
      clear: () => {
        if (!this.disposed && (!this.didExit || this.emittingExitListeners))
          this.debugConsole?.clear();
      },
    };
  }

  private outputBytes(data: string | Uint8Array, encoding?: BufferEncoding): Uint8Array {
    const buffer = this.builtInModules.buffer.Buffer;
    if (typeof data === 'string') return buffer.from(data, encoding);
    return buffer.from(data);
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
  private wrapCode(code: string): string {
    // Comment out a shebang because eval and Function do not support it.
    if (code.startsWith('#!')) {
      code = `//${code}`; // Preserve line numbers.
    }

    return `
      return (function() {
        'use strict';
        
        ${code}
        
        return module.exports;
      }).call(module.exports);
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
        this.emittingExitListeners = true;
        try {
          processObj.emit('exit', this.exitCode);
        } finally {
          this.emittingExitListeners = false;
        }
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
      stdout: {
        write: (data: string | Uint8Array, encoding?: BufferEncoding) => {
          if (this.disposed || (this.didExit && !this.emittingExitListeners)) return false;
          this.onStdout(this.outputBytes(data, encoding));
          return true;
        },
        isTTY: true,
        columns: this.terminalColumns,
        rows: this.terminalRows,
        getColorDepth: () => 24,
        hasColors: (count?: number) => count === undefined || count <= 16777216,
      },
      stderr: {
        write: (data: string | Uint8Array, encoding?: BufferEncoding) => {
          if (this.disposed || (this.didExit && !this.emittingExitListeners)) return false;
          this.onStderr(this.outputBytes(data, encoding));
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
    this.currentProcess = null;
    this.onExit = undefined;
    this.onStdout = () => {};
    this.onStderr = () => {};
    this.debugConsole = undefined;
  }
}
