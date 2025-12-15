/**
 * [NEW ARCHITECTURE] Node.js Runtime Emulator
 *
 * ## 設計原則
 * 1. IndexedDB (fileRepository) を唯一の真実の源として使用
 * 2. ModuleLoaderによる高度なモジュール解決
 * 3. npm installされたパッケージはIndexedDBから読み取り
 * 4. ES Modulesとcommonjsの両方をサポート
 * 5. トランスパイルキャッシュによる高速化
 * 6. require()は非同期化（await __require__()に変換）
 */

import { ModuleLoader } from './moduleLoader'
import { runtimeInfo, runtimeWarn, runtimeError } from './runtimeLogger'

import { fileRepository } from '@/engine/core/fileRepository'
import { fsPathToAppPath, toAppPath } from '@/engine/core/pathResolver'
import { createBuiltInModules, type BuiltInModules } from '@/engine/node/builtInModule'

/**
 * 実行オプション
 */
export interface ExecutionOptions {
  projectId: string
  projectName: string
  filePath: string
  debugConsole?: {
    log: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    clear: () => void
  }
  onInput?: (prompt: string, callback: (input: string) => void) => void
  /** Terminal columns (width). If not provided, defaults to 80. */
  terminalColumns?: number
  /** Terminal rows (height). If not provided, defaults to 24. */
  terminalRows?: number
}

/**
 * Node.js Runtime Emulator
 */
export class NodeRuntime {
  private projectId: string
  private projectName: string
  private debugConsole: ExecutionOptions['debugConsole']
  private onInput?: ExecutionOptions['onInput']
  private builtInModules: BuiltInModules
  private moduleLoader: ModuleLoader
  private projectDir: string
  private terminalColumns: number
  private terminalRows: number

  // イベントループ追跡
  private activeTimers: Set<any> = new Set()
  private eventLoopResolve: (() => void) | null = null

  constructor(options: ExecutionOptions) {
    this.projectId = options.projectId
    this.projectName = options.projectName
    this.debugConsole = options.debugConsole
    this.onInput = options.onInput
    this.projectDir = `/projects/${this.projectName}`
    this.terminalColumns = options.terminalColumns ?? 80
    this.terminalRows = options.terminalRows ?? 24

    // ビルトインモジュールの初期化（onInputを渡す）
    this.builtInModules = createBuiltInModules({
      projectDir: this.projectDir,
      projectId: this.projectId,
      projectName: this.projectName,
      onInput: this.onInput,
    })

    // ModuleLoaderの初期化
    this.moduleLoader = new ModuleLoader({
      projectId: this.projectId,
      projectName: this.projectName,
      debugConsole: this.debugConsole,
      builtinResolver: this.resolveBuiltInModule.bind(this),
    })

    runtimeInfo('🚀 NodeRuntime initialized', {
      projectId: this.projectId,
      projectName: this.projectName,
      projectDir: this.projectDir,
    })
  }
  /**
   * ファイルを実行
   */
  /**
   * ファイルを実行
   */
  async execute(filePath: string, argv: string[] = []): Promise<void> {
    try {
      runtimeInfo('▶️ Executing file:', filePath)

      // [NEW] Preload files for synchronous fs access (e.g. for yargs)
      // This is required because fs.readFileSync must be synchronous, but IndexedDB is async.
      if (this.builtInModules.fs.preloadFiles) {
        runtimeInfo('📂 Pre-loading files into memory cache...')
        // Preload ALL files to support fs.readFileSync for any file type (e.g. .cow, .yml, .js)
        // Since we can't do synchronous IO against IndexedDB on demand, we must cache everything.
        await this.builtInModules.fs.preloadFiles([])
        runtimeInfo('✅ Files pre-loaded')
      }

      // ModuleLoaderを初期化
      await this.moduleLoader.init()

      // グローバルオブジェクトを準備（process, Buffer, timersなど）
      // これらをModuleLoaderに注入して、依存関係の実行時にも使えるようにする
      const globals = this.createGlobals(filePath, argv)
      this.moduleLoader.setGlobals(globals)

      // Pre-load dependencies ONLY (do not execute the entry file yet)
      runtimeInfo('📦 Pre-loading dependencies...')
      await this.moduleLoader.preloadDependencies(filePath, filePath)
      runtimeInfo('✅ All dependencies pre-loaded')

      // サンドボックス環境を構築（require関数を含む）
      // globalsを再利用する
      const sandbox = {
        ...globals,
        require: this.createRequire(filePath),
        module: { exports: {} },
        exports: {},
        __filename: filePath,
        __dirname: this.dirname(filePath),
      }

      // module.exportsへの参照を維持
      ;(sandbox as any).exports = (sandbox as any).module.exports

      // ファイルを読み込み
      const fileContent = await this.readFile(filePath)
      if (fileContent === null) {
        throw new Error(`File not found: ${filePath}`)
      }

      // トランスパイル済みコードを取得（依存関係は既にロード済みなので、コードのみ必要）
      const { code } = await this.moduleLoader.getTranspiledCodeWithDeps(filePath, fileContent)

      // コードをラップして同期実行
      const wrappedCode = this.wrapCode(code, filePath)
      const executeFunc = new Function(...Object.keys(sandbox), wrappedCode)

      runtimeInfo('✅ Code compiled successfully')
      executeFunc(...Object.values(sandbox)) // No await - synchronous execution
      runtimeInfo('✅ Execution completed')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : ''
      runtimeError('❌ Execution failed:', errorMessage)
      if (errorStack) {
        runtimeError('Stack trace:', errorStack)
      }
      throw error
    }
  }

  /**
   * イベントループが空になるまで待つ（本物のNode.jsと同じ挙動）
   */
  async waitForEventLoop(): Promise<void> {
    // アクティブなタイマーがなければすぐに完了
    if (this.activeTimers.size === 0) {
      runtimeInfo('✅ Event loop is already empty')
      return
    }

    runtimeInfo('⏳ Waiting for event loop to complete...', {
      activeTimers: this.activeTimers.size,
    })

    // イベントループが空になるまで待機
    return new Promise<void>(resolve => {
      this.eventLoopResolve = resolve
      // タイムアウト: 最大30秒待つ（無限ループ防止）
      setTimeout(() => {
        if (this.eventLoopResolve) {
          runtimeInfo('⚠️ Event loop timeout after 30s')
          this.eventLoopResolve()
          this.eventLoopResolve = null
        }
      }, 30000)
    })
  }

  private checkEventLoop() {
    if (this.activeTimers.size === 0 && this.eventLoopResolve) {
      runtimeInfo('✅ Event loop is now empty')
      this.eventLoopResolve()
      this.eventLoopResolve = null
    }
  }

  /**
   * トランスパイルが必要か判定
   */
  private needsTranspile(filePath: string, content: string): boolean {
    if (/\.(ts|tsx|mts|cts)$/.test(filePath)) {
      return true
    }

    if (/\.(jsx|tsx)$/.test(filePath)) {
      return true
    }

    if (this.isESModule(content)) {
      return true
    }

    // require()を含む場合も変換が必要（await __require__に変換）
    if (/require\s*\(/.test(content)) {
      return true
    }

    return false
  }

  /**
   * ES Moduleかどうかを判定
   */
  private isESModule(content: string): boolean {
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '')

    return /^\s*(import|export)\s+/m.test(cleaned)
  }

  /**
   * コードをラップ（同期実行）
   */
  private wrapCode(code: string, filePath: string): string {
    // Shebangを削除 (#!/usr/bin/env node など)
    // eval/new Function は Shebang をサポートしていないため
    if (code.startsWith('#!')) {
      code = '//' + code // コメントアウトして行数を維持
    }

    return `
      return (() => {
        'use strict';
        const module = { exports: {} };
        const exports = module.exports;
        const __filename = ${JSON.stringify(filePath)};
        const __dirname = ${JSON.stringify(this.dirname(filePath))};
        
        ${code}
        
        return module.exports;
      })();
    `
  }

  /**
   * グローバルオブジェクトを作成
   */
  private createGlobals(currentFilePath: string, argv: string[] = []): Record<string, any> {
    return {
      // グローバルオブジェクト
      console: {
        log: (...args: unknown[]) => {
          if (this.debugConsole && this.debugConsole.log) {
            this.debugConsole.log(...args)
          } else {
            runtimeInfo(...args)
          }
        },
        error: (...args: unknown[]) => {
          if (this.debugConsole && this.debugConsole.error) {
            this.debugConsole.error(...args)
          } else {
            runtimeError(...args)
          }
        },
        warn: (...args: unknown[]) => {
          if (this.debugConsole && this.debugConsole.warn) {
            this.debugConsole.warn(...args)
          } else {
            runtimeWarn(...args)
          }
        },
        clear: () => this.debugConsole?.clear(),
      },
      // ラップされたsetTimeout/setInterval（イベントループ追跡用）
      setTimeout: (handler: TimerHandler, timeout?: number, ...args: any[]): number => {
        const timerId = setTimeout(() => {
          this.activeTimers.delete(timerId)
          if (typeof handler === 'function') {
            handler(...args)
          }
          this.checkEventLoop()
        }, timeout) as any
        this.activeTimers.add(timerId)
        return timerId as number
      },
      setInterval: (handler: TimerHandler, timeout?: number, ...args: any[]): number => {
        const intervalId = setInterval(() => {
          if (typeof handler === 'function') {
            handler(...args)
          }
        }, timeout) as any
        this.activeTimers.add(intervalId)
        return intervalId as number
      },
      clearTimeout: (id?: number) => {
        if (id !== undefined) {
          clearTimeout(id)
          this.activeTimers.delete(id)
          this.checkEventLoop()
        }
      },
      clearInterval: (id?: number) => {
        if (id !== undefined) {
          clearInterval(id)
          this.activeTimers.delete(id)
          this.checkEventLoop()
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
      process: {
        env: {
          LANG: 'en',
          // chalk, colors, etc. color libraries check these environment variables
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          FORCE_COLOR: '3', // Force color level 3 (truecolor)
        },
        argv: ['node', currentFilePath].concat(argv || []),
        cwd: () => this.projectDir,
        platform: 'browser',
        version: 'v18.0.0',
        versions: {
          node: '18.0.0',
          v8: '10.0.0',
        },
        stdin: {
          on: () => {},
          once: () => {},
          removeListener: () => {},
          setRawMode: () => {},
          pause: () => {},
          resume: () => {},
          isTTY: true,
        },
        stdout: {
          write: (data: string) => {
            if (this.debugConsole && this.debugConsole.log) {
              this.debugConsole.log(data)
            } else {
              runtimeInfo(data)
            }
            return true
          },
          isTTY: true,
          columns: this.terminalColumns,
          rows: this.terminalRows,
          getColorDepth: () => 24, // 24-bit color (truecolor)
          hasColors: (count?: number) => count === undefined || count <= 16777216,
        },
        stderr: {
          write: (data: string) => {
            if (this.debugConsole && this.debugConsole.error) {
              this.debugConsole.error(data)
            } else {
              runtimeError(data)
            }
            return true
          },
          isTTY: true,
          columns: this.terminalColumns,
          rows: this.terminalRows,
          getColorDepth: () => 24,
          hasColors: (count?: number) => count === undefined || count <= 16777216,
        },
      },
      Buffer: this.builtInModules.Buffer,
    }
  }

  /**
   * require関数を作成
   */
  private createRequire(currentFilePath: string) {
    return (moduleName: string) => {
      runtimeInfo('📦 require:', moduleName)

      // First check built-in modules (always synchronous)
      const builtInModule = this.resolveBuiltInModule(moduleName)
      if (builtInModule !== null) {
        runtimeInfo('✅ Built-in module resolved:', moduleName)
        return builtInModule
      }

      // For user modules, check the execution cache (must be pre-loaded)
      // We need to resolve the module path synchronously
      try {
        // Simple resolution for relative/absolute paths
        let resolvedPath: string | null = null

        // Check moduleNameMap first (for npm packages)
        const mappedPath = this.moduleLoader.resolveModuleName(moduleName)
        if (mappedPath) {
          resolvedPath = mappedPath
          runtimeInfo('📝 Resolved via moduleNameMap:', moduleName, '→', resolvedPath)
        }
        // Relative paths
        else if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
          const currentDir = this.dirname(currentFilePath)
          resolvedPath = this.resolvePath(currentDir, moduleName)
        }
        // Alias (@/)
        else if (moduleName.startsWith('@/')) {
          resolvedPath = moduleName.replace('@/', `${this.projectDir}/src/`)
        }
        // Absolute path
        else if (moduleName.startsWith('/')) {
          resolvedPath = moduleName
        }
        // node_modules (fallback if not in map)
        else {
          // Try to find in node_modules (simplified - assumes main entry)
          let packageName = moduleName
          if (moduleName.startsWith('@')) {
            const parts = moduleName.split('/')
            packageName = `${parts[0]}/${parts[1]}`
          } else {
            packageName = moduleName.split('/')[0]
          }
          resolvedPath = `${this.projectDir}/node_modules/${packageName}`
        }

        // Check execution cache using getExports
        if (resolvedPath) {
          const exports = this.moduleLoader.getExports(resolvedPath)
          if (exports) {
            runtimeInfo('✅ Module loaded from cache:', resolvedPath)
            return exports
          }

          // Try with extensions if exact path failed
          const extensions = [
            '',
            '.js',
            '.mjs',
            '.ts',
            '.mts',
            '.tsx',
            '.jsx',
            '/index.js',
            '/index.ts',
          ]
          for (const ext of extensions) {
            const pathWithExt = resolvedPath + ext
            const exportsExt = this.moduleLoader.getExports(pathWithExt)
            if (exportsExt) {
              runtimeInfo('✅ Module loaded from cache (with ext):', pathWithExt)
              return exportsExt
            }
          }
        }

        // If not in cache, try to load synchronously (this will work for built-ins)
        runtimeError('❌ Module not pre-loaded:', moduleName, '(resolved:', resolvedPath + ')')
        throw new Error(
          `Module '${moduleName}' not found. Modules must be pre-loaded or be built-in modules.`
        )
      } catch (error) {
        runtimeError('❌ Failed to require module:', moduleName, error)
        throw error
      }
    }
  }

  /**
   * ビルトインモジュールを解決
   */
  private resolveBuiltInModule(moduleName: string): unknown | null {
    const builtIns: Record<string, unknown> = {
      fs: this.builtInModules.fs,
      'fs/promises': this.builtInModules.fs,
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
    }

    return builtIns[moduleName] || null
  }

  /**
   * ファイルを読み込み（非同期）
   */
  private async readFile(filePath: string): Promise<string | null> {
    try {
      await fileRepository.init()
      const normalizedPath = this.normalizePath(filePath)

      const file = await fileRepository.getFileByPath(this.projectId, normalizedPath)
      if (!file) {
        this.log('⚠️ File not found in IndexedDB:', normalizedPath)
        return null
      }

      if (file.isBufferArray && file.bufferContent) {
        this.warn('⚠️ Cannot execute binary file:', normalizedPath)
        return null
      }

      return file.content
    } catch (error) {
      this.error('❌ Failed to read file:', filePath, error)
      return null
    }
  }

  /**
   * パスを正規化
   * pathResolverを使用
   */
  private normalizePath(filePath: string): string {
    // プロジェクトディレクトリで始まる場合はFSPath→AppPath変換
    if (filePath.startsWith(this.projectDir)) {
      return fsPathToAppPath(filePath, this.projectName)
    }
    // それ以外はAppPath形式に正規化
    return toAppPath(filePath)
  }

  /**
   * パスを解決（相対パスを絶対パスに変換）
   */
  private resolvePath(basePath: string, relativePath: string): string {
    const parts = basePath.split('/').filter(Boolean)
    const relParts = relativePath.split('/').filter(Boolean)

    for (const part of relParts) {
      if (part === '..') {
        parts.pop()
      } else if (part !== '.') {
        parts.push(part)
      }
    }

    return '/' + parts.join('/')
  }

  /**
   * ディレクトリパスを取得
   */
  private dirname(filePath: string): string {
    const parts = filePath.split('/')
    parts.pop()
    return parts.join('/') || '/'
  }

  /**
   * ログ出力
   */
  private log(...args: unknown[]): void {
    this.debugConsole?.log(...args)
  }

  /**
   * エラー出力
   */
  private error(...args: unknown[]): void {
    this.debugConsole?.error(...args)
  }

  /**
   * 警告出力
   */
  private warn(...args: unknown[]): void {
    this.debugConsole?.warn(...args)
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.moduleLoader.clearCache()
  }
}

/**
 * Node.jsファイルを実行
 */
export async function executeNodeFile(options: ExecutionOptions): Promise<void> {
  const runtime = new NodeRuntime(options)
  await runtime.execute(options.filePath)
}
