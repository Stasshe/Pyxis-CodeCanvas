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

import * as Babel from '@babel/standalone';

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
function transpile(request: TranspileRequest): TranspileResult {
  try {
    const { code, filePath, options } = request;
    
    // ファイル拡張子を判定
    const ext = filePath.split('.').pop() || 'js';
    
    // Babelプリセットとプラグインを構築
    const presets: [string, any][] = [];
    const plugins: any[] = [];

    // TypeScriptサポート
    if (options.isTypeScript) {
      presets.push([
        'typescript',
        {
          isTSX: options.isJSX || ext === 'tsx',
          allExtensions: true,
        },
      ]);
    }

    // Reactサポート
    if (options.isJSX || ext === 'jsx' || ext === 'tsx') {
      presets.push([
        'react',
        {
          runtime: 'automatic',
          development: false,
        },
      ]);
    }

    // ES Moduleサポート（CommonJSに変換）
    if (options.isESModule) {
      plugins.push(
        ['@babel/plugin-transform-modules-commonjs', { strict: false }]
      );
    }

    // トランスパイル実行
    const result = Babel.transform(code, {
      filename: filePath,
      presets,
      plugins,
      sourceMaps: false, // 将来的にtrue
      sourceType: options.isESModule ? 'module' : 'script',
      compact: false,
      retainLines: true,
    });

    if (!result.code) {
      throw new Error('Babel transform returned empty code');
    }

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
    console.error('❌ Transpile error:', errorMessage);
    
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

console.log('✅ Transpile worker initialized with Babel standalone');
