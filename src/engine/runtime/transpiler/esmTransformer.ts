/**
 * ESM → CJS Transformer
 *
 * npmパッケージの.mjsファイルをinstall時にCJSへ変換するためのモジュール。
 *
 * - ブラウザ: esbuild-wasm (WASMベース、正確なESM→CJS変換)
 * - Node.js (テスト環境): esbuild (ネイティブ)
 *
 * esbuildが import/export・dynamic import() を正しく変換する。
 * post-processingはcustom runtimeのwrapperとの衝突回避のみ。
 */

import { assetPath } from '@/env';

type EsbuildApi = {
  transform(
    code: string,
    options: {
      format: string;
      target: string;
      loader: string;
      platform: string;
    }
  ): Promise<{ code: string }>;
  initialize?(options: { wasmURL: string }): Promise<void>;
};

export function extractCjsDependencies(code: string): string[] {
  const deps = new Set<string>();
  const re = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const dep = match[2];
    if (/[{}<>]/.test(dep)) continue;
    deps.add(dep);
  }
  // __pyxisImport("...") パターンも依存関係として抽出
  const pyxisImportRe = /\b__pyxisImport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((match = pyxisImportRe.exec(code)) !== null) {
    const dep = match[2];
    if (/[{}<>]/.test(dep)) continue;
    deps.add(dep);
  }
  return Array.from(deps);
}

let api: EsbuildApi | null = null;
let initPromise: Promise<EsbuildApi | null> | null = null;

export function getEsbuildWasmURL(): string {
  return assetPath('/esbuild.wasm');
}

async function importModuleDynamically<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}

async function getApi(): Promise<EsbuildApi | null> {
  if (api) return api;
  if (initPromise) return initPromise;

  initPromise = (async (): Promise<EsbuildApi | null> => {
    const isNode =
      typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
    if (isNode) {
      // Node.js環境 (テスト): esbuildネイティブ
      const mod = await importModuleDynamically<typeof import('esbuild')>('esbuild');
      api = mod as unknown as EsbuildApi;
      return api;
    }

    // ブラウザ環境 (WebWorker含む): esbuild-wasm
    const mod = await import('esbuild-wasm');
    const esbuild = ((mod as any).default || mod) as EsbuildApi;

    if (esbuild.initialize) {
      try {
        await esbuild.initialize({ wasmURL: getEsbuildWasmURL() });
      } catch (e) {
        // 既に初期化済み → 続行
        if (!String(e).includes('already been initialized')) {
          throw e;
        }
      }
    }

    api = esbuild;
    return api;
  })();

  return initPromise;
}

/**
 * ESMコードをCJSに変換する。
 * dynamic import() の変換はesbuildに委ねる。
 * post-processingはcustom runtimeのwrapperと衝突する宣言の修正のみ。
 */
export async function transformEsmToCjs(code: string, _filePath: string): Promise<string> {
  const esbuild = await getApi();
  if (!esbuild) throw new Error('esbuild not available');

  const result = await esbuild.transform(code, {
    format: 'cjs',
    target: 'es2020',
    loader: 'js',
    platform: 'node',
  });
  let transformed = result.code;

  // import.meta → { url: "file:///" + __filename }
  // esbuildは var/const import_meta = {} を生成するが url プロパティがない
  transformed = transformed.replace(
    /\b(?:var|let|const)\s+import_meta\s*=\s*\{\s*\};/g,
    'var import_meta = { url: "file:///" + __filename };'
  );

  // const __filename/__dirname はラッパーパラメータと strict mode で競合するため var に降格
  transformed = transformed.replace(/\bconst\s+(__filename|__dirname)\b/g, 'var $1');

  // process再宣言はラッパーが提供するため除去（単行のみ）
  transformed = transformed.replace(
    /^[ \t]*(?:var|let|const)\s+process\s*=\s*require\(['"](?:node:)?process['"]\)\s*;?\n/gm,
    ''
  );

  // new Function('varName', 'return import(varName)') パターン:
  // esbuildはFunction文字列内を解析しないため手動で変換（任意の変数名対応）
  // __pyxisImport を使い動的ロードに対応（pre-load 外モジュールも実行時にロード可能）
  transformed = transformed.replace(
    /new\s+Function\s*\(\s*(['"])([\w$]+)\1\s*,\s*(['"])return\s+import\(\s*\2\s*\)\3\s*\)/g,
    '(($2) => __pyxisImport($2))'
  );

  // esbuildが変換できなかった残存 import() を __pyxisImport() に置換
  // (import.meta は除外: import_meta として変換済みのため対象外)
  // これによりブラウザのネイティブ import() がランタイムの require() 経由になる
  transformed = transformed.replace(/(?<![.\w])import\s*\(/g, '__pyxisImport(');

  return transformed;
}
