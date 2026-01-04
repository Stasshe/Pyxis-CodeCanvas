/**
 * Runtime Registry
 *
 * ランタイムプロバイダーの登録・管理
 * - ビルトインランタイム（Node.js）の登録
 * - 拡張機能ランタイム（Python等）の動的登録
 * - ファイル拡張子に基づくランタイムの自動選択
 */

import { runtimeInfo, runtimeWarn } from './runtimeLogger';

import type { RuntimeProvider, TranspilerProvider } from './RuntimeProvider';

/**
 * RuntimeRegistry
 *
 * シングルトンパターンでランタイムプロバイダーを管理
 */
export class RuntimeRegistry {
  private static instance: RuntimeRegistry | null = null;

  private runtimeProviders: Map<string, RuntimeProvider> = new Map();
  private transpilerProviders: Map<string, TranspilerProvider> = new Map();
  private extensionToRuntime: Map<string, string> = new Map(); // .js -> "nodejs"
  private extensionToTranspiler: Map<string, string[]> = new Map(); // .ts -> ["typescript"]

  private constructor() {
    runtimeInfo('🔧 RuntimeRegistry initialized');
  }

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(): RuntimeRegistry {
    if (!RuntimeRegistry.instance) {
      RuntimeRegistry.instance = new RuntimeRegistry();
    }
    return RuntimeRegistry.instance;
  }

  /**
   * ランタイムプロバイダーを登録
   */
  registerRuntime(provider: RuntimeProvider): void {
    const id = provider.id;

    if (this.runtimeProviders.has(id)) {
      runtimeWarn(`⚠️ Runtime provider already registered: ${id}, replacing...`);
    }

    this.runtimeProviders.set(id, provider);

    // 拡張子とランタイムのマッピングを登録
    for (const ext of provider.supportedExtensions) {
      this.extensionToRuntime.set(ext, id);
    }

    runtimeInfo(
      `✅ Runtime provider registered: ${id} (${provider.supportedExtensions.join(', ')})`
    );
  }

  /**
   * トランスパイラープロバイダーを登録
   */
  registerTranspiler(provider: TranspilerProvider): void {
    const id = provider.id;

    if (this.transpilerProviders.has(id)) {
      runtimeWarn(`⚠️ Transpiler provider already registered: ${id}, replacing...`);
    }

    this.transpilerProviders.set(id, provider);

    // 拡張子とトランスパイラーのマッピングを登録
    for (const ext of provider.supportedExtensions) {
      if (!this.extensionToTranspiler.has(ext)) {
        this.extensionToTranspiler.set(ext, []);
      }
      this.extensionToTranspiler.get(ext)?.push(id);
    }

    runtimeInfo(
      `✅ Transpiler provider registered: ${id} (${provider.supportedExtensions.join(', ')})`
    );
  }

  /**
   * ランタイムプロバイダーを登録解除
   */
  unregisterRuntime(id: string): void {
    const provider = this.runtimeProviders.get(id);
    if (!provider) {
      runtimeWarn(`⚠️ Runtime provider not found: ${id}`);
      return;
    }

    // 拡張子マッピングを削除
    for (const ext of provider.supportedExtensions) {
      if (this.extensionToRuntime.get(ext) === id) {
        this.extensionToRuntime.delete(ext);
      }
    }

    this.runtimeProviders.delete(id);
    runtimeInfo(`🗑️ Runtime provider unregistered: ${id}`);
  }

  /**
   * トランスパイラープロバイダーを登録解除
   */
  unregisterTranspiler(id: string): void {
    const provider = this.transpilerProviders.get(id);
    if (!provider) {
      runtimeWarn(`⚠️ Transpiler provider not found: ${id}`);
      return;
    }

    // 拡張子マッピングを削除
    for (const ext of provider.supportedExtensions) {
      const transpilers = this.extensionToTranspiler.get(ext);
      if (transpilers) {
        const index = transpilers.indexOf(id);
        if (index > -1) {
          transpilers.splice(index, 1);
        }
        if (transpilers.length === 0) {
          this.extensionToTranspiler.delete(ext);
        }
      }
    }

    this.transpilerProviders.delete(id);
    runtimeInfo(`🗑️ Transpiler provider unregistered: ${id}`);
  }

  /**
   * ファイルパスに基づいてランタイムプロバイダーを取得
   */
  getRuntimeForFile(filePath: string): RuntimeProvider | null {
    // 拡張子を取得
    const ext = this.getExtension(filePath);
    if (!ext) {
      return null;
    }

    // 拡張子に対応するランタイムIDを取得
    const runtimeId = this.extensionToRuntime.get(ext);
    if (!runtimeId) {
      return null;
    }

    // ランタイムプロバイダーを取得
    return this.runtimeProviders.get(runtimeId) || null;
  }

  /**
   * IDでランタイムプロバイダーを取得
   */
  getRuntime(id: string): RuntimeProvider | null {
    return this.runtimeProviders.get(id) || null;
  }

  /**
   * ファイルパスに基づいてトランスパイラープロバイダーを取得
   */
  getTranspilerForFile(filePath: string): TranspilerProvider | null {
    const ext = this.getExtension(filePath);
    if (!ext) {
      return null;
    }

    const transpilerIds = this.extensionToTranspiler.get(ext);
    if (!transpilerIds || transpilerIds.length === 0) {
      return null;
    }

    // 最初に登録されたトランスパイラーを返す（優先順位）
    const transpilerId = transpilerIds[0];
    return this.transpilerProviders.get(transpilerId) || null;
  }

  /**
   * IDでトランスパイラープロバイダーを取得
   */
  getTranspiler(id: string): TranspilerProvider | null {
    return this.transpilerProviders.get(id) || null;
  }

  /**
   * 登録されているすべてのランタイムプロバイダーを取得
   */
  getAllRuntimes(): RuntimeProvider[] {
    return Array.from(this.runtimeProviders.values());
  }

  /**
   * 登録されているすべてのトランスパイラープロバイダーを取得
   */
  getAllTranspilers(): TranspilerProvider[] {
    return Array.from(this.transpilerProviders.values());
  }

  /**
   * ファイルの拡張子を取得
   */
  private getExtension(filePath: string): string | null {
    const match = filePath.match(/(\.[^.]+)$/);
    return match ? match[1] : null;
  }

  /**
   * すべてのプロバイダーをクリア（テスト用）
   */
  clear(): void {
    this.runtimeProviders.clear();
    this.transpilerProviders.clear();
    this.extensionToRuntime.clear();
    this.extensionToTranspiler.clear();
    runtimeInfo('🗑️ RuntimeRegistry cleared');
  }
}

/**
 * シングルトンインスタンスをエクスポート
 */
export const runtimeRegistry = RuntimeRegistry.getInstance();
