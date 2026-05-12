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
}

interface TranspileResponse {
  id: string;
  code: string;
  map?: string;
  error?: string;
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
  const { id, code, filePath, isTypeScript, isJSX } = event.data;

  try {
    // Babelのロード確認
    if (typeof Babel === 'undefined') {
      throw new Error('Babel is not loaded. CDN may be blocked or importScripts failed.');
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

    const response: TranspileResponse = {
      id,
      code: transpiledCode,
    };

    self.postMessage(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const response: TranspileResponse = {
      id,
      code: '',
      error: `[Worker Error] ${errorMessage}${errorStack ? '\nStack: ' + errorStack : ''}`,
    };
    self.postMessage(response);
  }

  // Worker終了（メモリ解放）
  self.close();
});

// 初期化完了を通知
self.postMessage({ type: 'ready' });
