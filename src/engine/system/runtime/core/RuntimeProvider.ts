/** Language runtime providers registered by builtin runtimes and extensions. */
export interface RuntimeExecutionOptions {
  /** Absolute workspace folder and working directory. */
  rootPath: string;
  cwd?: string;
  env?: Record<string, string>;
  filePath: string;
  source?: string;
  argv?: string[];
  execArgv?: string[];
  /** Emit runtime stage metrics for an explicitly measured execution. */
  benchmark?: boolean;
  /** Abort forcibly cancels this execution. Terminal interrupts use subscribeInterrupt. */
  signal?: AbortSignal;
  subscribeInterrupt?: (handler: () => void) => () => void;
  onStdout?: (data: string | Uint8Array) => void;
  onStderr?: (data: string | Uint8Array) => void;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  processStdin?: import('@/engine/system/terminal/terminalProcessBridge').ProcessStdin;
  terminalColumns?: number;
  terminalRows?: number;
}

export interface RuntimeExecutionResult {
  stdout?: string;
  stderr?: string;
  result?: unknown;
  exitCode?: number;
}

export interface RuntimeProvider {
  readonly id: string;
  readonly name: string;
  readonly supportedExtensions: string[];
  canExecute(filePath: string): boolean;
  initialize?(rootPath: string): Promise<void>;
  execute(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult>;
  clearCache?(): void;
  dispose?(): Promise<void>;
  isReady?(): boolean;
}

export interface TranspilerProvider {
  readonly id: string;
  readonly supportedExtensions: string[];
  readonly workerTransform: 'typescript';
}

export type { TranspilerDescriptor } from '@/engine/core/fs/types';
