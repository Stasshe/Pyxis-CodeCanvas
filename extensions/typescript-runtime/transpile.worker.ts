/**
 * TypeScript Runtime Extension - Transpile Worker
 * 
 * Web Worker内でトランスパイルを実行
 * 
 * このファイルはpublic/extensions/にビルドされ、
 * Workerとして実行される。TypeScript CompilerはCDNからロード。
 */

// TypeScript Compiler API (グローバルから参照)
// 親スレッドでロード済みと仮定、または動的にロード
declare const ts: any;

// Web Worker グローバル関数
declare function importScripts(...urls: string[]): void;

interface TranspileRequest {
  id: string;
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isJSX?: boolean;
}

interface TranspileResponse {
  id: string;
  code: string;
  map?: string;
  dependencies: string[];
  error?: string;
}

// normalizeCjsEsm関数（Worker内で実行されるため、シンプルに実装）
function normalizeCjsEsm(code: string): string {
  // require → import変換の基本的な処理
  // より高度な変換が必要な場合は、メインスレッドから渡されたコードを使う
  return code
    .replace(/const\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, "import $1 from '$2'")
    .replace(/module\.exports\s*=\s*/g, 'export default ')
    .replace(/exports\.(\w+)\s*=/g, 'export const $1 =');
}

function extractDependencies(code: string): string[] {
  const dependencies = new Set<string>();

  // require('module')
  const requireRegex = /require\s*\(\s*['"]([^'\"]+)['"]\s*\)/g;
  let match;
  while ((match = requireRegex.exec(code)) !== null) {
    dependencies.add(match[1]);
  }

  // import ... from 'module'
  const importRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'\"]+)['"]/g;
  while ((match = importRegex.exec(code)) !== null) {
    dependencies.add(match[1]);
  }

  return Array.from(dependencies);
}

// TypeScriptトランスパイル処理
function transpileTypeScript(code: string, filePath: string, isJSX: boolean): string {
  if (typeof ts === 'undefined') {
    throw new Error('TypeScript compiler not loaded');
  }

  const compilerOptions: any = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    jsx: isJSX ? ts.JsxEmit.React : undefined,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    lib: ['ES2020', 'DOM'],
  };

  const result = ts.transpileModule(code, {
    compilerOptions,
    fileName: filePath,
  });

  return result.outputText;
}

// Worker初期化: TypeScript Compiler APIをロード
if (typeof ts === 'undefined') {
  // CDNからTypeScriptをロード
  importScripts('https://unpkg.com/typescript@5.7.3/lib/typescript.js');
}

// メッセージハンドラー
self.addEventListener('message', (event: MessageEvent<TranspileRequest>) => {
  const { id, code, filePath, isTypeScript, isJSX } = event.data;

  try {
    let transpiledCode = code;

    // TypeScript/JSXの場合はトランスパイル
    if (isTypeScript || isJSX) {
      transpiledCode = transpileTypeScript(code, filePath, isJSX || false);
    }

    // CJS/ESM正規化
    const normalizedCode = normalizeCjsEsm(transpiledCode);

    // 依存関係抽出
    const dependencies = extractDependencies(normalizedCode);

    const response: TranspileResponse = {
      id,
      code: normalizedCode,
      dependencies,
    };

    self.postMessage(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const response: TranspileResponse = {
      id,
      code: '',
      dependencies: [],
      error: errorMessage,
    };
    self.postMessage(response);
  }

  // Worker終了（メモリ解放）
  self.close();
});

// 初期化完了を通知
self.postMessage({ type: 'ready' });
