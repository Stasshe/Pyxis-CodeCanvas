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
      const module = await context.getSystemModule('normalizeCjsEsm');
      normalizeCjsEsm = (module as any).normalizeCjsEsm;
      context.logger?.info('✅ normalizeCjsEsm loaded');
    } else {
      throw new Error('getSystemModule not available');
    }
  } catch (error) {
    context.logger?.warn('⚠️ Failed to load normalizeCjsEsm, using fallback:', error);
    // フォールバック: シンプルな実装
    normalizeCjsEsm = (code: string) => {
      return code
        .replace(/const\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, "import $1 from '$2'")
        .replace(/module\.exports\s*=\s*/g, 'export default ')
        .replace(/exports\.(\w+)\s*=/g, 'export const $1 =');
    };
  }

  /**
   * 依存関係を抽出
   */
  function extractDependencies(code: string): string[] {
    const dependencies = new Set<string>();

    const requireRegex = /require\s*\(\s*['"]([^'\"]+)['"]\s*\)/g;
    let match;
    while ((match = requireRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    const importRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'\"]+)['"]/g;
    while ((match = importRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    return Array.from(dependencies);
  }

  /**
   * Web Workerを使用してトランスパイル
   */
  async function transpileWithWorker(code: string, filePath: string, isTypeScript: boolean, isJSX: boolean): Promise<TranspileResponse> {
    return new Promise((resolve, reject) => {
      const id = `transpile_${Date.now()}_${Math.random()}`;
      
      try {
        // normalizeCjsEsm関数を文字列化
        const normalizeCjsEsmStr = normalizeCjsEsm.toString();
        
        // Worker用のコードを作成
        const workerCode = `
          // TypeScript Compiler APIをCDNからロード
          importScripts('https://unpkg.com/typescript@5.7.3/lib/typescript.js');
          
          // normalizeCjsEsm関数（渡された実装を使用）
          const normalizeCjsEsm = ${normalizeCjsEsmStr};
          
          // 依存関係抽出
          function extractDependencies(code) {
            const dependencies = new Set();
            const requireRegex = /require\\s*\\(\\s*['"]([^'\"]+)['"\\s*\\)/g;
            let match;
            while ((match = requireRegex.exec(code)) !== null) {
              dependencies.add(match[1]);
            }
            const importRegex = /import\\s+(?:[\\w*{}\\s,]+\\s+from\\s+)?['"]([^'\"]+)['"]/g;
            while ((match = importRegex.exec(code)) !== null) {
              dependencies.add(match[1]);
            }
            return Array.from(dependencies);
          }
          
          // TypeScriptトランスパイル
          function transpileTypeScript(code, filePath, isJSX) {
            if (typeof ts === 'undefined') {
              throw new Error('TypeScript compiler not available');
            }
            
            const result = ts.transpileModule(code, {
              compilerOptions: {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.ES2020,
                jsx: isJSX ? ts.JsxEmit.ReactJSX : undefined,
                jsxImportSource: 'react',
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
              },
              fileName: filePath,
            });
            
            return result.outputText;
          }
          
          // メッセージハンドラー
          self.addEventListener('message', (event) => {
            const { id, code, filePath, isTypeScript, isJSX } = event.data;
            
            try {
              let transpiledCode = code;
              
              // TypeScript/JSXの場合はトランスパイル
              if (isTypeScript || isJSX) {
                transpiledCode = transpileTypeScript(code, filePath, isJSX);
              }
              
              // CJS/ESM正規化（渡されたnormalizeCjsEsmを使用）
              const normalizedCode = normalizeCjsEsm(transpiledCode);
              
              // 依存関係抽出
              const dependencies = extractDependencies(normalizedCode);
              
              self.postMessage({
                id,
                code: normalizedCode,
                dependencies,
              });
            } catch (error) {
              self.postMessage({
                id,
                code: '',
                dependencies: [],
                error: error.message,
              });
            }
            
            // Worker終了
            self.close();
          });
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        
        // タイムアウト設定
        const timeout = setTimeout(() => {
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error('Transpile timeout'));
        }, 30000); // 30秒
        
        worker.onmessage = (event: MessageEvent<TranspileResponse>) => {
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve(event.data);
          }
        };
        
        worker.onerror = (error) => {
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error(`Worker error: ${error.message}`));
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
