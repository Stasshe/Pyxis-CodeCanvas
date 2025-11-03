/**
 * [NEW ARCHITECTURE] Transpile Manager
 *
 * ## 役割
 * - normalizeCjsEsmによるCJS/ESM変換のみをサポート
 * - TypeScript/JSXのトランスパイルは拡張機能の責任
 *
 * ## 設計方針
 * - TypeScriptはビルトインで保証されていないため、ここではサポートしない
 * - CJS/ESM変換のみを行う（normalizeCjsEsm使用）
 * - moduleLoaderから使用される
 */

import { runtimeInfo, runtimeWarn, runtimeError } from './runtimeLogger';
import type { TranspileResult } from './transpileWorker';
import { normalizeCjsEsm } from './normalizeCjsEsm';

/**
 * トランスパイルオプション
 */
export interface TranspileOptions {
  code: string;
  filePath: string;
  isTypeScript?: boolean;
  isESModule?: boolean;
  isJSX?: boolean;
}

/**
 * Transpile Manager
 */
export class TranspileManager {
  private requestId = 0;

  /**
   * コードをトランスパイル
   * 
   * normalizeCjsEsmによるCJS/ESM変換のみを行う。
   * TypeScript/JSXのトランスパイルは拡張機能の責任。
   */
  async transpile(options: TranspileOptions): Promise<TranspileResult> {
    const id = `transpile_${++this.requestId}_${Date.now()}`;
    
    runtimeInfo('🔄 Normalizing CJS/ESM:', options.filePath);
    
    try {
      // normalizeCjsEsmでCJS/ESM変換
      const code = normalizeCjsEsm(options.code);
      
      // 依存関係を抽出
      const dependencies = this.extractDependencies(code);
      
      return {
        id,
        code,
        dependencies,
      };
    } catch (error) {
      runtimeError('❌ Transpile failed:', options.filePath, error);
      throw error;
    }
  }

  /**
   * コードから依存関係を抽出
   */
  private extractDependencies(code: string): string[] {
    const dependencies = new Set<string>();

    // require('module') パターン
    const requireRegex = /require\s*\(\s*['"]([^'\"]+)['"]\s*\)/g;
    let match;
    while ((match = requireRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    // import ... from 'module' パターン
    const importRegex = /import\s+.*?\s+from\s+['"]([^'\"]+)['"]/g;
    while ((match = importRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    // import('module') 動的インポート
    const dynamicImportRegex = /import\s*\(\s*['"]([^'\"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(code)) !== null) {
      dependencies.add(match[1]);
    }

    return Array.from(dependencies);
  }

  /**
   * ファイルパスから言語を判定
   */
  detectLanguage(filePath: string): {
    isTypeScript: boolean;
    isESModule: boolean;
    isJSX: boolean;
  } {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    return {
      isTypeScript: ['ts', 'tsx', 'mts', 'cts'].includes(ext),
      isESModule: ['mjs', 'mts', 'jsx', 'tsx'].includes(ext),
      isJSX: ['jsx', 'tsx'].includes(ext),
    };
  }

  /**
   * コードからES Moduleかどうかを判定
   */
  isESModule(code: string): boolean {
    // コメントと文字列を除外して判定
    const cleaned = code
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '');

    return /^\s*(import|export)\s+/m.test(cleaned);
  }
}

/**
 * シングルトンインスタンス
 */
export const transpileManager = new TranspileManager();
