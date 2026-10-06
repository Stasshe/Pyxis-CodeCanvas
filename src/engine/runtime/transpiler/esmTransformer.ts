/** Transforms ESM to CJS in the browser, with native esbuild used in Node tests. */

import { assetPath } from '@/env';

type EsbuildApi = {
  transform: typeof import('esbuild-wasm')['transform'];
  initialize?: (options: { wasmURL: string; worker: boolean }) => Promise<void>;
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
  // Include imports routed through the runtime loader.
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

async function importNativeEsbuild(): Promise<typeof import('esbuild')> {
  const specifier = 'esbuild';
  return import(/* @vite-ignore */ specifier) as Promise<typeof import('esbuild')>;
}

async function getApi(): Promise<EsbuildApi | null> {
  if (api) return api;
  if (initPromise) return initPromise;

  initPromise = (async (): Promise<EsbuildApi | null> => {
    const isNode =
      typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
    if (isNode) {
      // Use native esbuild in Node tests.
      const mod = await importNativeEsbuild();
      api = { transform: mod.transform };
      return api;
    }

    // Use esbuild-wasm in browser workers without creating another worker.
    const mod = await import('esbuild-wasm');
    const esbuild: EsbuildApi = {
      transform: mod.transform,
      initialize: mod.initialize,
    };

    if (esbuild.initialize) {
      try {
        await esbuild.initialize({ wasmURL: getEsbuildWasmURL(), worker: false });
      } catch (e) {
        // Another module instance may already have initialized esbuild.
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

/** Converts ESM or registered TypeScript input to CJS for the runtime wrapper. */
export async function transformEsmToCjs(
  code: string,
  _filePath: string,
  options: { isTypeScript?: boolean; isJSX?: boolean } = {}
): Promise<string> {
  const esbuild = await getApi();
  if (!esbuild) throw new Error('esbuild not available');

  const result = await esbuild.transform(code, {
    format: 'cjs',
    target: 'es2020',
    loader: getLoader(options),
    platform: 'node',
  });
  return finalizeRuntimeCode(result.code);
}

export function finalizeRuntimeCode(code: string): string {
  let transformed = code;

  // esbuild omits the URL property from its import.meta placeholder.
  transformed = transformed.replace(
    /\b(?:var|let|const)\s+import_meta\s*=\s*\{\s*\};/g,
    'var import_meta = { url: "file:///" + __filename };'
  );

  // Avoid conflicts with the strict-mode wrapper parameters.
  transformed = transformed.replace(/\bconst\s+(__filename|__dirname)\b/g, 'var $1');

  // The wrapper already provides process.
  transformed = transformed.replace(
    /^[ \t]*(?:var|let|const)\s+process\s*=\s*require\(['"](?:node:)?process['"]\)\s*;?\n/gm,
    ''
  );

  // Rewrite the dynamic import pattern because esbuild does not parse Function strings.
  transformed = transformed.replace(
    /new\s+Function\s*\(\s*(['"])([\w$]+)\1\s*,\s*(['"])return\s+import\(\s*\2\s*\)\3\s*\)/g,
    '(($2) => __pyxisImport($2))'
  );

  // Route remaining dynamic imports through the runtime loader.
  transformed = transformed.replace(/(?<![.\w])import\s*\(/g, '__pyxisImport(');

  return transformed;
}

function getLoader(options: {
  isTypeScript?: boolean;
  isJSX?: boolean;
}): import('esbuild-wasm').Loader {
  if (options.isTypeScript && options.isJSX) return 'tsx';
  if (options.isTypeScript) return 'ts';
  if (options.isJSX) return 'jsx';
  return 'js';
}
