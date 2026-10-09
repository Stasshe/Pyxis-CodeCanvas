/** Transforms ESM to CJS in the browser, with native esbuild used in Node tests. */

import { posixPath } from '@/engine/core/pathUtils';
import { assetPath } from '@/env';
import type { TranspileBenchmark } from '../bridge/protocol';
import { protectTopLevelAwait, restoreTopLevelAwait } from '../module/awaitSyntax';
import { ModuleCode, type ModuleDependency } from '../module/moduleCode';

type EsbuildApi = {
  transform: typeof import('esbuild-wasm')['transform'];
  initialize?: (options: { wasmURL: string; worker: boolean }) => Promise<void>;
};

export function extractCjsDependencies(code: string): ModuleDependency[] {
  return ModuleCode.analyze(code).dependencies;
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

async function getApi(benchmark?: TranspileBenchmark): Promise<EsbuildApi | null> {
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
    let startedAt = 0;
    if (benchmark) startedAt = performance.now();
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

    if (benchmark) benchmark.initMs += performance.now() - startedAt;
    api = esbuild;
    return api;
  })();

  return initPromise;
}

/** Converts ESM or registered TypeScript input to CJS for the runtime wrapper. */
export async function transformEsmToCjs(
  code: string,
  filePath: string,
  options: { isTypeScript?: boolean; isJSX?: boolean; benchmark?: TranspileBenchmark } = {}
): Promise<string> {
  const esbuild = await getApi(options.benchmark);
  if (!esbuild) throw new Error('esbuild not available');

  let startedAt = 0;
  if (options.benchmark) startedAt = performance.now();
  const result = await esbuild.transform(protectTopLevelAwait(code, filePath), {
    // Import callbacks return normalized namespaces, so esbuild's raw Node require interop is disabled.
    format: 'cjs',
    target: 'es2020',
    loader: getLoader(options),
    platform: 'node',
    define: runtimeDefines(filePath),
  });
  if (options.benchmark) options.benchmark.transformMs += performance.now() - startedAt;
  return finalizeRuntimeCode(restoreTopLevelAwait(result.code));
}

export function finalizeRuntimeCode(code: string): string {
  return ModuleCode.runtimeCode(code, true);
}

export function runtimeDefines(filePath: string): Record<string, string> {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  return {
    require: '__pyxisRequireCommonJs',
    'import.meta.url': JSON.stringify(`file://${encodedPath}`),
    'import.meta.filename': JSON.stringify(filePath),
    'import.meta.dirname': JSON.stringify(posixPath.dirname(filePath)),
    'import.meta.resolve': '__pyxisImportMetaResolve',
  };
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
