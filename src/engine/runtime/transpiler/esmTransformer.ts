/**
 * ESM → CJS Transformer
 *
 * npmパッケージの.mjsファイルをinstall時にCJSへ変換するためのモジュール。
 *
 * - ブラウザ: esbuild-wasm (WASMベース、正確なESM→CJS変換)
 * - Node.js (テスト環境): esbuild (ネイティブ)
 *
 * esbuildを使うことでregexベースのnormalizeCjsEsmでは壊れる
 * 複雑なテンプレートリテラル・minified ESMも正確に変換できる。
 */

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

let api: EsbuildApi | null = null;
let initPromise: Promise<EsbuildApi | null> | null = null;

async function getApi(): Promise<EsbuildApi | null> {
  if (api) return api;
  if (initPromise) return initPromise;

  initPromise = (async (): Promise<EsbuildApi | null> => {
    if (typeof window === 'undefined') {
      // Node.js環境 (テスト): esbuildネイティブ
      const mod = await import('esbuild');
      api = mod as unknown as EsbuildApi;
      return api;
    }

    // ブラウザ環境: esbuild-wasm
    const mod = await import('esbuild-wasm');
    const esbuild = ((mod as any).default || mod) as EsbuildApi;

    if (esbuild.initialize) {
      try {
        await esbuild.initialize({ wasmURL: '/esbuild.wasm' });
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
 * ESMコードをCJSに変換する
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

  // esbuild変換後のpost-processing:
  // ブラウザ/custom runtimeのwrapperと衝突する宣言を除去・修正

  // import.meta → { url: "file:///" + __filename } に修正
  // esbuildは var/const import_meta = {} を生成するが url プロパティがない
  transformed = transformed.replace(
    /\b(?:var|let|const)\s+import_meta\s*=\s*\{\s*\};/g,
    'var import_meta = { url: "file:///" + __filename };'
  );

  // const __filename/__dirname はラッパーパラメータと strict mode 競合するため var に降格
  // (var はパラメータと共存できる; 除去は多行構文を壊すリスクあり)
  transformed = transformed.replace(/\bconst\s+(__filename|__dirname)\b/g, 'var $1');

  // process再宣言も除去（単行のみ）
  transformed = transformed.replace(
    /^[ \t]*(?:var|let|const)\s+process\s*=\s*require\(['"](?:node:)?process['"]\)\s*;?\n/gm,
    ''
  );

  return transformed;
}
