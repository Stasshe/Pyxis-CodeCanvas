/**
 * [NEW ARCHITECTURE] Transpile Worker
 *
 * ## 役割
 * Web Worker内でnormalizeCjsEsmを実行
 * メインスレッドをブロックせず、完了後にWorkerを即座に終了してメモリを解放
 *
 * ## 処理フロー
 * 1. normalizeCjsEsmでCJS/ESM変換
 * 2. 依存関係を抽出
 * 3. 結果をメインスレッドに返す
 * 4. Worker終了
 *
 * ## 注意
 * TypeScript/JSXのトランスパイルは拡張機能 (extensions/typescript-runtime) で実行
 * このWorkerはビルトインのCJS/ESM変換のみを担当
 */

import { normalizeCjsEsm } from './normalizeCjsEsm';

// transpileWorker runs inside a WebWorker context; runtime logger may not be available here.
// Use console for worker-level diagnostics and ensure messages are concise.

/**
 * トランスパイルリクエスト
 */
export interface TranspileRequest {
  id: string;
  code: string;
  filePath: string;
  options: {
    isTypeScript: boolean;
    isESModule: boolean;
    isJSX: boolean;
  };
}

/**
 * トランスパイル結果
 */
export interface TranspileResult {
  id: string;
  code: string;
  sourceMap?: string;
  dependencies: string[];
  error?: string;
}

/**
 * トランスパイル実行
 * normalizeCjsEsmによるCJS/ESM変換のみを行う
 */
function transpile(request: TranspileRequest): TranspileResult {
  try {
    const { code } = request;

    // CJS/ESM正規化を実行（依存関係も同時に抽出される）
    const normalized = normalizeCjsEsm(code);

    // デバッグ: normalizeCjsEsmの戻り値を確認
    console.log('🔍 normalizeCjsEsm result:', typeof normalized, normalized);
    console.log('🔍 normalized.code type:', typeof normalized.code);
    console.log('🔍 normalized.dependencies:', normalized.dependencies);

    return {
      id: request.id,
      code: normalized.code,
      dependencies: normalized.dependencies,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      self.postMessage({
        type: 'log',
        level: 'error',
        message: `❌ Transpile error: ${errorMessage}`,
      });
    } catch {
      console.error(`postMessage failed, ❌ Transpile error: ${errorMessage}`);
    }

    return {
      id: request.id,
      code: '',
      dependencies: [],
      error: errorMessage,
    };
  }
}

/**
 * メッセージハンドラー
 */
self.addEventListener('message', (event: MessageEvent<TranspileRequest>) => {
  const request = event.data;

  try {
    const result = transpile(request);
    self.postMessage(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    self.postMessage({
      id: request.id,
      code: '',
      dependencies: [],
      error: errorMessage,
    } as TranspileResult);
  }

  // Worker終了（メモリ解放）
  self.close();
});

// Signal ready and log initialization to main thread
try {
  self.postMessage({ type: 'ready' });
  self.postMessage({
    type: 'log',
    level: 'info',
    message: '✅ Transpile worker initialized (normalizeCjsEsm)',
  });
} catch {
  // ignore
}
