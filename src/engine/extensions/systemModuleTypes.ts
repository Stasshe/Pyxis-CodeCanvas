/**
 * System Module Type Definitions (Engine-Side)
 *
 * 拡張機能がアクセスできるシステムモジュールの型定義
 * getSystemModule の型推論を正確にするための型マップ
 *
 * NOTE: This file imports the actual implementation types to ensure
 * strict type safety within the engine code.
 */

import type { CommandRegistry } from './commandRegistry'

import type { GitCommands } from '@/engine/cmd/global/git'
import type { NpmCommands } from '@/engine/cmd/global/npm'
import type { UnixCommands } from '@/engine/cmd/global/unix'
import type { StreamShell } from '@/engine/cmd/shell/streamShell'
import type { FileRepository } from '@/engine/core/fileRepository'
import type { normalizeCjsEsm } from '@/engine/runtime/normalizeCjsEsm'
import type { toAppPath, getParentPath, toGitPath, fromGitPath } from '@/engine/core/pathResolver'

/**
 * normalizeCjsEsmモジュールの型定義
 * 実際の実装から型を抽出
 */
export type NormalizeCjsEsmModule = typeof normalizeCjsEsm

/**
 * pathUtilsモジュールの型定義
 */
export interface PathUtilsModule {
  normalizePath: typeof toAppPath
  toAppPath: typeof toAppPath
  getParentPath: typeof getParentPath
  toGitPath: typeof toGitPath
  fromGitPath: typeof fromGitPath
}

/**
 * システムモジュールの型マップ
 * この型を使用して getSystemModule の戻り値型を推論する
 */
export interface SystemModuleMap {
  fileRepository: FileRepository
  normalizeCjsEsm: NormalizeCjsEsmModule
  pathUtils: PathUtilsModule
  commandRegistry: CommandRegistry
  /** Terminal/CLI command singletons provider */
  systemBuiltinCommands: {
    getUnixCommands: (projectName: string, projectId?: string) => UnixCommands
    getGitCommands: (projectName: string, projectId?: string) => GitCommands
    getNpmCommands: (projectName: string, projectId?: string, projectPath?: string) => NpmCommands
    /**
     * Construct or return a per-project StreamShell instance.
     * Matches TerminalCommandRegistry.getShell which may return null on failure.
     */
    getShell: (
      projectName: string,
      projectId?: string,
      opts?: { unix?: any; commandRegistry?: any; fileRepository?: any }
    ) => Promise<StreamShell | null>
  }
}

/**
 * システムモジュール名の型
 */
export type SystemModuleName = keyof SystemModuleMap

/**
 * システムモジュールの型を取得
 */
export type SystemModuleType<T extends SystemModuleName> = SystemModuleMap[T]

/**
 * getSystemModule のヘルパー型
 */
export type GetSystemModule = <T extends SystemModuleName>(
  moduleName: T
) => Promise<SystemModuleMap[T]>
