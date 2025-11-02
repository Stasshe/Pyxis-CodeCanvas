/**
 * Pyxis TypeScript Runtime Extension
 * 
 * TypeScript/JSX/TSXファイルのトランスパイルをサポート
 * 
 * 処理フロー:
 * 1. normalizeCjsEsm で require/import/export を正規化
 * 2. Babel standalone で TypeScript → JavaScript
 * 3. Web Worker で非同期処理（メインスレッドをブロックしない）
 */

import * as Babel from '@babel/standalone';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types.js';

/**
 * トランスパイルオプション
 */
interface TranspileOptions {
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isJSX?: boolean;
}

/**
 * TypeScript/JSXコードをトランスパイル
 */
async function transpileTypeScript(options: TranspileOptions): Promise<{ code: string; map?: string }> {
  const { code, filePath, isTypeScript = true, isJSX = false } = options;
  const ext = filePath.split('.').pop() || 'js';

  try {
    // Babelプリセットとプラグインを構築
    const presets: [string, any][] = [];
    const plugins: any[] = [];

    // TypeScriptサポート
    if (isTypeScript) {
      presets.push([
        'typescript',
        {
          isTSX: isJSX || ext === 'tsx',
          allExtensions: true,
        },
      ]);
    }

    // Reactサポート
    if (isJSX || ext === 'jsx' || ext === 'tsx') {
      presets.push([
        'react',
        {
          runtime: 'automatic',
          development: false,
        },
      ]);
    }

    // トランスパイル実行
    const result = Babel.transform(code, {
      filename: filePath,
      presets,
      plugins,
      sourceMaps: false,
      sourceType: 'module',
      compact: false,
      retainLines: true,
    });

    if (!result || !result.code) {
      throw new Error('Babel transform returned empty code');
    }

    return {
      code: result.code,
      map: result.map ? JSON.stringify(result.map) : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`TypeScript transpile failed: ${errorMessage}`);
  }
}

/**
 * ファイルパスからトランスパイルが必要か判定
 */
function needsTranspile(filePath: string): boolean {
  return /\.(ts|tsx|mts|cts|jsx)$/.test(filePath);
}

/**
 * 拡張機能のアクティベーション
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('TypeScript Runtime Extension activating...');

  // Runtime機能として登録
  const runtimeFeatures = {
    /**
     * TypeScriptトランスパイラ
     */
    transpiler: async (code: string, options: any = {}) => {
      const { filePath = 'unknown.ts' } = options;
      
      if (!needsTranspile(filePath)) {
        // トランスパイル不要
        return { code };
      }

      context.logger.info(`Transpiling: ${filePath}`);

      const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(filePath);
      const isJSX = /\.(jsx|tsx)$/.test(filePath);

      const result = await transpileTypeScript({
        code,
        filePath,
        isTypeScript,
        isJSX,
      });

      context.logger.info(`Transpiled: ${filePath} (${code.length} -> ${result.code.length} bytes)`);

      return result;
    },

    /**
     * ファイル拡張子のサポート情報
     */
    supportedExtensions: ['.ts', '.tsx', '.mts', '.cts', '.jsx'],

    /**
     * トランスパイルが必要か判定
     */
    needsTranspile,
  };

  context.logger.info('TypeScript Runtime Extension activated');

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
