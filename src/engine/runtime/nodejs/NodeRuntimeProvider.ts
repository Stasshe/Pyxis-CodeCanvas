/**
 * Node.js Runtime Provider
 *
 * ビルトインのNode.jsランタイムプロバイダー
 * - 既存のNodeRuntimeをラップ
 * - RuntimeProviderインターフェースを実装
 */

import { runtimeInfo } from '../core/runtimeLogger';
import { NodeRuntime } from './nodeRuntime';

import type {
  RuntimeExecutionOptions,
  RuntimeExecutionResult,
  RuntimeProvider,
} from '../core/RuntimeProvider';

export class NodeRuntimeProvider implements RuntimeProvider {
  readonly id = 'nodejs';
  readonly name = 'Node.js';
  readonly supportedExtensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];

  canExecute(filePath: string): boolean {
    return this.supportedExtensions.some(ext => filePath.endsWith(ext));
  }

  async initialize(projectId: string, projectName: string): Promise<void> {
    runtimeInfo(`🚀 Initializing Node.js runtime for project: ${projectName}`);
    // Node.jsランタイムは遅延初期化（execute時に作成）
  }

  async execute(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult> {
    const {
      projectId,
      projectName,
      filePath,
      argv = [],
      debugConsole,
      processStdin,
      terminalColumns,
      terminalRows,
    } = options;

    try {
      const runtime = new NodeRuntime({
        projectId,
        projectName,
        filePath,
        debugConsole,
        processStdin,
        terminalColumns,
        terminalRows,
      });

      // 実行
      await runtime.execute(filePath, argv);

      // イベントループの完了を待つ
      await runtime.waitForEventLoop();

      return {
        exitCode: runtime.getExitCode(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        stderr: errorMessage,
        exitCode: 1,
      };
    }
  }

  clearCache(): void {}

  async dispose(): Promise<void> {}

  isReady(): boolean {
    return true; // Node.jsランタイムは常に準備完了
  }
}
