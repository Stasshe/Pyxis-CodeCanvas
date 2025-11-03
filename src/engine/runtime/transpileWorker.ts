/**
 * [NEW ARCHITECTURE] Transpile Worker
 *
 * ## 役割
 * Web Worker内でBabel standaloneを使用してトランスパイルを実行
 * メインスレッドをブロックせず、完了後にWorkerを即座に終了してメモリを解放
 *
 * ## 処理フロー
 * 1. Babel standaloneを初期化
 * 2. TypeScript/JSX/ES Moduleをトランスパイル
 * 3. 依存関係を抽出
 * 4. 結果をメインスレッドに返す
 * 5. Worker終了
 */
/**
 * [NEW ARCHITECTURE] Transpile Worker (Legacy - Not Used)
 *
 * このファイルは現在使用されていません。
 * トランスパイル処理は拡張機能 (extensions/typescript-runtime) で実行されます。
 *
 * @deprecated Use extension-based transpiler instead
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
 * @deprecated この実装は使用されていません
 */
function transpile(request: TranspileRequest): TranspileResult {
  try {
    const { code } = request;

    // CJS/ESM正規化のみ実行
    const normalizedCode = normalizeCjsEsm(code);

    // 依存関係を抽出
    const dependencies = extractDependencies(normalizedCode);

    return {
      id: request.id,
      code: normalizedCode,
      dependencies,
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
 * 依存関係を抽出
 */
function extractDependencies(code: string): string[] {
  const dependencies = new Set<string>();

  // require('module') パターン
  const requireRegex = /require\s*\(\s*['"]([^'\"]+)['"]\s*\)/g;
  let match;
  while ((match = requireRegex.exec(code)) !== null) {
    dependencies.add(match[1]);
  }

  // import 文（トランスパイル後にrequireに変換されているはず）
  const importRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'\"]+)['"]/g;
  while ((match = importRegex.exec(code)) !== null) {
    dependencies.add(match[1]);
  }

  return Array.from(dependencies);
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
    message: '⚠️ Transpile worker initialized (legacy - not used)',
  });
} catch {
  // ignore
}
