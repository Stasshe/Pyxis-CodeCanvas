/**
 * [NEW ARCHITECTURE] Transpile Manager
 *
 * ## 役割
 * - normalizeCjsEsmによるCJS/ESM変換のみをサポート
 * - TypeScript/JSXのトランスパイルは拡張機能の責任
 * - Web Workerを使用してメインスレッドをブロックしない
 *
 * ## 設計方針
 * - TypeScriptはビルトインで保証されていないため、ここではサポートしない
 * - CJS/ESM変換のみを行う（transpileWorker経由でnormalizeCjsEsm使用）
 * - moduleLoaderから使用される
 */

import { runtimeInfo, runtimeError } from './runtimeLogger';
import type { TranspileResult, TranspileRequest } from './transpileWorker';

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

  /**
   * コードをトランスパイル
   *
   * Web Worker経由でnormalizeCjsEsmによるCJS/ESM変換を行う。
   * TypeScript/JSXのトランスパイルは拡張機能の責任。
   */
  async transpile(options: TranspileOptions): Promise<TranspileResult> {
    const id = `transpile_${++this.requestId}_${Date.now()}`;

    runtimeInfo('🔄 Normalizing CJS/ESM (Web Worker):', options.filePath);

    return new Promise((resolve, reject) => {
      try {
        // Workerを作成
        const workerUrl = new URL('./transpileWorker.ts', import.meta.url);
        const worker = new Worker(workerUrl, { type: 'module' });

        // タイムアウト設定
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Transpile timeout'));
        }, 10000); // 10秒

        // レスポンスハンドラー
        worker.onmessage = (event: MessageEvent<TranspileResult | { type: string }>) => {
          const data = event.data;

          // 初期化メッセージやログメッセージは無視
          if ('type' in data && data.type === 'ready') {
            return;
          }
          if ('type' in data && data.type === 'log') {
            return;
          }

          // 結果を処理
          clearTimeout(timeout);
          worker.terminate();

          if ('error' in data && data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data as TranspileResult);
          }
        };

        // エラーハンドラー
        worker.onerror = error => {
          clearTimeout(timeout);
          worker.terminate();
          runtimeError('❌ Worker error:', error);
          reject(new Error(`Worker error: ${error.message}`));
        };

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
        worker.postMessage(request);
      } catch (error) {
        runtimeError('❌ Transpile failed:', options.filePath, error);
        reject(error);
      }
    });
  }
}

/**
 * シングルトンインスタンス
 */
export const transpileManager = new TranspileManager();
