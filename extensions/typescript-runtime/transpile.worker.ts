/**
 * TypeScript Runtime Extension - Transpile Worker
 * 
 * Web Worker内でトランスパイルを実行
 * 
 * このファイルはpublic/extensions/にビルドされ、
 * Workerとして実行される。Babel StandaloneはCDNからロード。
 */

// Babel Standalone (グローバルから参照)
// 親スレッドでロード済みと仮定、または動的にロード
declare const Babel: any;

// Web Worker グローバル関数
declare function importScripts(...urls: string[]): void;

interface TranspileRequest {
  id: string;
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isJSX?: boolean;
  normalizeCjsEsm: string; // normalizeCjsEsm関数のコード文字列
  extractDependencies: string; // extractDependencies関数のコード文字列
}

interface TranspileResponse {
  id: string;
  code: string;
  map?: string;
  dependencies: string[];
  error?: string;
}

// メインスレッドから渡された関数を保持
let normalizeCjsEsm: ((code: string) => string) | null = null;
let extractDependencies: ((code: string) => string[]) | null = null;

// 関数を動的に初期化
function initializeFunctions(normalizeCjsEsmCode?: string, extractDependenciesCode?: string) {
  if (normalizeCjsEsmCode && !normalizeCjsEsm) {
    normalizeCjsEsm = new Function('code', normalizeCjsEsmCode) as (code: string) => string;
  }
  if (extractDependenciesCode && !extractDependencies) {
    extractDependencies = new Function('code', extractDependenciesCode) as (code: string) => string[];
  }
}

// フォールバック用の簡易実装
function fallbackExtractDependencies(code: string): string[] {
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

// TypeScript/JSXトランスパイル処理（Babel Standalone使用）
function transpileTypeScript(code: string, filePath: string, isJSX: boolean): string {
  if (typeof Babel === 'undefined') {
    throw new Error('Babel not loaded');
  }

  const presets = ['typescript'];
  const plugins: string[] = [];

  if (isJSX) {
    presets.push('react');
  }

  try {
    const result = Babel.transform(code, {
      presets,
      plugins,
      filename: filePath,
    });

    return result.code || code;
  } catch (error) {
    throw new Error(
      `Babel transpile error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Babel Standaloneをロード
if (typeof Babel === 'undefined') {
  importScripts('https://unpkg.com/@babel/standalone@7.26.5/babel.min.js');
}

// メッセージハンドラー
self.addEventListener('message', (event: MessageEvent<TranspileRequest>) => {
  const { id, code, filePath, isTypeScript, isJSX, normalizeCjsEsm: normalizeCjsEsmCode, extractDependencies: extractDependenciesCode } = event.data;

  try {
    // 関数を初期化（初回のみ）
    initializeFunctions(normalizeCjsEsmCode, extractDependenciesCode);

    let transpiledCode = code;

    // TypeScript/JSXの場合はトランスパイル
    if (isTypeScript || isJSX) {
      transpiledCode = transpileTypeScript(code, filePath, isJSX || false);
    }

    // CJS/ESM正規化
    const normalizedCode = normalizeCjsEsm 
      ? normalizeCjsEsm(transpiledCode)
      : transpiledCode;

    // 依存関係抽出
    const dependencies = extractDependencies
      ? extractDependencies(normalizedCode)
      : fallbackExtractDependencies(normalizedCode);

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
