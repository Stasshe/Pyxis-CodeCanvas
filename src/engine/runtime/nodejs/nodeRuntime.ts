/**
 * Node.js Runtime Emulator
 *
 * ## 設計原則
 * 1. IndexedDB (fileRepository) を唯一の真実の源として使用
 * 2. ModuleLoaderによる高度なモジュール解決
 * 3. npm installされたパッケージはIndexedDBから読み取り
 * 4. ES Modulesとcommonjsの両方をサポート
 * 5. トランスパイルキャッシュによる高速化
 * 6. require()は非同期化（await __require__()に変換）
 */

import { runtimeError, runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import type { ProcessStdin } from '@/engine/cmd/terminalProcessBridge';
import { ModuleLoader } from '../module/moduleLoader';
import { createModuleNotFoundError, formatNodeError } from './nodeErrors';
import {
  createProcessExitSignal,
  isProcessExitSignal,
  normalizeProcessExitCode,
} from './processExit';

import { fileRepository } from '@/engine/core/fileRepository';
import { fsPathToAppPath, getParentPath, resolvePath, toAppPath } from '@/engine/core/pathUtils';
import { type BuiltInModules, createBuiltInModules } from './builtInModule';
import { runtimeStorageRegistry } from '@/engine/runtime/storage/RuntimeStorageRegistry';
import { RuntimeCacheMount } from '@/engine/runtime/storage/RuntimeCacheMount';

/**
 * 実行オプション
 */
export interface ExecutionOptions {
  projectId: string;
  projectName: string;
  filePath: string;
  cwd?: string;
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  /** Stdin stream for interactive input */
  processStdin?: ProcessStdin;
  /** Terminal columns (width). If not provided, defaults to 80. */
  terminalColumns?: number;
  /** Terminal rows (height). If not provided, defaults to 24. */
  terminalRows?: number;
}

/**
 * Node.js Runtime Emulator
 */
export class NodeRuntime {
  private projectId: string;
  private projectName: string;
  private debugConsole: ExecutionOptions['debugConsole'];
  private processStdin?: ProcessStdin;
  private builtInModules: BuiltInModules;
  private moduleLoader: ModuleLoader;
  private cacheMount: RuntimeCacheMount;
  private projectDir: string;
  private cwd: string;
  private terminalColumns: number;
  private terminalRows: number;
  private currentProcess: Record<string, any> | null = null;
  private exitCode = 0;
  private didExit = false;
  private syncExitBoundaryDepth = 0;

  // イベントループ追跡
  private activeTimers: Set<any> = new Set();
  private pendingIO: Set<Promise<any>> = new Set();
  private eventLoopResolve: (() => void) | null = null;

  private isPromiseLike(value: unknown): value is Promise<unknown> {
    return !!value && typeof (value as { then?: unknown }).then === 'function';
  }

  private getExecutionPromise(moduleExports: unknown): Promise<unknown> | null {
    if (this.isPromiseLike(moduleExports)) {
      return moduleExports;
    }

    if (
      moduleExports &&
      typeof moduleExports === 'object' &&
      this.isPromiseLike((moduleExports as { __promise?: unknown }).__promise)
    ) {
      return (moduleExports as { __promise: Promise<unknown> }).__promise;
    }

    return null;
  }

  constructor(options: ExecutionOptions) {
    this.projectId = options.projectId;
    this.projectName = options.projectName;
    this.debugConsole = options.debugConsole;
    this.processStdin = options.processStdin;
    this.projectDir = `/projects/${this.projectName}`;
    this.cwd = options.cwd ?? this.projectDir;
    this.terminalColumns = options.terminalColumns ?? 80;
    this.terminalRows = options.terminalRows ?? 24;

    const runtimeStorage = runtimeStorageRegistry.get(this.projectId, this.projectName);
    this.cacheMount = runtimeStorage.cacheMount;

    this.builtInModules = createBuiltInModules({
      projectDir: this.projectDir,
      projectId: this.projectId,
      projectName: this.projectName,
      processStdin: this.processStdin,
      getTrackIO: () => this.trackIO.bind(this),
      requireFactory: (filename: string) => this.createRequire(filename),
      getCwd: () => this.cwd,
      getEnv: () => ({ ...(this.currentProcess?.env ?? {}) }),
      runShell: (command, options) => this.runChildProcessShell(command, options),
      mountRouter: runtimeStorage.mountRouter,
      terminalColumns: this.terminalColumns,
      terminalRows: this.terminalRows,
    });

    // ModuleLoaderの初期化
    this.moduleLoader = new ModuleLoader({
      projectId: this.projectId,
      projectName: this.projectName,
      debugConsole: this.debugConsole,
      builtinResolver: this.resolveBuiltInModule.bind(this),
      cacheMount: this.cacheMount,
    });

    runtimeInfo('🚀 NodeRuntime initialized', {
      projectId: this.projectId,
      projectName: this.projectName,
      projectDir: this.projectDir,
      cwd: this.cwd,
    });
  }
  /**
   * ファイルを実行
   */
  /**
   * ファイルを実行
   */
  async execute(filePath: string, argv: string[] = []): Promise<void> {
    this.exitCode = 0;
    this.didExit = false;

    try {
      runtimeInfo('▶️ Executing file:', filePath);

      await this.cacheMount.init();

      // [NEW] Preload files for synchronous fs access (e.g. for yargs)
      // This is required because fs.readFileSync must be synchronous, but IndexedDB is async.
      if (this.builtInModules.fs.preloadFiles) {
        runtimeInfo('📂 Pre-loading files into memory cache...');
        // Preload ALL files to support fs.readFileSync for any file type (e.g. .cow, .yml, .js)
        // Since we can't do synchronous IO against IndexedDB on demand, we must cache everything.
        await this.builtInModules.fs.preloadFiles([]);
        runtimeInfo('✅ Files pre-loaded');
      }

      // ModuleLoaderを初期化
      await this.moduleLoader.init();

      // グローバルオブジェクトを準備（process, Buffer, timersなど）
      // これらをModuleLoaderに注入して、依存関係の実行時にも使えるようにする
      const globals = this.createGlobals(filePath, argv);
      this.moduleLoader.setGlobals(globals);

      // Pre-load dependencies ONLY (do not execute the entry file yet)
      runtimeInfo('📦 Pre-loading dependencies...');
      this.syncExitBoundaryDepth++;
      try {
        await this.moduleLoader.preloadDependencies(filePath, filePath);
        runtimeInfo('✅ All dependencies pre-loaded');

        // サンドボックス環境を構築（require関数を含む）
        // globalsを再利用する
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

        // module.exportsへの参照を維持
        (sandbox as any).exports = (sandbox as any).module.exports;

        // ファイルを読み込み
        const fileContent = await this.readFile(filePath);
        if (fileContent === null) {
          const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
          err.name = 'Error [ERR_FS_ENOENT]';
          throw err;
        }

        // トランスパイル済みコードを取得（依存関係は既にロード済みなので、コードのみ必要）
        const { code } = await this.moduleLoader.getTranspiledCodeWithDeps(filePath, fileContent);

        // コードをラップして同期実行
        const wrappedCode = this.wrapCode(code, filePath);
        const executeFunc = new Function(...Object.keys(sandbox), wrappedCode);

        runtimeInfo('✅ Code compiled successfully');
        const executionResult = executeFunc(...Object.values(sandbox));
        const executionPromise = this.getExecutionPromise(executionResult);
        if (executionPromise) {
          this.trackIO(executionPromise);
          await executionPromise;
        }
        runtimeInfo('✅ Execution completed');
      } finally {
        this.syncExitBoundaryDepth = Math.max(0, this.syncExitBoundaryDepth - 1);
      }
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
   * インタラクティブIO（readline等）の完了を追跡する
   * waitForEventLoop がこのPromiseが解決されるまで待機する
   */
  trackIO(p: Promise<any>): void {
    this.pendingIO.add(p);
    p.catch(() => undefined).finally(() => {
      this.pendingIO.delete(p);
      this.checkEventLoop();
    });
  }

  /**
   * イベントループが空になるまで待つ（本物のNode.jsと同じ挙動）
   */
  async waitForEventLoop(): Promise<void> {
    if (this.didExit) {
      runtimeInfo('✅ Event loop wait skipped after process exit');
      return;
    }

    // アクティブなタイマーとIOがなければすぐに完了
    if (this.activeTimers.size === 0 && this.pendingIO.size === 0) {
      runtimeInfo('✅ Event loop is already empty');
      return;
    }

    runtimeInfo('⏳ Waiting for event loop to complete...', {
      activeTimers: this.activeTimers.size,
      pendingIO: this.pendingIO.size,
    });

    // イベントループが空になるまで待機
    return new Promise<void>(resolve => {
      this.eventLoopResolve = resolve;
      // タイムアウト: 最大30秒待つ（無限ループ防止）
      setTimeout(() => {
        if (this.eventLoopResolve) {
          runtimeInfo('⚠️ Event loop timeout after 30s');
          this.eventLoopResolve();
          this.eventLoopResolve = null;
        }
      }, 30000);
    });
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
    handler: TimerHandler,
    timeout?: number,
    args: unknown[] = []
  ): any {
    let nativeId: any;
    const timerRef: any = {
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
      [Symbol.toPrimitive]: () => nativeId,
    };

    const invoke = () => {
      if (kind === 'timeout') {
        this.activeTimers.delete(timerRef);
      }

      try {
        if (typeof handler === 'function') {
          handler(...args);
        }
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

    nativeId = kind === 'timeout'
      ? setTimeout(invoke, timeout)
      : setInterval(invoke, timeout);
    this.activeTimers.add(timerRef);
    return timerRef;
  }

  getExitCode(): number {
    return this.exitCode;
  }

  private finalizeProcessExit(code: number): void {
    this.exitCode = normalizeProcessExitCode(code);
    this.didExit = true;
    this.activeTimers.clear();
    this.pendingIO.clear();

    if (this.eventLoopResolve) {
      this.eventLoopResolve();
      this.eventLoopResolve = null;
    }
  }

  /**
   * トランスパイルが必要か判定
   */
  private needsTranspile(filePath: string, content: string): boolean {
    if (/\.(ts|tsx|mts|cts)$/.test(filePath)) {
      return true;
    }

    if (/\.(jsx|tsx)$/.test(filePath)) {
      return true;
    }

    if (this.isESModule(content)) {
      return true;
    }

    // require()を含む場合も変換が必要（await __require__に変換）
    if (/require\s*\(/.test(content)) {
      return true;
    }

    return false;
  }

  /**
   * ES Moduleかどうかを判定
   */
  private isESModule(content: string): boolean {
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '');

    return /^\s*(import|export)\s+/m.test(cleaned);
  }

  /**
   * コードをラップ（同期実行）
   */
  private wrapCode(code: string, filePath: string): string {
    // Shebangを削除 (#!/usr/bin/env node など)
    // eval/new Function は Shebang をサポートしていないため
    if (code.startsWith('#!')) {
      code = `//${code}`; // コメントアウトして行数を維持
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
   * processオブジェクトを作成
   * @param currentFilePath 現在のファイルパス（argvに使用）
   * @param argv コマンドライン引数
   */
  private createProcessObject(currentFilePath?: string, argv: string[] = []): Record<string, any> {
    // EventEmitter-like listener store for process events (exit, uncaughtException, etc.)
    const listeners: Record<string, Function[]> = {};
    const startedAt = performance.now();
    const hrtime = (time?: [number, number]): [number, number] => {
      const elapsedNs = BigInt(Math.floor((performance.now() - startedAt) * 1_000_000));
      if (!time) {
        return [Number(elapsedNs / 1_000_000_000n), Number(elapsedNs % 1_000_000_000n)];
      }
      const baseNs = BigInt(time[0]) * 1_000_000_000n + BigInt(time[1]);
      const diffNs = elapsedNs - baseNs;
      return [Number(diffNs / 1_000_000_000n), Number(diffNs % 1_000_000_000n)];
    };
    hrtime.bigint = () => BigInt(Math.floor((performance.now() - startedAt) * 1_000_000));

    const processObj: Record<string, any> = {
      env: {
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
      uptime: () => (performance.now() - startedAt) / 1000,
      memoryUsage: () => ({
        rss: 0,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0,
      }),
      resourceUsage: () => ({}),
      exit: (code?: number) => {
        const resolvedCode =
          code === undefined ? normalizeProcessExitCode(processObj.exitCode) : code;
        this.finalizeProcessExit(normalizeProcessExitCode(resolvedCode));
        processObj.emit('exit', this.exitCode);
        if (this.syncExitBoundaryDepth > 0) {
          throw createProcessExitSignal(this.exitCode);
        }
      },
      nextTick: (fn: Function, ...args: unknown[]) =>
        setTimeout(() => {
          try {
            fn(...args);
          } catch (error) {
            if (isProcessExitSignal(error)) {
              this.finalizeProcessExit(error.code);
              return;
            }
            throw error;
          }
        }, 0),
      // EventEmitter methods — many npm packages call process.on('exit', ...)
      on: (event: string, cb: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        return processObj;
      },
      once: (event: string, cb: Function) => {
        const wrapped = (...args: unknown[]) => {
          processObj.removeListener(event, wrapped);
          cb(...args);
        };
        return processObj.on(event, wrapped);
      },
      off: (event: string, cb: Function) => {
        return processObj.removeListener(event, cb);
      },
      removeListener: (event: string, cb: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(fn => fn !== cb);
        }
        return processObj;
      },
      addListener: (event: string, cb: Function) => {
        return processObj.on(event, cb);
      },
      emit: (event: string, ...args: unknown[]) => {
        if (listeners[event]) {
          for (const fn of [...listeners[event]]) {
            fn(...args);
          }
          return true;
        }
        return false;
      },
      listeners: (event: string) => {
        return listeners[event] ? [...listeners[event]] : [];
      },
      removeAllListeners: (event?: string) => {
        if (event) {
          delete listeners[event];
        } else {
          for (const key of Object.keys(listeners)) delete listeners[key];
        }
        return processObj;
      },
      stdin: this.processStdin ?? {
        on: () => {},
        once: () => {},
        removeListener: () => {},
        setRawMode: () => {},
        pause: () => {},
        resume: () => {},
        isTTY: true,
      },
      stdout: (() => {
        // \r (carriage return) を正しく処理するラインバッファ
        // prettier等は \r で同一行を上書きするが、debugConsole.log は行単位なのでバッファが必要
        let lineBuf = '';
        const emitLine = (line: string) => {
          if (this.debugConsole?.log) this.debugConsole.log(line);
          else runtimeInfo(line);
        };
        return {
          write: (data: string) => {
            lineBuf += data;
            let cur = '';
            for (let i = 0; i < lineBuf.length; i++) {
              const ch = lineBuf[i];
              if (ch === '\r') {
                cur = '';  // キャリッジリターン: 現在行をクリア（上書き予定）
              } else if (ch === '\n') {
                emitLine(cur);
                cur = '';
              } else {
                cur += ch;
              }
            }
            lineBuf = cur;  // 未完了行をバッファに残す
            return true;
          },
          isTTY: true,
          columns: this.terminalColumns,
          rows: this.terminalRows,
          getColorDepth: () => 24,
          hasColors: (count?: number) => count === undefined || count <= 16777216,
        };
      })(),
      stderr: {
        write: (data: string) => {
          if (this.debugConsole?.error) {
            this.debugConsole.error(data);
          } else {
            runtimeError(data);
          }
          return true;
        },
        isTTY: true,
        columns: this.terminalColumns,
        rows: this.terminalRows,
        getColorDepth: () => 24,
        hasColors: (count?: number) => count === undefined || count <= 16777216,
      },
    };

    Object.defineProperty(processObj, 'exitCode', {
      configurable: true,
      enumerable: true,
      get: () => this.exitCode,
      set: (value: unknown) => {
        this.exitCode = normalizeProcessExitCode(value);
      },
    });

    return processObj;
  }

  /**
   * グローバルオブジェクトを作成
   */
  private createGlobals(currentFilePath: string, argv: string[] = []): Record<string, any> {
    const process = this.createProcessObject(currentFilePath, argv);
    this.currentProcess = process;

    return {
      // グローバルオブジェクト
      console: {
        log: (...args: unknown[]) => {
          if (this.debugConsole?.log) {
            this.debugConsole.log(...args);
          } else {
            runtimeInfo(...args);
          }
        },
        error: (...args: unknown[]) => {
          if (this.debugConsole?.error) {
            this.debugConsole.error(...args);
          } else {
            runtimeError(...args);
          }
        },
        warn: (...args: unknown[]) => {
          if (this.debugConsole?.warn) {
            this.debugConsole.warn(...args);
          } else {
            runtimeWarn(...args);
          }
        },
        clear: () => this.debugConsole?.clear(),
      },
      // ラップされたsetTimeout/setInterval（イベントループ追跡用）
      setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]): any =>
        this.createTrackedTimer('timeout', handler, timeout, args),
      setInterval: (handler: TimerHandler, timeout?: number, ...args: unknown[]): any =>
        this.createTrackedTimer('interval', handler, timeout, args),
      clearTimeout: (id?: any) => {
        if (id !== undefined) {
          clearTimeout(Number(id));
          this.activeTimers.delete(id);
          this.checkEventLoop();
        }
      },
      clearInterval: (id?: any) => {
        if (id !== undefined) {
          clearInterval(Number(id));
          this.activeTimers.delete(id);
          this.checkEventLoop();
        }
      },
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

      // Node.js グローバル
      // Create a custom global with spoofed navigator for color support detection
      // supports-color browser.js checks navigator.userAgent for Chromium
      // Without this, iOS Safari returns 0 (no color) because it doesn't match Chrome/Chromium
      global: {
        ...globalThis,
        navigator: {
          ...(globalThis.navigator || {}),
          userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
          userAgentData: {
            brands: [{ brand: 'Chromium', version: '120' }],
          },
        },
      },
      process,
      Buffer: this.builtInModules.Buffer,
    };
  }

  /**
   * require関数を作成
   */
  private createRequire(currentFilePath: string) {
    return (moduleName: string) => {
      runtimeInfo('📦 require:', moduleName);

      // First check built-in modules (always synchronous)
      const builtInModule = this.resolveBuiltInModule(moduleName);
      if (builtInModule !== null) {
        runtimeInfo('✅ Built-in module resolved:', moduleName);
        return builtInModule;
      }

      // For user modules, check the execution cache (must be pre-loaded)
      // We need to resolve the module path synchronously
      try {
        // Simple resolution for relative/absolute paths
        let resolvedPath: string | null = null;

        // Check moduleNameMap first (for npm packages)
        const mappedPath = this.moduleLoader.resolveModuleName(moduleName);
        if (mappedPath) {
          resolvedPath = mappedPath;
          runtimeInfo('📝 Resolved via moduleNameMap:', moduleName, '→', resolvedPath);
        }
        // Relative paths
        else if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
          const currentDir = getParentPath(currentFilePath);
          resolvedPath = resolvePath(currentDir, moduleName);
        }
        // Alias (@/)
        else if (moduleName.startsWith('@/')) {
          resolvedPath = moduleName.replace('@/', `${this.projectDir}/src/`);
        }
        // Absolute path
        else if (moduleName.startsWith('/')) {
          resolvedPath = moduleName;
        }
        // node_modules (fallback if not in map)
        else {
          // Try to find in node_modules (simplified - assumes main entry)
          let packageName = moduleName;
          if (moduleName.startsWith('@')) {
            const parts = moduleName.split('/');
            packageName = `${parts[0]}/${parts[1]}`;
          } else {
            packageName = moduleName.split('/')[0];
          }
          resolvedPath = `${this.projectDir}/node_modules/${packageName}`;
        }

        // Check execution cache using getExports
        if (resolvedPath) {
          const exports = this.moduleLoader.getExports(resolvedPath);
          if (exports) {
            runtimeInfo('✅ Module loaded from cache:', resolvedPath);
            return exports;
          }

          // Try with extensions if exact path failed
          const extensions = [
            '',
            '.js',
            '.cjs',
            '.mjs',
            '.ts',
            '.mts',
            '.tsx',
            '.jsx',
            '.json',
            '/index.js',
            '/index.cjs',
            '/index.ts',
          ];
          for (const ext of extensions) {
            const pathWithExt = resolvedPath + ext;
            const exportsExt = this.moduleLoader.getExports(pathWithExt);
            if (exportsExt) {
              runtimeInfo('✅ Module loaded from cache (with ext):', pathWithExt);
              return exportsExt;
            }
          }
        }

        // If not in cache - create Node.js style error
        runtimeError(`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '${moduleName}'`);
        if (resolvedPath) {
          runtimeError(`  Resolved path: ${resolvedPath}`);
        }
        runtimeError(`  Required from: ${currentFilePath}`);
        throw createModuleNotFoundError(moduleName, currentFilePath);
      } catch (error) {
        if (isProcessExitSignal(error)) {
          throw error;
        }
        if (error instanceof Error && error.name.includes('ERR_MODULE_NOT_FOUND')) {
          throw error;
        }
        runtimeError(formatNodeError(error, { moduleName }));
        throw error;
      }
    };
  }

  private async runChildProcessShell(
    command: string,
    options?: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const { ShellExecutor } = await import('@/engine/cmd/shell/executor');
    const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');

    const unix = terminalCommandRegistry.getUnixCommands(this.projectName, this.projectId);
    const savedCwd = await unix.pwd().catch(() => null);
    const targetCwd = options?.cwd;

    try {
      if (targetCwd) {
        await unix.cd([targetCwd]).catch(() => {});
      }

      const executor = new ShellExecutor({
        projectName: this.projectName,
        projectId: this.projectId,
        unix,
        fileRepository,
        commandRegistry: terminalCommandRegistry,
        terminalColumns: this.terminalColumns,
        terminalRows: this.terminalRows,
        env: options?.env,
        isInteractive: false,
      });

      return await executor.run(command);
    } finally {
      if (savedCwd) {
        await unix.cd([savedCwd]).catch(() => {});
      }
    }
  }

  /**
   * ビルトインモジュールを解決
   * `node:` プレフィックス付きのモジュール名もサポート
   */
  private resolveBuiltInModule(moduleName: string): unknown | null {
    // `node:` プレフィックスを削除して正規化
    const normalizedName = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;

    const builtIns: Record<string, unknown> = {
      fs: this.builtInModules.fs,
      'fs/promises': (this.builtInModules.fs as any).promises,
      path: this.builtInModules.path,
      os: this.builtInModules.os,
      util: this.builtInModules.util,
      http: this.builtInModules.http,
      https: this.builtInModules.https,
      buffer: { Buffer: this.builtInModules.Buffer },
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
        text: async (s: any): Promise<string> => {
          const chunks: Uint8Array[] = [];
          for await (const chunk of s) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
          const all = chunks.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array(0));
          return new TextDecoder().decode(all);
        },
        json: async (s: any): Promise<unknown> => {
          const chunks: Uint8Array[] = [];
          for await (const chunk of s) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
          const all = chunks.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array(0));
          return JSON.parse(new TextDecoder().decode(all));
        },
        buffer: async (s: any): Promise<Uint8Array> => {
          const chunks: Uint8Array[] = [];
          for await (const chunk of s) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
          return chunks.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array(0));
        },
      },
      'stream/promises': {
        pipeline: (..._args: unknown[]) => Promise.resolve(),
        finished: (_stream: unknown, _options?: unknown) => Promise.resolve(),
      },
      'stream/web': {},
      'timers/promises': {
        setTimeout: (delay?: number) => new Promise(resolve => globalThis.setTimeout(resolve, delay)),
        setImmediate: () => new Promise(resolve => globalThis.setTimeout(resolve, 0)),
        setInterval: async function* (_delay?: number) {},
      },
      perf_hooks: {
        performance: {
          now: () => performance.now(),
          mark: (_name: string) => {},
          measure: (_name: string, _start?: string, _end?: string) => ({ duration: 0, name: _name }),
          getEntriesByName: () => [],
          getEntriesByType: () => [],
          clearMarks: () => {},
          clearMeasures: () => {},
        },
        PerformanceObserver: class {
          constructor(_callback: any) {}
          observe(_options: any) {}
          disconnect() {}
        },
        constants: {},
      },
      worker_threads: {
        isMainThread: true,
        workerData: null,
        parentPort: null,
        threadId: 0,
        Worker: class { constructor() { throw new Error('Worker not supported'); } },
      },
      // process モジュール - 実行中の process.argv/cwd/env を共有する
      process: this.currentProcess ?? this.createProcessObject(),
      timers: {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        setImmediate: (fn: Function, ...args: unknown[]) => setTimeout(() => fn(...args), 0),
        clearImmediate: (id: any) => clearTimeout(id),
      },
      console: globalThis.console,
    };

    return builtIns[normalizedName] ?? null;
  }

  /**
   * ファイルを読み込み（非同期）
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      await fileRepository.init();
      const normalizedPath = fsPathToAppPath(filePath, this.projectName);

      const file = await fileRepository.getFileByPath(this.projectId, normalizedPath);
      if (!file) {
        this.log('⚠️ File not found in IndexedDB:', normalizedPath);
        return null;
      }

      if (file.isBufferArray && file.bufferContent) {
        this.warn('⚠️ Cannot execute binary file:', normalizedPath);
        return null;
      }

      return file.content;
    } catch (error) {
      this.error('❌ Failed to read file:', filePath, error);
      return null;
    }
  }

  /**
   * ログ出力
   */
  private log(...args: unknown[]): void {
    this.debugConsole?.log(...args);
  }

  /**
   * エラー出力
   */
  private error(...args: unknown[]): void {
    this.debugConsole?.error(...args);
  }

  /**
   * 警告出力
   */
  private warn(...args: unknown[]): void {
    this.debugConsole?.warn(...args);
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.moduleLoader.clearCache();
  }
}

/**
 * Node.jsファイルを実行
 */
export async function executeNodeFile(options: ExecutionOptions): Promise<void> {
  const runtime = new NodeRuntime(options);
  await runtime.execute(options.filePath);
}
