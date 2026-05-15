/**
 * TypeScript Runtime Extension - Transpile Worker
 *
 * Web Worker内でトランスパイルを実行
 *
 * このファイルはpublic/extensions/にビルドされ、
 * Workerとして実行される。Babel StandaloneはCDNからロード。
 */

import * as Comlink from 'comlink';

// Babel Standalone (グローバルから参照)
// 親スレッドでロード済みと仮定、または動的にロード
declare const Babel: any;

// Web Worker グローバル関数
declare function importScripts(...urls: string[]): void;

interface TranspileRequest {
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isJSX?: boolean;
}

interface TranspileResponse {
  code: string;
  map?: string;
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

export interface TranspileWorkerApi {
  transpile(request: TranspileRequest): Promise<TranspileResponse>;
}

const api: TranspileWorkerApi = {
  async transpile(request) {
    const { code, filePath, isTypeScript, isJSX } = request;

    if (typeof Babel === 'undefined') {
      throw new Error('Babel is not loaded. CDN may be blocked or importScripts failed.');
    }

    if (!isTypeScript && !isJSX) {
      return { code };
    }

    try {
      return {
        code: transpileTypeScript(code, filePath, isJSX || false),
      };
    } catch (tsError) {
      throw new Error(
        `TypeScript transpile failed: ${
          tsError instanceof Error ? tsError.message : String(tsError)
        }`
      );
    }
  },
};

Comlink.expose(api);
