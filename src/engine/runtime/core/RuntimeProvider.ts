/** Language runtime providers registered by builtin runtimes and extensions. */
export interface RuntimeExecutionOptions {
  /** Absolute workspace folder and working directory. */
  rootPath: string;
  cwd?: string;
  filePath: string;
  argv?: string[];
  /** Abort forcibly cancels this execution. Terminal interrupts use subscribeInterrupt. */
  signal?: AbortSignal;
  subscribeInterrupt?: (handler: () => void) => () => void;
  onStdout?: (data: string | Uint8Array) => void;
  onStderr?: (data: string | Uint8Array) => void;
  debugConsole?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  processStdin?: import('@/engine/cmd/terminalProcessBridge').ProcessStdin;
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

export type TranspilerDescriptor = Pick<
  TranspilerProvider,
  'id' | 'supportedExtensions' | 'workerTransform'
>;
