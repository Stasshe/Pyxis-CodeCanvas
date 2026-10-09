import type { BuiltInModules } from './builtInModule';
import type { RuntimeStdin } from './workerStdin';

export type ProcessListener = (...args: unknown[]) => void;
export type ConsumerStream = AsyncIterable<string | Uint8Array>;

export interface RuntimeImmediate {
  ref(): RuntimeImmediate;
  unref(): RuntimeImmediate;
  hasRef(): boolean;
}

export interface RuntimeTimer extends RuntimeImmediate {
  [Symbol.toPrimitive](): number;
}

export interface RuntimeTimerModule {
  setTimeout(handler: ProcessListener, delay?: number, ...args: unknown[]): RuntimeTimer;
  clearTimeout(timer?: unknown): void;
  setInterval(handler: ProcessListener, delay?: number, ...args: unknown[]): RuntimeTimer;
  clearInterval(timer?: unknown): void;
  setImmediate(handler: ProcessListener, ...args: unknown[]): RuntimeImmediate;
  clearImmediate(timer?: unknown): void;
}

export interface ProcessOutputStream {
  fd: number;
  write(data: string | Uint8Array, encoding?: BufferEncoding): boolean;
  destroy(): void;
  isTTY: boolean;
  columns: number;
  rows: number;
  getColorDepth(): number;
  hasColors(count?: number): boolean;
}

export interface ProcessObject {
  env: Record<string, string>;
  argv: string[];
  execArgv: string[];
  execPath: string;
  cwd(): string;
  chdir(directory: string): void;
  emitWarning(
    warning: string | Error,
    options?: { type?: string; code?: string; detail?: string }
  ): void;
  platform: string;
  arch: string;
  version: string;
  versions: Record<string, string>;
  hrtime: ((time?: [number, number]) => [number, number]) & { bigint(): bigint };
  uptime(): number;
  exitCode: number | string | undefined;
  exit(code?: number | string): void;
  nextTick(callback: ProcessListener, ...args: unknown[]): void;
  on(event: string, listener: ProcessListener): ProcessObject;
  once(event: string, listener: ProcessListener): ProcessObject;
  off(event: string, listener: ProcessListener): ProcessObject;
  removeListener(event: string, listener: ProcessListener): ProcessObject;
  addListener(event: string, listener: ProcessListener): ProcessObject;
  emit(event: string, ...args: unknown[]): boolean;
  listeners(event: string): ProcessListener[];
  removeAllListeners(event?: string): ProcessObject;
  stdin: RuntimeStdin;
  stdout: ProcessOutputStream;
  stderr: ProcessOutputStream;
}

export interface RuntimeConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  dir(...args: unknown[]): void;
  dirxml(...args: unknown[]): void;
  table(...args: unknown[]): void;
  trace(...args: unknown[]): void;
  assert(condition?: unknown, ...args: unknown[]): void;
  count(label?: string): void;
  countReset(label?: string): void;
  time(label?: string): void;
  timeLog(label?: string, ...args: unknown[]): void;
  timeEnd(label?: string): void;
  group(...args: unknown[]): void;
  groupCollapsed(...args: unknown[]): void;
  groupEnd(): void;
  clear(): void | undefined;
}

export interface RuntimeGlobal extends RuntimeTimerModule {
  navigator: Navigator;
  process: ProcessObject;
  Buffer: BuiltInModules['buffer']['Buffer'];
  console: RuntimeConsole;
  queueMicrotask(callback: VoidFunction): void;
  global: RuntimeGlobal | undefined;
  globalThis: RuntimeGlobal | undefined;
}

export async function collectStream(stream: ConsumerStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    let bytes: Uint8Array;
    if (typeof chunk === 'string') bytes = new TextEncoder().encode(chunk);
    else bytes = chunk;
    chunks.push(bytes);
    length += bytes.length;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
