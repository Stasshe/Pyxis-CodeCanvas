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

import { runtimeError, runtimeInfo } from '../core/runtimeLogger';
import type { TranspileRequest, TranspileResult } from './transpileWorker';

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

interface WorkerState {
  worker: Worker;
  inFlight: number;
}

/**
 * Transpile Manager
 */
export class TranspileManager {
  private requestId = 0;
  private workers: WorkerState[] = [];
  private readonly maxWorkers =
    typeof navigator === 'undefined'
      ? 1
      : Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: TranspileResult) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
      workerState: WorkerState;
    }
  >();

  /**
   * コードをトランスパイル
   *
   * Web Worker経由でesbuildによるESM→CJS変換を行う。
   * TypeScript/JSXのトランスパイルは拡張機能の責任。
   */
  async transpile(options: TranspileOptions): Promise<TranspileResult> {
    const id = `transpile_${++this.requestId}_${Date.now()}`;

    runtimeInfo('🔄 Transforming ESM to CJS (Web Worker):', options.filePath);

    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        timeout = setTimeout(() => {
          const pending = this.pendingRequests.get(id);
          if (pending) {
            pending.workerState.inFlight = Math.max(0, pending.workerState.inFlight - 1);
            this.pendingRequests.delete(id);
          }
          reject(new Error('Transpile timeout'));
        }, 10000); // 10秒

        // リクエストを送信
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
        const workerState = this.getWorkerState();
        workerState.inFlight++;
        this.pendingRequests.set(id, { resolve, reject, timeout, workerState });
        workerState.worker.postMessage(request);
      } catch (error) {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(id);
          pending.workerState.inFlight = Math.max(0, pending.workerState.inFlight - 1);
        } else if (timeout) {
          clearTimeout(timeout);
        }
        runtimeError('❌ Transpile failed:', options.filePath, error);
        reject(error);
      }
    });
  }

  private getWorkerState(): WorkerState {
    const leastBusy = this.workers.reduce<WorkerState | null>((best, current) => {
      if (!best || current.inFlight < best.inFlight) return current;
      return best;
    }, null);

    if (!leastBusy || (leastBusy.inFlight > 0 && this.workers.length < this.maxWorkers)) {
      return this.createWorkerState();
    }

    return leastBusy;
  }

  private createWorkerState(): WorkerState {
    const workerUrl = new URL('./transpileWorker.ts', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });
    const workerState: WorkerState = { worker, inFlight: 0 };

    worker.onmessage = (event: MessageEvent<TranspileResult | { type: string }>) => {
      const data = event.data;

      // 初期化メッセージやログメッセージは無視
      if ('type' in data && (data.type === 'ready' || data.type === 'log')) {
        return;
      }

      const result = data as TranspileResult;
      const pending = this.pendingRequests.get(result.id);
      if (!pending) return;

      this.pendingRequests.delete(result.id);
      pending.workerState.inFlight = Math.max(0, pending.workerState.inFlight - 1);
      clearTimeout(pending.timeout);

      if (result.error) {
        pending.reject(new Error(result.error));
      } else {
        pending.resolve(result);
      }
    };

    worker.onerror = error => {
      runtimeError('❌ Worker error:', error);
      this.rejectWorker(workerState, new Error(`Worker error: ${error.message}`));
      worker.terminate();
      this.workers = this.workers.filter(state => state !== workerState);
    };

    this.workers.push(workerState);
    return workerState;
  }

  private rejectWorker(workerState: WorkerState, error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.workerState !== workerState) continue;
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
    workerState.inFlight = 0;
  }
}

/**
 * シングルトンインスタンス
 */
export const transpileManager = new TranspileManager();
