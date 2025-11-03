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
  dependencies: string[];
  error?: string;
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('TypeScript Runtime Extension activating...');

  // normalizeCjsEsmユーティリティを取得
  let normalizeCjsEsm: (code: string) => string;
  try {
    if (context.getSystemModule) {
      // getSystemModule('normalizeCjsEsm')はモジュール全体を返す
      // { normalizeCjsEsm: function }
      const module = await context.getSystemModule<{ normalizeCjsEsm: (code: string) => string }>('normalizeCjsEsm');
      normalizeCjsEsm = module.normalizeCjsEsm;
      context.logger?.info('✅ normalizeCjsEsm loaded');
    } else {
      throw new Error('getSystemModule not available');
    }
  } catch (error) {
    context.logger?.warn('⚠️ Failed to load normalizeCjsEsm, using fallback:', error);
    throw new Error('normalizeCjsEsm is required but could not be loaded');
  }

  /**
   * 依存関係を抽出
   */
  function extractDependencies(code: string): string[] {
    const dependencies = new Set<string>();

    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requireRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    const importRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    return Array.from(dependencies);
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
        
        context.logger?.info(`📦 Loading worker from: ${workerPath}`);
        
        const worker = new Worker(workerPath);
        
        // タイムアウト設定
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error('Transpile timeout'));
        }, 30000); // 30秒
        
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data;
          
          // 初期化メッセージは無視
          if (data.type === 'ready') {
            context.logger?.info('✅ Worker ready');
            return;
          }
          
          // 結果を処理
          clearTimeout(timeout);
          worker.terminate();
          
          const response = data as TranspileResponse;
          
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        };
        
        worker.onerror = (error) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(`Worker error: ${error.message}`));
        };
        
        // normalizeCjsEsmとextractDependenciesの関数本体を文字列として取得
        const normalizeCjsEsmCode = normalizeCjsEsm.toString().replace(/^function\s+\w*\s*\([^)]*\)\s*{|}$/g, '');
        const extractDependenciesCode = extractDependencies.toString().replace(/^function\s+\w*\s*\([^)]*\)\s*{|}$/g, '');
        
        // デバッグ: 関数コードが正しく取得できているか確認
        context.logger?.info(`📝 normalizeCjsEsm code length: ${normalizeCjsEsmCode.length}`);
        context.logger?.info(`📝 extractDependencies code length: ${extractDependenciesCode.length}`);
        
        if (!normalizeCjsEsmCode || normalizeCjsEsmCode.length < 10) {
          reject(new Error('normalizeCjsEsm function code extraction failed'));
          worker.terminate();
          return;
        }
        if (!extractDependenciesCode || extractDependenciesCode.length < 10) {
          reject(new Error('extractDependencies function code extraction failed'));
          worker.terminate();
          return;
        }
        
        // リクエスト送信
        worker.postMessage({
          id,
          code,
          filePath,
          isTypeScript,
          isJSX,
          normalizeCjsEsm: normalizeCjsEsmCode,
          extractDependencies: extractDependenciesCode,
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }

  const runtimeFeatures = {
    /**
     * TypeScriptトランスパイラ（Web Worker使用）
     */
    transpiler: async (code: string, options: any = {}) => {
      const { filePath = 'unknown.ts', isTypeScript, isJSX } = options;
      
      context.logger?.info(`🔄 Transpiling: ${filePath}`);
      
      try {
        // TypeScriptまたはJSXの場合: Web Workerでトランスパイル
        if (isTypeScript || isJSX) {
          const result = await transpileWithWorker(code, filePath, isTypeScript || false, isJSX || false);
          
          context.logger?.info(`✅ Transpiled: ${filePath} (${code.length} -> ${result.code.length} bytes, ${result.dependencies.length} deps)`);
          
          return {
            code: result.code,
            map: result.map,
            dependencies: result.dependencies,
          };
        } 
        // 普通のJSの場合: normalizeCjsEsmのみ（渡されたものを使用）
        else {
          const finalCode = normalizeCjsEsm(code);
          const dependencies = extractDependencies(finalCode);
          
          context.logger?.info(`✅ Normalized: ${filePath} (${code.length} -> ${finalCode.length} bytes, ${dependencies.length} deps)`);
          
          return {
            code: finalCode,
            dependencies,
          };
        }
      } catch (error) {
        context.logger?.error(`❌ Transpile failed for ${filePath}:`, error);
        throw error;
      }
    },

    /**
     * ファイル拡張子のサポート情報
     */
    supportedExtensions: ['.ts', '.tsx', '.mts', '.cts', '.jsx'],

    /**
     * トランスパイルが必要か判定
     */
    needsTranspile: (filePath: string) => {
      return /\.(ts|tsx|mts|cts|jsx)$/.test(filePath);
    },
  };

  context.logger?.info('✅ TypeScript Runtime Extension activated');

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
