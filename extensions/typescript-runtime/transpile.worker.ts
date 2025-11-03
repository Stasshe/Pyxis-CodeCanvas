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
    // 関数全体の文字列を評価して関数として取得
    // eslint-disable-next-line no-eval
    normalizeCjsEsm = eval(`(${normalizeCjsEsmCode})`) as (code: string) => string;
  }
  if (extractDependenciesCode && !extractDependencies) {
    // eslint-disable-next-line no-eval
    extractDependencies = eval(`(${extractDependenciesCode})`) as (code: string) => string[];
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
    // Babelのロード確認
    if (typeof Babel === 'undefined') {
      throw new Error('Babel is not loaded. CDN may be blocked or importScripts failed.');
    }

    // 関数コードの受信確認
    if (!normalizeCjsEsmCode) {
      throw new Error('normalizeCjsEsm code not provided from main thread');
    }
    if (!extractDependenciesCode) {
      throw new Error('extractDependencies code not provided from main thread');
    }

    // 関数を初期化（初回のみ）
    try {
      initializeFunctions(normalizeCjsEsmCode, extractDependenciesCode);
    } catch (fnError) {
      throw new Error(`Function initialization failed: ${fnError instanceof Error ? fnError.message : String(fnError)}`);
    }

    let transpiledCode = code;

    // TypeScript/JSXの場合はトランスパイル
    if (isTypeScript || isJSX) {
      try {
        transpiledCode = transpileTypeScript(code, filePath, isJSX || false);
      } catch (tsError) {
        throw new Error(`TypeScript transpile failed: ${tsError instanceof Error ? tsError.message : String(tsError)}`);
      }
    }

    // CJS/ESM正規化
    let normalizedCode: string;
    try {
      normalizedCode = normalizeCjsEsm 
        ? normalizeCjsEsm(transpiledCode)
        : transpiledCode;
    } catch (normError) {
      throw new Error(`normalizeCjsEsm failed: ${normError instanceof Error ? normError.message : String(normError)}`);
    }

    // 依存関係抽出
    let dependencies: string[];
    try {
      dependencies = extractDependencies
        ? extractDependencies(normalizedCode)
        : fallbackExtractDependencies(normalizedCode);
    } catch (depError) {
      throw new Error(`extractDependencies failed: ${depError instanceof Error ? depError.message : String(depError)}`);
    }

    const response: TranspileResponse = {
      id,
      code: normalizedCode,
      dependencies,
    };

    self.postMessage(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const response: TranspileResponse = {
      id,
      code: '',
      dependencies: [],
      error: `[Worker Error] ${errorMessage}${errorStack ? '\nStack: ' + errorStack : ''}`,
    };
    self.postMessage(response);
  }

  // Worker終了（メモリ解放）
  self.close();
});

// 初期化完了を通知
self.postMessage({ type: 'ready' });
