/**
 * Builtin Runtime Providers
 *
 * ビルトインランタイムプロバイダーの初期化
 * - Node.jsランタイムは常にビルトイン
 * - アプリケーション起動時に自動登録
 */

import { NodeRuntimeProvider } from '../nodejs/NodeRuntimeProvider';
import { runtimeRegistry } from './RuntimeRegistry';
import { runtimeInfo } from './runtimeLogger';

/**
 * ビルトインランタイムプロバイダーを初期化・登録
 */
export function initializeBuiltinRuntimes(): void {
  if (runtimeRegistry.getRuntime('nodejs')) {
    return;
  }

  runtimeInfo('🔧 Initializing builtin runtime providers...');
  runtimeRegistry.registerRuntime(new NodeRuntimeProvider());
  runtimeInfo('✅ Builtin runtime providers initialized');
}
