/**
 * Transpile Manager
 *
 * ## 役割
 * - esbuildによるESM→CJS変換をサポート
 * - TypeScript/JSXのトランスパイルは拡張機能の責任
 * - Web Workerを使用してメインスレッドをブロックしない
 *
 * ## 設計方針
 * - TypeScriptはビルトインで保証されていないため、ここではサポートしない
 * - JSのESM→CJS変換のみを行う（transpileWorker経由でesbuild使用）
 * - moduleLoaderから使用される
 */

import { runtimeInfo } from '../core/runtimeLogger';
import type { TranspileRequest, TranspileResult, TranspileWorkerApi } from './transpileWorker';
import { createWorkerPool, type WorkerPool } from '@/engine/workers/WorkerPool';

/**
 * トランスパイルオプション
 */
export interface TranspileOptions {
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isESModule?: boolean;
  isJSX?: boolean;
}

/**
 * Transpile Manager
 */
export class TranspileManager {
  private requestId = 0;
  private readonly pool: WorkerPool<TranspileWorkerApi>;

  constructor() {
    this.pool = createWorkerPool<TranspileWorkerApi>({
      createWorker: () =>
        new Worker(new URL('./transpileWorker.ts', import.meta.url), { type: 'module' }),
      timeoutMs: 10000,
    });
  }

  /**
   * コードをトランスパイル
   *
   * Web Worker経由でesbuildによるESM→CJS変換を行う。
   * TypeScript/JSXのトランスパイルは拡張機能の責任。
   */
  async transpile(options: TranspileOptions): Promise<TranspileResult> {
    const id = `transpile_${++this.requestId}_${Date.now()}`;

    runtimeInfo('🔄 Transforming ESM to CJS (Web Worker):', options.filePath);

    const request: TranspileRequest = {
      id,
      code: options.code,
      filePath: options.filePath,
      options: {
        isTypeScript: options.isTypeScript || false,
        isESModule: options.isESModule || false,
        isJSX: options.isJSX || false,
      },
    };

    return this.pool.call(worker => worker.transpile(request));
  }
}

/**
 * シングルトンインスタンス
 */
export const transpileManager = new TranspileManager();
