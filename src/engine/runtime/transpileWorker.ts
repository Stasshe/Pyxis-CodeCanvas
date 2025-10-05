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
import initSwc, * as swc from '@swc/wasm-web';
import { normalizeCjsEsm } from './normalizeCjsEsm';

// swc/wasm-webの初期化Promiseをグローバルで管理
let swcInitPromise: Promise<void> | null = null;
let swcInitialized = false;
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
 */
async function transpile(request: TranspileRequest): Promise<TranspileResult> {
  try {
    const { code, filePath, options } = request;
    const ext = filePath.split('.').pop() || 'js';

    // swc/wasm-webは明示的な初期化が必要（WASMバイナリのURLを指定）
    if (!swcInitialized) {
      if (!swcInitPromise) {
        // Worker内から見た絶対URLでswc.wasmを指定
        const wasmUrl = self.location.origin + '/swc.wasm';
        swcInitPromise = initSwc(wasmUrl).then(() => {
          swcInitialized = true;
        }).catch((e) => {
          swcInitPromise = null;
          throw e;
        });
      }
      await swcInitPromise;
    }

    // まずCJS/ESM変換の正規化
    let normalizedCode = normalizeCjsEsm(code);

    // swcでTypeScript/JSX/ESM変換
    const jsc: any = {
      parser: {
        syntax: options.isTypeScript ? 'typescript' : 'ecmascript',
        tsx: options.isJSX || ext === 'tsx',
        jsx: options.isJSX || ext === 'jsx',
        decorators: false,
        dynamicImport: true,
      },
      target: 'es2022',
    };
    if (options.isJSX || ext === 'jsx' || ext === 'tsx') {
      jsc.transform = {
        react: {
          development: false,
        },
      };
    }
    const swcOptions: any = {
      filename: filePath,
      jsc,
      module: {
        type: options.isESModule ? 'es6' : 'commonjs',
      },
      minify: false,
      sourceMaps: false,
    };
    const result = swc.transformSync(normalizedCode, swcOptions);
    if (!result.code) throw new Error('swc transform returned empty code');

    // 依存関係を抽出
    const dependencies = extractDependencies(result.code);

    return {
      id: request.id,
      code: result.code,
      sourceMap: result.map ? JSON.stringify(result.map) : undefined,
      dependencies,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      self.postMessage({ type: 'log', level: 'error', message: `❌ Transpile error: ${errorMessage}` });
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
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = requireRegex.exec(code)) !== null) {
    dependencies.add(match[1]);
  }

  // import 文（トランスパイル後にrequireに変換されているはず）
  // 念のため import from パターンも検出
  const importRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((match = importRegex.exec(code)) !== null) {
    dependencies.add(match[1]);
  }

  return Array.from(dependencies);
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
  self.close();
});

// Signal ready and log initialization to main thread
try {
  self.postMessage({ type: 'ready' });
  self.postMessage({ type: 'log', level: 'info', message: '✅ Transpile worker initialized with swc/wasm' });
} catch {
  // ignore
}
