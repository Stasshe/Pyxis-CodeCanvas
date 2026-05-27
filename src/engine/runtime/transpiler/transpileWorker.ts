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
 *
 * ## 注意
 * TypeScript/JSXのトランスパイルは拡張機能 (extensions/typescript-runtime) で実行
 * このWorkerはビルトインのESM→CJS変換のみを担当
 * npmパッケージの.mjsファイルはinstall時にesbuildで事前変換済みのためここでは不要
 */

import * as Comlink from 'comlink';
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
    return {
      id: request.id,
      code: '',
      dependencies: [],
      error: errorMessage,
    };
  }
}

export interface TranspileWorkerApi {
  transpile(request: TranspileRequest): Promise<TranspileResult>;
}

const api: TranspileWorkerApi = {
  transpile,
};

Comlink.expose(api);
