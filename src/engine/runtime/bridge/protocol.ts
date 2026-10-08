export interface TranspileBenchmark {
  initMs: number;
  transformMs: number;
}

export interface FsStat {
  type: 'file' | 'directory';
  size: number;
  mtime: number;
}

export interface FsBenchmark {
  queueMs: number;
  coreMs: number;
}

export type FsRequest = { benchmark?: boolean } & (
  | { kind: 'fs'; op: 'readFile' | 'readdir' | 'stat'; path: string }
  | { kind: 'fs'; op: 'writeFile'; path: string; data: number[] }
  | { kind: 'fs'; op: 'mkdir'; path: string; recursive: boolean }
  | { kind: 'fs'; op: 'rm'; path: string; recursive: boolean; force: boolean }
  | { kind: 'fs'; op: 'rename'; path: string; newPath: string }
);

export interface TranspileRequest {
  kind: 'transpile';
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isJSX?: boolean;
  benchmark?: boolean;
}

export type HostRequest =
  | { kind: 'shell'; command: string; cwd: string; env?: Record<string, string> }
  | { kind: 'stdin' };

export type RuntimeRequest = FsRequest | TranspileRequest | HostRequest;
export type RpcValue =
  | null
  | boolean
  | number
  | string
  | number[]
  | string[]
  | FsStat
  | { code: string; dependencies: ModuleDependency[]; benchmark?: TranspileBenchmark }
  | { stdout: string; stderr: string; exitCode: number };

export type RpcResult = (
  | { ok: true; value: RpcValue }
  | { ok: false; error: string; code?: string }
) & { fsBenchmark?: FsBenchmark };

export interface RpcCall {
  id: string;
  request: RuntimeRequest;
  runtimeId: string;
}

export interface RpcReply {
  id: string;
  result: RpcResult;
}

export function unwrapResult(result: RpcResult): RpcValue {
  if (result.ok) return result.value;
  const error = new Error(result.error);
  Object.assign(error, { code: result.code });
  throw error;
}

import type { ModuleDependency } from '../module/moduleCode';
