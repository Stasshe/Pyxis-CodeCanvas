/** Serializes transforms and their persistent cache in the filesystem worker. */

import { version as esbuildVersion } from 'esbuild-wasm/package.json';
import type { FsCore } from '@/engine/core/fs/core';
import { RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
import type { TranspilerDescriptor } from '@/engine/core/fs/types';
import { resolvePath } from '@/engine/core/paths';
import { createWorkerPool, type WorkerPool } from '@/engine/system/runtime/transpiler/WorkerPool';
import { runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import type { ModuleDependency } from '../module/moduleCode';
import type { TranspileRequest, TranspileResult, TranspileWorkerApi } from './transpileWorker';

export interface TranspileOptions {
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isJSX?: boolean;
  benchmark?: boolean;
}

type TranspileFilesystem = Pick<FsCore, 'readText' | 'mkdir' | 'writeFile'>;

async function hash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

interface CachedTransform {
  inputHash: string;
  code: string;
  dependencies: ModuleDependency[];
}

export class TranspileManager {
  private requestId = 0;
  private readonly pool: WorkerPool<TranspileWorkerApi>;
  private readonly cacheDirectory = resolvePath(RUNTIME_CACHE_PATH, 'modules');
  private queue: Promise<void> = Promise.resolve();
  private transpilers: TranspilerDescriptor[] = [];

  constructor(private readonly filesystem: TranspileFilesystem) {
    this.pool = createWorkerPool<TranspileWorkerApi>({
      createWorker: () =>
        new Worker(new URL('./transpileWorker.ts', import.meta.url), { type: 'module' }),
      maxWorkers: 1,
      idleTimeoutMs: 30000,
      timeoutMs: 10000,
    });
  }

  async transpile(options: TranspileOptions): Promise<TranspileResult> {
    const descriptor = this.getTranspiler(options.filePath);
    const isTypeScriptPath = ['.ts', '.tsx', '.mts', '.cts'].some(extension =>
      options.filePath.endsWith(extension)
    );
    if ((options.isTypeScript || isTypeScriptPath) && !descriptor) {
      throw new Error(`No TypeScript transpiler is registered for ${options.filePath}.`);
    }
    const request: TranspileRequest = {
      id: `transpile_${++this.requestId}`,
      code: options.code,
      benchmark: options.benchmark,
      filePath: options.filePath,
      options: {
        isTypeScript: descriptor?.workerTransform === 'typescript',
        isJSX: options.isJSX || options.filePath.endsWith('.tsx'),
      },
    };
    const result = this.queue.then(() => this.transform(request, descriptor));
    this.queue = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  configureTranspilers(transpilers: TranspilerDescriptor[]): void {
    this.transpilers = transpilers.map(transpiler => ({
      ...transpiler,
      supportedExtensions: [...transpiler.supportedExtensions],
    }));
  }

  private async transform(
    request: TranspileRequest,
    descriptor: TranspilerDescriptor | undefined
  ): Promise<TranspileResult> {
    const fs = this.filesystem;
    const name = await hash(request.filePath);
    const inputHash = await hash(
      JSON.stringify({
        code: request.code,
        filePath: request.filePath,
        options: request.options,
        descriptor,
        compiler: esbuildVersion,
        transformVersion: 5,
      })
    );
    const cachePath = `${this.cacheDirectory}/${name}.json`;
    const cached = await this.readCache(fs, cachePath);
    if (cached?.inputHash === inputHash) {
      return { id: request.id, code: cached.code, dependencies: cached.dependencies };
    }
    runtimeInfo('Transforming module:', request.filePath);
    const result = await this.pool.call(worker => worker.transpile(request));
    const entry: CachedTransform = {
      inputHash,
      code: result.code,
      dependencies: result.dependencies,
    };
    await fs.mkdir(this.cacheDirectory, { recursive: true }, false);
    await fs.writeFile(cachePath, JSON.stringify(entry), {}, false);
    return result;
  }

  private async readCache(fs: TranspileFilesystem, path: string): Promise<CachedTransform | null> {
    let content: string;
    try {
      content = await fs.readText(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch (error) {
      runtimeWarn('Discarding corrupt transpile cache:', path, error);
      return null;
    }
    if (!isCachedTransform(value)) {
      runtimeWarn('Discarding invalid transpile cache entry:', path);
      return null;
    }
    const entry = value;
    return entry;
  }

  private getTranspiler(filePath: string): TranspilerDescriptor | undefined {
    for (const transpiler of this.transpilers) {
      if (transpiler.supportedExtensions.some(extension => filePath.endsWith(extension))) {
        return transpiler;
      }
    }
    return undefined;
  }
}

function isCachedTransform(value: unknown): value is CachedTransform {
  if (typeof value !== 'object' || value === null) return false;
  if (!('inputHash' in value) || typeof value.inputHash !== 'string') return false;
  if (!('code' in value) || typeof value.code !== 'string') return false;
  if (!('dependencies' in value) || !Array.isArray(value.dependencies)) return false;
  return value.dependencies.every(
    (dependency: unknown) =>
      typeof dependency === 'object' &&
      dependency !== null &&
      'specifier' in dependency &&
      typeof dependency.specifier === 'string' &&
      'kind' in dependency &&
      (dependency.kind === 'require' || dependency.kind === 'import')
  );
}
