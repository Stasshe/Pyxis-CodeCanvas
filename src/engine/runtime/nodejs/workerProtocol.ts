import type { RuntimeExecutionResult } from '../core/RuntimeProvider';
import type { RuntimeLogLevel } from '../core/runtimeLogger';

export interface WorkerExecutionOptions {
  rootPath: string;
  filePath: string;
  cwd?: string;
  argv: string[];
  terminalColumns?: number;
  terminalRows?: number;
}

export type OutputChannel = 'stdout' | 'stderr' | 'log' | 'warn' | 'error' | 'clear' | 'debug';
export type OutputEntry =
  | { channel: 'debug'; text: string; level: RuntimeLogLevel }
  | { channel: 'stdout'; text: string | Uint8Array }
  | { channel: 'stderr'; text: string | Uint8Array }
  | { channel: Exclude<OutputChannel, 'debug' | 'stdout' | 'stderr'>; text: string };

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type MainMessage =
  | {
      type: 'start';
      benchmarkStartedAt?: number;
      benchmarkPreparedWorker?: boolean;
      benchmarkAcquisitionMs?: number;
      runtimeId: string;
      scope: string;
      options: WorkerExecutionOptions;
      fsPort: MessagePort;
    }
  | { type: 'stdin'; data: Uint8Array }
  | { type: 'stdin-end' }
  | { type: 'interrupt' }
  | { type: 'shell-result'; id: number; result: ShellResult }
  | { type: 'shell-error'; id: number; error: string };

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'fatal'; error: string }
  | { type: 'stdin-request' }
  | { type: 'stdin-pause' }
  | { type: 'output'; entries: OutputEntry[] }
  | { type: 'complete'; result: RuntimeExecutionResult }
  | { type: 'interrupt-result'; handled: boolean }
  | { type: 'shell'; id: number; command: string; cwd?: string; env?: Record<string, string> };
