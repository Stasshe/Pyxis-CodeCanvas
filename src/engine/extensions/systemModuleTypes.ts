/**
 * System Module Type Definitions (Engine-Side)
 *
 * 拡張機能がアクセスできるシステムモジュールの型定義
 * getSystemModule の型推論を正確にするための型マップ
 *
 * NOTE: This file imports the actual implementation types to ensure
 * strict type safety within the engine code.
 */

import type { FileRepository } from '@/engine/core/fileRepository';
import type { CommandRegistry } from './commandRegistry';

/**
 * normalizeCjsEsmモジュールの型定義
 * 実際の実装から型を抽出
 */
export interface NormalizeCjsEsmModule {
  normalizeCjsEsm: (code: string) => string;
  extractImports: (code: string) => Array<{
    source: string;
    specifiers: Array<{
      type: 'default' | 'named' | 'namespace';
      imported?: string;
      local: string;
    }>;
  }>;
  extractExports: (code: string) => Array<{
    type: 'named' | 'default' | 'all';
    exported?: string;
    local?: string;
    source?: string;
  }>;
}

/**
 * システムモジュールの型マップ
 * この型を使用して getSystemModule の戻り値型を推論する
 */
export interface SystemModuleMap {
  fileRepository: FileRepository;
  normalizeCjsEsm: NormalizeCjsEsmModule;
  commandRegistry: CommandRegistry;
}

/**
 * システムモジュール名の型
 */
export type SystemModuleName = keyof SystemModuleMap;

/**
 * システムモジュールの型を取得
 */
export type SystemModuleType<T extends SystemModuleName> = SystemModuleMap[T];

/**
 * getSystemModule のヘルパー型
 */
export type GetSystemModule = <T extends SystemModuleName>(moduleName: T) => Promise<SystemModuleMap[T]>;
