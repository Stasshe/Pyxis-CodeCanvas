/**
 * Transpile Worker
 *
 * ## 役割
 * Web Worker内でesbuildベースのESM→CJS変換を実行
 * メインスレッドをブロックせず、完了後にWorkerを即座に終了してメモリを解放
 *
 * ## 処理フロー
 * 1. esbuildでESM→CJS変換
 * 2. CJSコードから依存関係を抽出
 * 3. 結果をメインスレッドに返す
 * 4. Worker終了
 *
 * ## 注意
 * TypeScript/JSXのトランスパイルは拡張機能 (extensions/typescript-runtime) で実行
 * このWorkerはビルトインのESM→CJS変換のみを担当
 * npmパッケージの.mjsファイルはinstall時にesbuildで事前変換済みのためここでは不要
 */

import { extractCjsDependencies, transformEsmToCjs } from './esmTransformer';

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
 * esbuildによるESM→CJS変換のみを行う
 */
async function transpile(request: TranspileRequest): Promise<TranspileResult> {
  try {
    const transformed = await transformEsmToCjs(request.code, request.filePath);

    return {
      id: request.id,
      code: transformed,
      dependencies: extractCjsDependencies(transformed),
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
self.addEventListener('message', async (event: MessageEvent<TranspileRequest>) => {
  const request = event.data;

  try {
    const result = await transpile(request);
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
    message: '✅ Transpile worker initialized (esbuild)',
  });
} catch {
  // ignore
}
