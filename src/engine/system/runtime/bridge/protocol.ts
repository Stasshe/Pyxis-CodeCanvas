export interface TranspileBenchmark {
  initMs: number;
  transformMs: number;
}

export interface FsStat {
  type: 'file' | 'directory' | 'symlink' | 'fifo' | 'characterDevice';
  size: number;
  mtime: number;
  mode: number;
}

export type { FsBenchmark } from '@/engine/core/fs/protocol';

import type { FsBenchmark } from '@/engine/core/fs/protocol';

export type FsRequest = { benchmark?: boolean } & (
  | {
      kind: 'fs';
      op: 'readFile' | 'readdir' | 'stat' | 'lstat' | 'readlink' | 'realpath';
      path: string;
    }
  | { kind: 'fs'; op: 'symlink'; target: string; path: string }
  | { kind: 'fs'; op: 'writeFile'; path: string; data: string; mode?: number }
  | {
      kind: 'fs';
      op: 'writeRange';
      path: string;
      data: string;
      position: number | null;
      create: boolean;
      exclusive: boolean;
      mode?: number;
    }
  | {
      kind: 'fs';
      op: 'fifoOpen';
      path: string;
      endpointId: string;
      mode: 'read' | 'write' | 'readwrite';
      nonblocking: boolean;
    }
  | { kind: 'fs'; op: 'fifoRead'; endpointId: string; maxBytes: number }
  | { kind: 'fs'; op: 'fifoWrite'; endpointId: string; data: string }
  | { kind: 'fs'; op: 'fifoClose'; endpointId: string }
  | { kind: 'fs'; op: 'mkdir'; path: string; recursive: boolean; mode?: number }
  | { kind: 'fs'; op: 'chmod'; path: string; mode: number }
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
  | Uint8Array
  | string[]
  | FsStat
  | { code: string; dependencies: ModuleDependency[]; benchmark?: TranspileBenchmark }
  | {
      stdout: string | Uint8Array | number[];
      stderr: string | Uint8Array | number[];
      exitCode: number;
    };

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
