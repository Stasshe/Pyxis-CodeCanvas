/**
 * Pyxis TypeScript Runtime Extension
 * 
 * TypeScript/TSX/MTSのトランスパイル機能を提供
 * transpileManagerを活用して既存のトランスパイル機構を再利用
 */

import type { ExtensionContext, ExtensionActivation } from '@/engine/extensions/types';

/**
 * 拡張機能のアクティベーション
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('TypeScript Runtime Extension activating...');

  // transpileManagerは既にtranspileWorkerを使用して本格的なトランスパイルを実装している
  // ここではそれをラップして拡張機能として提供する
  
  // 動的importでtranspileManagerを取得
  const { transpileManager } = await import('@/engine/runtime/transpileManager');
  const { normalizeCjsEsm } = await import('@/engine/runtime/normalizeCjsEsm');

  /**
   * TypeScriptトランスパイラ
   */
  const transpiler = async (code: string, options: any = {}) => {
    const {
      filePath = 'unknown.ts',
      isTypeScript = true,
      isESModule = false,
      isJSX = false,
    } = options;

    try {
      context.logger.info(`Transpiling: ${filePath}`);

      // transpileManagerを使用（既存の実装を活用）
      const result = await transpileManager.transpile({
        code,
        filePath,
        isTypeScript,
        isESModule,
        isJSX,
      });

      context.logger.info(`Transpile completed: ${filePath}`);

      return {
        code: result.code,
        map: result.sourceMap,
        dependencies: result.dependencies,
      };
    } catch (error) {
      context.logger.error('Transpile failed:', error);
      
      // フォールバック: normalizeCjsEsmのみを使用
      try {
        context.logger.warn('Falling back to normalizeCjsEsm...');
        const normalized = normalizeCjsEsm(code);
        return {
          code: normalized,
          map: null,
          dependencies: [],
        };
      } catch (fallbackError) {
        context.logger.error('Fallback also failed:', fallbackError);
        throw error;
      }
    }
  };

  /**
   * ファイル拡張子から言語を自動検出
   */
  const detectLanguage = (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    return {
      isTypeScript: ['ts', 'tsx', 'mts', 'cts'].includes(ext),
      isESModule: ['mjs', 'mts', 'jsx', 'tsx'].includes(ext),
      isJSX: ['jsx', 'tsx'].includes(ext),
    };
  };

  /**
   * ES Moduleかどうかをコード内容から判定
   */
  const isESModule = (code: string): boolean => {
    const cleaned = code
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '');

    return /^\s*(import|export)\s+/m.test(cleaned);
  };

  context.logger.info('TypeScript Runtime Extension activated');

  return {
    runtimeFeatures: {
      transpiler,
      detectLanguage,
      isESModule,
      // transpileManagerへの直接アクセスも提供
      getTranspileManager: () => transpileManager,
    },
  };
}

/**
 * 拡張機能のデアクティベーション
 */
export async function deactivate(): Promise<void> {
  console.log('[TypeScript Runtime] Deactivating...');
}
