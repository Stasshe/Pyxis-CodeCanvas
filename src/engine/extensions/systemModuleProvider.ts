/**
 * System Module Provider
 * 
 * 拡張機能がシステムモジュールにアクセスするためのヘルパー
 * ExtensionManager内のgetSystemModule実装を再利用可能な形で提供
 */

import type { GetSystemModule, SystemModuleMap, SystemModuleName } from './systemModuleTypes';

/**
 * システムモジュールを取得する関数を作成
 * 
 * この関数は、ExtensionManagerと同じgetSystemModule実装を提供します。
 * unixHandler, streamShellなど、拡張コマンドを実行する必要があるモジュールで使用できます。
 */
export function createGetSystemModule(): GetSystemModule {
  return async <T extends SystemModuleName>(moduleName: T): Promise<SystemModuleMap[T]> => {
    switch (moduleName) {
      case 'fileRepository': {
        const { fileRepository } = await import('@/engine/core/fileRepository');
        return fileRepository as SystemModuleMap[T];
      }
      case 'normalizeCjsEsm': {
        const module = await import('@/engine/runtime/normalizeCjsEsm');
        return module as unknown as SystemModuleMap[T];
      }
      case 'pathUtils': {
        const { toAppPath, getParentPath, toGitPath, fromGitPath, normalizePath } =
          await import('@/engine/core/pathResolver');
        return {
          normalizePath,
          toAppPath,
          getParentPath,
          toGitPath,
          fromGitPath,
        } as SystemModuleMap[T];
      }
      case 'commandRegistry': {
        const { commandRegistry } = await import('./commandRegistry');
        return commandRegistry as SystemModuleMap[T];
      }
      case 'systemBuiltinCommands': {
        const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
        return terminalCommandRegistry as unknown as SystemModuleMap[T];
      }
      default: {
        const exhaustiveCheck: never = moduleName;
        throw new Error(`System module not found: ${String(moduleName)}`);
      }
    }
  };
}

/**
 * グローバルなgetSystemModuleインスタンス
 * 
 * シングルトンとして提供し、毎回インスタンスを作成する必要がないようにします。
 */
export const getSystemModule = createGetSystemModule();
