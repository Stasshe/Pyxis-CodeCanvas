/**
 * [NEW ARCHITECTURE] Transpile Manager
 *
 * ## 役割
 * - Web Workerの管理
 * - トランスパイルリクエストのキューイング
 * - 結果の返却
 * - Workerプールの管理（将来実装）
 *
 * ## 設計方針
 * - 各トランスパイルは独立したWorkerで実行
 * - 完了後、即座にWorkerを終了してメモリ解放
 * - メインスレッドをブロックしない
 */

import type { TranspileRequest, TranspileResult } from './transpileWorker';
import { runtimeInfo, runtimeWarn, runtimeError } from './runtimeLogger';

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
   */
  async transpile(options: TranspileOptions): Promise<TranspileResult> {
    return new Promise((resolve, reject) => {
      const id = `transpile_${++this.requestId}_${Date.now()}`;

      // Workerを作成
      const worker = new Worker(
        new URL('./transpileWorker.ts', import.meta.url),
        { type: 'module' }
      );

      // タイムアウト設定（30秒）
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Transpile timeout: ${options.filePath}`));
      }, 30000);

      // メッセージハンドラ
      worker.onmessage = (event: MessageEvent<TranspileResult | { type: string }>) => {
        const data = event.data as any;

        // Worker からのログメッセージを中継
        if (data && data.type === 'log') {
          const level = data.level || 'info';
          const msg = data.message || '';
          if (level === 'error') runtimeError(msg);
          else if (level === 'warn') runtimeWarn(msg);
          else runtimeInfo(msg);
          return;
        }

        // 初期化メッセージは無視
        if (data && data.type === 'ready') {
          return;
        }

        clearTimeout(timeout);
        
        const result = data as TranspileResult;
        
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result);
        }

        // Workerは自動的に終了するが、念のため
        worker.terminate();
      };

      // エラーハンドラ
      worker.onerror = (error) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(`Worker error: ${error.message}`));
      };

      // リクエストを送信
      const request: TranspileRequest = {
        id,
        code: options.code,
        filePath: options.filePath,
        options: {
          isTypeScript: options.isTypeScript ?? false,
          isESModule: options.isESModule ?? false,
          isJSX: options.isJSX ?? false,
        },
      };

      worker.postMessage(request);
    });
  }

  /**
   * ファイルパスから言語を判定
   */
  detectLanguage(filePath: string): {
    isTypeScript: boolean;
    isESModule: boolean;
    isJSX: boolean;
  } {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    return {
      isTypeScript: ['ts', 'tsx', 'mts', 'cts'].includes(ext),
      isESModule: ['mjs', 'mts', 'jsx', 'tsx'].includes(ext),
      isJSX: ['jsx', 'tsx'].includes(ext),
    };
  }

  /**
   * コードからES Moduleかどうかを判定
   */
  isESModule(code: string): boolean {
    // コメントと文字列を除外して判定
    const cleaned = code
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '');

    return /^\s*(import|export)\s+/m.test(cleaned);
  }
}

/**
 * シングルトンインスタンス
 */
export const transpileManager = new TranspileManager();
