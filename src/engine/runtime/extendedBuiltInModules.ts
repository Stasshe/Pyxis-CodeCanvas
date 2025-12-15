/**
 * Extension-aware Built-in Modules Provider
 * 拡張機能システムと統合したビルトインモジュールのプロバイダー
 */

import { extensionManager } from '@/engine/extensions/extensionManager'
import { type BuiltInModules, createBuiltInModules } from '@/engine/node/builtInModule'

export interface ExtendedBuiltInModulesOptions {
  projectDir: string
  projectId: string
  projectName: string
  onInput?: (prompt: string, callback: (input: string) => void) => void
}

/**
 * 拡張機能システムと統合したビルトインモジュールを作成
 *
 * - 既存のビルトインモジュール（fs, path等）
 * - 拡張機能が提供するビルトインモジュール
 *
 * を統合して返す
 */
export async function createExtendedBuiltInModules(
  options: ExtendedBuiltInModulesOptions
): Promise<BuiltInModules> {
  // 既存のビルトインモジュールを取得
  const coreModules = createBuiltInModules(options)

  // 拡張機能からのビルトインモジュールを取得
  const extensionModules = extensionManager.getAllBuiltInModules()

  // マージして返す（拡張機能が優先）
  return {
    ...coreModules,
    ...extensionModules,
  }
}

/**
 * 特定のビルトインモジュールを解決
 *
 * 1. 拡張機能から提供されているかチェック
 * 2. なければコアモジュールから取得
 */
export async function resolveBuiltInModule(
  moduleName: string,
  coreModules: BuiltInModules
): Promise<unknown | null> {
  // 拡張機能から探す
  const extensionModules = extensionManager.getAllBuiltInModules()
  if (extensionModules[moduleName]) {
    return extensionModules[moduleName]
  }

  // コアモジュールから探す
  const builtIns: Record<string, unknown> = {
    fs: coreModules.fs,
    'fs/promises': coreModules.fs,
    path: coreModules.path,
    os: coreModules.os,
    util: coreModules.util,
    http: coreModules.http,
    https: coreModules.https,
    buffer: { Buffer: coreModules.Buffer },
    readline: coreModules.readline,
  }

  return builtIns[moduleName] || null
}
