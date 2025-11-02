/**
 * Pyxis TypeScript Runtime Extension
 * 
 * TypeScript/JSX/TSXファイルのトランスパイルをサポート
 * 既存のtranspileManagerをラップして提供
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('TypeScript Runtime Extension activating...');

  // contextから既存のtranspileManagerを取得
  let transpileManager: any;
  if (context.getSystemModule) {
    try {
      transpileManager = await context.getSystemModule('transpileManager');
      context.logger?.info('Loaded transpileManager from system');
    } catch (error) {
      context.logger?.error('Failed to load transpileManager:', error);
      throw new Error('Failed to load TypeScript transpiler');
    }
  } else {
    throw new Error('getSystemModule not available in context');
  }

  const runtimeFeatures = {
    /**
     * TypeScriptトランスパイラ
     */
    transpiler: async (code: string, options: any = {}) => {
      const { filePath = 'unknown.ts' } = options;
      
      context.logger?.info(`Transpiling via extension: ${filePath}`);
      
      try {
        const result = await transpileManager.transpile(code, filePath);
        context.logger?.info(`Transpiled: ${filePath} (${code.length} -> ${result.length} bytes)`);
        return { code: result };
      } catch (error) {
        context.logger?.error(`Transpile failed for ${filePath}:`, error);
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

  context.logger?.info('TypeScript Runtime Extension activated');

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
