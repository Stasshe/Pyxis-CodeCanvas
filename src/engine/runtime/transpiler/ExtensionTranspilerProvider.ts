/**
 * Extension-based Transpiler Provider
 *
 * 拡張機能のトランスパイラーをTranspilerProviderインターフェースでラップ
 */

import type { TranspilerProvider } from '../core/RuntimeProvider';
import { runtimeError, runtimeInfo } from '../core/runtimeLogger';

/**
 * 拡張機能のトランスパイラーをラップ
 */
export class ExtensionTranspilerProvider implements TranspilerProvider {
  readonly id: string;
  readonly supportedExtensions: string[];

  private transpilerFn: (code: string, options: any) => Promise<any>;
  private needsTranspileFn?: (filePath: string) => boolean;

  constructor(
    id: string,
    supportedExtensions: string[],
    transpilerFn: (code: string, options: any) => Promise<any>,
    needsTranspileFn?: (filePath: string) => boolean
  ) {
    this.id = id;
    this.supportedExtensions = supportedExtensions;
    this.transpilerFn = transpilerFn;
    this.needsTranspileFn = needsTranspileFn;
  }

  needsTranspile(filePath: string, content?: string): boolean {
    if (this.needsTranspileFn) {
      return this.needsTranspileFn(filePath);
    }
    // デフォルト: サポートする拡張子の場合はトランスパイルが必要
    return this.supportedExtensions.some(ext => filePath.endsWith(ext));
  }

  async transpile(
    code: string,
    options: {
      filePath: string;
      isTypeScript?: boolean;
      isESModule?: boolean;
      isJSX?: boolean;
    }
  ): Promise<{
    code: string;
    map?: string;
    dependencies?: string[];
  }> {
    try {
      runtimeInfo(`🔄 Transpiling with ${this.id}: ${options.filePath}`);

      const result = await this.transpilerFn(code, options);

      runtimeInfo(`✅ Transpiled with ${this.id}: ${options.filePath}`);

      return {
        code: result.code,
        map: result.map,
        dependencies: result.dependencies || [],
      };
    } catch (error) {
      runtimeError(`❌ Transpile failed with ${this.id}:`, error);
      throw error;
    }
  }
}
