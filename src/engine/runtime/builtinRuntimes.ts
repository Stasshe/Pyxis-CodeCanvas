/**
 * Builtin Runtime Providers
 *
 * ビルトインランタイムプロバイダーの初期化
 * - Node.jsランタイムは常にビルトイン
 * - アプリケーション起動時に自動登録
 */

import { runtimeRegistry } from './RuntimeRegistry';
import { NodeRuntimeProvider } from './providers/NodeRuntimeProvider';
import { runtimeInfo } from './runtimeLogger';

/**
 * ビルトインランタイムプロバイダーを初期化・登録
 */
export function initializeBuiltinRuntimes(): void {
  runtimeInfo('🔧 Initializing builtin runtime providers...');

  // Node.jsランタイムプロバイダーを登録
  const nodeProvider = new NodeRuntimeProvider();
  runtimeRegistry.registerRuntime(nodeProvider);

  runtimeInfo('✅ Builtin runtime providers initialized');
}
