/**
 * Pyxis TypeScript Runtime Extension
 * 
 * TypeScript/JSX/TSXファイルのトランスパイルをサポート
 * Babel standaloneをCDN経由でロードして使用
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('TypeScript Runtime Extension activating...');

  // Babel standaloneをCDN経由で動的にロード
  let Babel: any;
  try {
    // グローバルにBabelが既に存在するかチェック
    if ((window as any).Babel) {
      Babel = (window as any).Babel;
      context.logger?.info('✅ Babel standalone already loaded');
    } else {
      // CDNからBabel standaloneをロード
      context.logger?.info('📦 Loading Babel standalone from CDN...');
      
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@babel/standalone@7.28.4/babel.min.js';
        script.onload = () => {
          if ((window as any).Babel) {
            Babel = (window as any).Babel;
            context.logger?.info('✅ Babel standalone loaded from CDN');
            resolve();
          } else {
            reject(new Error('Babel not found after script load'));
          }
        };
        script.onerror = () => {
          reject(new Error('Failed to load Babel from CDN'));
        };
        document.head.appendChild(script);
      });
    }
  } catch (error) {
    context.logger?.error('❌ Failed to load Babel standalone:', error);
    throw new Error('Failed to load Babel standalone');
  }

  // normalizeCjsEsmユーティリティを取得
  let normalizeCjsEsm: any;
  try {
    if (context.getSystemModule) {
      const module = await context.getSystemModule('normalizeCjsEsm');
      normalizeCjsEsm = (module as any).normalizeCjsEsm;
      context.logger?.info('✅ normalizeCjsEsm loaded');
    }
  } catch (error) {
    context.logger?.warn('⚠️ Failed to load normalizeCjsEsm, will skip normalization:', error);
    // フォールバック: 正規化なし
    normalizeCjsEsm = (code: string) => code;
  }

  /**
   * 依存関係を抽出
   */
  function extractDependencies(code: string): string[] {
    const dependencies = new Set<string>();

    // require('module') パターン
    const requireRegex = /require\s*\(\s*['"]([^'\"]+)['"]\s*\)/g;
    let match;
    while ((match = requireRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    // import 文
    const importRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'\"]+)['"]/g;
    while ((match = importRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    return Array.from(dependencies);
  }

  const runtimeFeatures = {
    /**
     * TypeScriptトランスパイラ（Babel standalone使用）
     */
    transpiler: async (code: string, options: any = {}) => {
      const { filePath = 'unknown.ts', isTypeScript, isJSX } = options;
      const ext = filePath.split('.').pop() || 'js';
      
      context.logger?.info(`🔄 Transpiling: ${filePath}`);
      
      try {
        let finalCode: string;
        let sourceMap: string | undefined;
        
        // TypeScriptまたはJSXの場合: Babel → normalizeCjsEsm
        if (isTypeScript || isJSX) {
          // ステップ1: Babelプリセットとプラグインを構築
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

          // ステップ2: BabelでTypeScript/JSXをトランスパイル
          const babelResult = Babel.transform(code, {
            filename: filePath,
            presets,
            plugins,
            sourceMaps: false,
            sourceType: 'module',
            compact: false,
            retainLines: true,
          });

          if (!babelResult || !babelResult.code) {
            throw new Error('Babel transform returned empty code');
          }

          // ステップ3: CJS/ESM正規化
          finalCode = normalizeCjsEsm(babelResult.code);
          sourceMap = babelResult.map ? JSON.stringify(babelResult.map) : undefined;
        } 
        // 普通のJSの場合: normalizeCjsEsmのみ
        else {
          // CJS/ESM正規化のみ実行
          finalCode = normalizeCjsEsm(code);
          sourceMap = undefined;
        }

        // 依存関係を抽出
        const dependencies = extractDependencies(finalCode);

        context.logger?.info(`✅ Transpiled: ${filePath} (${code.length} -> ${finalCode.length} bytes, ${dependencies.length} deps)`);
        
        return {
          code: finalCode,
          map: sourceMap,
          dependencies,
        };
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
