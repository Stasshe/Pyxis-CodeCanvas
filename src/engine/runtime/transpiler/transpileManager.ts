/** Serializes transforms through one lazy Worker and applies registered loaders. */

import { createWorkerPool, type WorkerPool } from '@/engine/workers/WorkerPool';
import type { TranspilerDescriptor } from '../core/RuntimeProvider';
import { runtimeInfo } from '../core/runtimeLogger';
import type { TranspileRequest, TranspileResult, TranspileWorkerApi } from './transpileWorker';

export interface TranspileOptions {
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isESModule?: boolean;
  isJSX?: boolean;
}

export class TranspileManager {
  private requestId = 0;
  private readonly pool: WorkerPool<TranspileWorkerApi>;
  private queue: Promise<void> = Promise.resolve();
  private transpilers: TranspilerDescriptor[] = [];

  constructor() {
    this.pool = createWorkerPool<TranspileWorkerApi>({
      createWorker: () =>
        new Worker(new URL('./transpileWorker.ts', import.meta.url), { type: 'module' }),
      maxWorkers: 1,
      idleTimeoutMs: 30000,
      timeoutMs: 10000,
    });
  }

  /** Transform source code using the registered loader for its extension. */
  async transpile(options: TranspileOptions): Promise<TranspileResult> {
    const descriptor = this.getTranspiler(options.filePath);
    const isTypeScriptPath = /\.(ts|tsx|mts|cts)$/.test(options.filePath);
    if ((options.isTypeScript || isTypeScriptPath) && !descriptor) {
      throw new Error(`No TypeScript transpiler is registered for ${options.filePath}.`);
    }
    const isTypeScript = descriptor?.workerTransform === 'typescript';
    const isJSX = options.isJSX || options.filePath.endsWith('.tsx');
    const id = `transpile_${++this.requestId}_${Date.now()}`;

    runtimeInfo('🔄 Transforming ESM to CJS (Web Worker):', options.filePath);

    const request: TranspileRequest = {
      id,
      code: options.code,
      filePath: options.filePath,
      options: {
        isTypeScript,
        isESModule: options.isESModule || false,
        isJSX,
      },
    };

    const result = this.queue.then(() => this.pool.call(worker => worker.transpile(request)));
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

  private getTranspiler(filePath: string): TranspilerDescriptor | undefined {
    for (const transpiler of this.transpilers) {
      if (transpiler.supportedExtensions.some(extension => filePath.endsWith(extension))) {
        return transpiler;
      }
    }
    return undefined;
  }
}

export const transpileManager = new TranspileManager();
