/**
 * [NEW ARCHITECTURE] Transpile Manager
 *
 * ## 役割
 * - 拡張機能システムと統合したトランスパイル管理
 * - トランスパイル機能は全て拡張機能から提供
 * - フォールバックなし: 拡張機能がなければエラー
 *
 * ## 設計方針
 * - 拡張機能のtranspilerを使用（TypeScript, JSX等）
 * - 拡張機能未インストールの場合は明確なエラーを返す
 * - メインスレッドをブロックしない
 */

import { runtimeInfo, runtimeWarn, runtimeError } from './runtimeLogger';
import type { TranspileResult } from './transpileWorker';
import { extensionManager } from '@/engine/extensions/extensionManager';

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
   * 拡張機能のtranspilerを使用。
   * 対応する拡張機能がない場合はエラーを投げる。
   */
  async transpile(options: TranspileOptions): Promise<TranspileResult> {
    const id = `transpile_${++this.requestId}_${Date.now()}`;
    
    // 有効な拡張機能を取得
    const activeExtensions = extensionManager.getActiveExtensions();
    
    // transpiler機能を持つ拡張機能を探す
    for (const ext of activeExtensions) {
      if (ext.activation.runtimeFeatures?.transpiler) {
        try {
          runtimeInfo(`🔌 Using extension transpiler: ${ext.manifest.id}`);
          
          const result = await ext.activation.runtimeFeatures.transpiler(options.code, {
            filePath: options.filePath,
            isTypeScript: options.isTypeScript,
            isJSX: options.isJSX,
          });
          
          return {
            id,
            code: result.code,
            sourceMap: (result as any).map,
            dependencies: this.extractDependencies(result.code),
          };
        } catch (error) {
          runtimeError(`❌ Extension transpiler failed: ${ext.manifest.id}`, error);
          throw error;
        }
      }
    }
    
    // 拡張機能が見つからない
    const errorMsg = `No transpiler extension found for ${options.filePath}. Please install TypeScript Runtime extension.`;
    runtimeError(errorMsg);
    throw new Error(errorMsg);
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
