/**
 * Pyxis TypeScript Runtime Extension
 *
 * TypeScript/JSX/TSXファイルのトランスパイルをサポート
 * Web Workerを使用してメインスレッドをブロックしない
 */

import type { ExtensionActivation, ExtensionContext } from '../_shared/types';
import type { WorkerPool } from '../_shared/systemModuleTypes';

interface TranspileResponse {
  code: string;
  map?: string;
}

interface TranspileWorkerApi {
  transpile(request: {
    code: string;
    filePath: string;
    isTypeScript?: boolean;
    isJSX?: boolean;
  }): Promise<TranspileResponse>;
}

let transpileWorkerPool: WorkerPool<TranspileWorkerApi> | null = null;

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('TypeScript Runtime Extension activating...');

  // transpilerユーティリティを取得
  if (!context.getSystemModule) {
    throw new Error('getSystemModule not available');
  }

  let transformEsmToCjs: (code: string, filePath: string) => Promise<string>;
  let extractCjsDependencies: (code: string) => string[];
  let createTranspileWorkerPool: () => WorkerPool<TranspileWorkerApi>;
  try {
    const transpilerModule = await context.getSystemModule('transpiler');
    transformEsmToCjs = transpilerModule.transformEsmToCjs;
    extractCjsDependencies = transpilerModule.extractCjsDependencies;

    const workerRuntime = await context.getSystemModule('workerRuntime');
    createTranspileWorkerPool = () => {
      if (transpileWorkerPool) return transpileWorkerPool;

      const basePath =
        typeof window !== 'undefined' ? (window as any).__NEXT_PUBLIC_BASE_PATH__ || '' : '';
      const workerPath = `${basePath}/extensions/typescript-runtime/transpile.worker.js`;

      context.logger.info(`📦 Creating TypeScript worker pool from: ${workerPath}`);
      transpileWorkerPool = workerRuntime.createUrlWorkerPool<TranspileWorkerApi>({
        url: workerPath,
        maxWorkers: 2,
        timeoutMs: 30000,
      });
      return transpileWorkerPool;
    };

    context.logger.info('✅ transpiler loaded');
  } catch (error) {
    context.logger.warn('⚠️ Failed to load runtime modules:', error);
    throw new Error('transpiler and workerRuntime are required but could not be loaded');
  }

  async function transpileWithWorker(
    code: string,
    filePath: string,
    isTypeScript: boolean,
    isJSX: boolean
  ): Promise<TranspileResponse> {
    const pool = createTranspileWorkerPool();
    return pool.call(worker => worker.transpile({ code, filePath, isTypeScript, isJSX }));
  }

  const runtimeFeatures = {
    /**
     * TypeScriptトランスパイラ（Web Worker使用）
     */
    transpiler: async (code: string, options: any = {}) => {
      const { filePath = 'unknown.ts', isTypeScript } = options;

      context.logger.info(`🔄 Transpiling: ${filePath}`);

      try {
        // TypeScriptの場合: Web Workerでトランスパイル
        if (isTypeScript) {
          const result = await transpileWithWorker(code, filePath, true, false);
          const finalCode = await transformEsmToCjs(result.code, filePath);
          const dependencies = extractCjsDependencies(finalCode);

          context.logger.info(
            `✅ Transpiled: ${filePath} (${code.length} -> ${finalCode.length} bytes, ${dependencies.length} deps)`
          );

          return {
            code: finalCode,
            map: result.map,
            dependencies,
          };
        }
        // 普通のJSの場合: esbuildでCJSに変換
        else {
          const finalCode = await transformEsmToCjs(code, filePath);
          const dependencies = extractCjsDependencies(finalCode);

          context.logger.info(
            `✅ Transformed: ${filePath} (${code.length} -> ${finalCode.length} bytes, ${dependencies.length} deps)`
          );

          return {
            code: finalCode,
            dependencies,
          };
        }
      } catch (error) {
        // エラーの詳細情報を取得
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        context.logger.error(`❌ Transpile failed for ${filePath}:`, {
          message: errorMessage,
          stack: errorStack,
          error: error,
        });

        // エラーを再スローして上位でキャッチできるようにする
        throw new Error(`Transpile failed for ${filePath}: ${errorMessage}`);
      }
    },

    /**
     * ファイル拡張子のサポート情報
     */
    supportedExtensions: ['.ts', '.mts', '.cts'],

    /**
     * トランスパイルが必要か判定
     */
    needsTranspile: (filePath: string) => {
      return /\.(ts|mts|cts)$/.test(filePath);
    },
  };

  // RuntimeRegistryに登録
  await context.registerTranspiler?.({
    id: 'typescript',
    supportedExtensions: runtimeFeatures.supportedExtensions,
    needsTranspile: runtimeFeatures.needsTranspile,
    transpile: runtimeFeatures.transpiler,
  });
  context.logger.info('✅ TypeScript transpiler registered with RuntimeRegistry');

  context.logger.info('✅ TypeScript Runtime Extension activated');

  return {
    runtimeFeatures,
  };
}

/**
 * 拡張機能のデアクティベーション
 */
export async function deactivate(): Promise<void> {
  transpileWorkerPool?.terminate();
  transpileWorkerPool = null;
  console.log('[TypeScript Runtime] Deactivating...');
}
