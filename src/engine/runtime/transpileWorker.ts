/**
 * [NEW ARCHITECTURE] Transpile Worker
 * 
 * ## 役割
 * Web Worker内でSWC wasmを使用してトランスパイルを実行
 * メインスレッドをブロックせず、完了後にWorkerを即座に終了してメモリを解放
 * 
 * ## 処理フロー
 * 1. SWC wasmを初期化
 * 2. TypeScript/JSX/ES Moduleをトランスパイル
 * 3. 依存関係を抽出
 * 4. 結果をメインスレッドに返す
 * 5. Worker終了
 */

import * as swc from '@swc/wasm-web';

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

let swcInitialized = false;

/**
 * SWCを初期化
 */
async function initializeSWC(): Promise<void> {
  if (swcInitialized) return;
  
  try {
    await swc.default();
    swcInitialized = true;
    console.log('✅ SWC wasm initialized in worker');
  } catch (error) {
    console.error('❌ Failed to initialize SWC wasm:', error);
    throw error;
  }
}

/**
 * トランスパイル実行
 */
async function transpile(request: TranspileRequest): Promise<TranspileResult> {
  try {
    // SWCを初期化
    await initializeSWC();

    // ファイル拡張子を判定
    const ext = request.filePath.split('.').pop() || 'js';
    
    // SWCオプションを構築
    const swcOptions: swc.Options = {
      filename: request.filePath,
      sourceMaps: false, // 将来的にtrue
      jsc: {
        parser: request.options.isTypeScript
          ? {
              syntax: 'typescript',
              tsx: request.options.isJSX || ext === 'tsx',
              decorators: true,
              dynamicImport: true,
            }
          : {
              syntax: 'ecmascript',
              jsx: request.options.isJSX || ext === 'jsx',
              decorators: true,
              dynamicImport: true,
            },
        target: 'es2020',
        transform: {
          react: {
            runtime: 'automatic',
            development: false,
          },
        },
        externalHelpers: false,
        keepClassNames: true,
      },
      module: {
        type: 'commonjs',
        strict: false,
        strictMode: false,
        lazy: false,
        noInterop: false,
      },
      minify: false,
      isModule: request.options.isESModule,
    };

    // トランスパイル実行
    const result = await swc.transform(request.code, swcOptions);

    // 依存関係を抽出
    const dependencies = extractDependencies(result.code);

    return {
      id: request.id,
      code: result.code,
      sourceMap: result.map,
      dependencies,
    };
  } catch (error) {
    console.error('❌ Transpile error:', error);
    return {
      id: request.id,
      code: '',
      dependencies: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 依存関係を抽出
 */
function extractDependencies(code: string): string[] {
  const deps: string[] = [];
  
  // require()を抽出
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = requireRegex.exec(code)) !== null) {
    deps.push(match[1]);
  }

  // import文を抽出（念のため）
  const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
  while ((match = importRegex.exec(code)) !== null) {
    deps.push(match[1]);
  }

  return [...new Set(deps)]; // 重複を削除
}

/**
 * Workerメッセージハンドラ
 */
self.addEventListener('message', async (event: MessageEvent<TranspileRequest>) => {
  const request = event.data;
  
  try {
    const result = await transpile(request);
    self.postMessage(result);
  } catch (error) {
    self.postMessage({
      id: request.id,
      code: '',
      dependencies: [],
      error: error instanceof Error ? error.message : String(error),
    } as TranspileResult);
  }
  
  // Worker終了（メモリ解放）
  self.close();
});

// 初期化メッセージ
self.postMessage({ type: 'ready' });
