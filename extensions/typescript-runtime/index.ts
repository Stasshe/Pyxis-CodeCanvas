/**
 * Pyxis TypeScript Runtime Extension
 * 
 * TypeScript/JSX/TSXファイルのトランスパイルをサポート
 * Web Workerを使用してメインスレッドをブロックしない
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

interface TranspileResponse {
  id: string;
  code: string;
  map?: string;
  error?: string;
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('TypeScript Runtime Extension activating...');

  // transpilerユーティリティを取得
  if (!context.getSystemModule) {
    throw new Error('getSystemModule not available');
  }

  let transformEsmToCjs: (code: string, filePath: string) => Promise<string>;
  let extractCjsDependencies: (code: string) => string[];
  try {
    const module = await context.getSystemModule('transpiler');
    transformEsmToCjs = module.transformEsmToCjs;
    extractCjsDependencies = module.extractCjsDependencies;
    context.logger.info('✅ transpiler loaded');
  } catch (error) {
    context.logger.warn('⚠️ Failed to load transpiler:', error);
    throw new Error('transpiler is required but could not be loaded');
  }

  /**
   * Web Workerを使用してトランスパイル
   * transpile.worker.tsファイルを使用
   */
  async function transpileWithWorker(code: string, filePath: string, isTypeScript: boolean, isJSX: boolean): Promise<TranspileResponse> {
    return new Promise((resolve, reject) => {
      const id = `transpile_${Date.now()}_${Math.random()}`;
      
      try {
        // Workerファイルのパスを取得
        // NEXT_PUBLIC_BASE_PATHを考慮してパスを構築
        const basePath = typeof window !== 'undefined' 
          ? (window as any).__NEXT_PUBLIC_BASE_PATH__ || ''
          : '';
        const workerPath = `${basePath}/extensions/typescript-runtime/transpile.worker.js`;
        
        context.logger.info(`📦 Loading worker from: ${workerPath}`);
        
        let worker: Worker;
        try {
          worker = new Worker(workerPath);
        } catch (workerError) {
          const errorMsg = `Failed to create Worker from ${workerPath}: ${workerError instanceof Error ? workerError.message : String(workerError)}`;
          context.logger.error(`🔴 ${errorMsg}`);
          reject(new Error(errorMsg));
          return;
        }
        
        // タイムアウト設定
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Transpile timeout'));
        }, 30000); // 30秒
        
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data;
          
          // 初期化メッセージは無視
          if (data.type === 'ready') {
            context.logger.info('✅ Worker ready');
            return;
          }
          
          // 結果を処理
          clearTimeout(timeout);
          worker.terminate();
          
          const response = data as TranspileResponse;
          
          if (response.error) {
            context.logger.error(`🔴 Worker returned error for ${filePath}:`, response.error);
            reject(new Error(response.error));
          } else {
            context.logger.info(`✅ Worker success for ${filePath}`);
            resolve(response);
          }
        };
        
        worker.onerror = (error) => {
          clearTimeout(timeout);
          worker.terminate();
          const errorMsg = `Worker error for ${filePath}: ${error.message || 'Unknown error'}`;
          context.logger.error(`🔴 ${errorMsg}`, error);
          reject(new Error(errorMsg));
        };
        
        // リクエスト送信
        worker.postMessage({
          id,
          code,
          filePath,
          isTypeScript,
          isJSX,
        });
        
      } catch (error) {
        const errorMsg = `transpileWithWorker caught error: ${error instanceof Error ? error.message : String(error)}`;
        context.logger.error(`🔴 ${errorMsg}`, error);
        reject(new Error(errorMsg));
      }
    });
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
          
          context.logger.info(`✅ Transpiled: ${filePath} (${code.length} -> ${finalCode.length} bytes, ${dependencies.length} deps)`);
          
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
          
          context.logger.info(`✅ Transformed: ${filePath} (${code.length} -> ${finalCode.length} bytes, ${dependencies.length} deps)`);
          
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
  console.log('[TypeScript Runtime] Deactivating...');
}
