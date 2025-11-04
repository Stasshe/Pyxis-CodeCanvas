/**
 * Extension System Types
 * 各拡張機能が必要とする共通の型定義
 */

import type { 
  SystemModuleName as _SystemModuleName, 
  SystemModuleMap as _SystemModuleMap 
} from './systemModuleTypes';

/**
 * 拡張機能の種類
 */
export enum ExtensionType {
  /** ビルトインモジュール (fs, path等) */
  BUILTIN_MODULE = 'builtin-module',
  
  /** サービス拡張 (i18n, Git統合など) */
  SERVICE = 'service',
  
  /** トランスパイラ (TypeScript, JSX等) */
  TRANSPILER = 'transpiler',
  
  /** 言語ランタイム (Python, Rust等) */
  LANGUAGE_RUNTIME = 'language-runtime',
  
  /** ツール (linter, formatter等) */
  TOOL = 'tool',
  
  /** UI拡張 */
  UI = 'ui',
}

/**
 * システムモジュール名（再エクスポート）
 */
export type SystemModuleName = _SystemModuleName;

/**
 * システムモジュールの型マップ（再エクスポート）
 */
export type SystemModuleMap = _SystemModuleMap;

/**
 * 拡張機能の実行コンテキスト
 */
export interface ExtensionContext {
  /** 拡張機能のID */
  extensionId: string;

  /** 拡張機能のパス */
  extensionPath: string;

  /** バージョン */
  version: string;

  /** Logger API */
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  /** システムモジュールへのアクセス (型安全) */
  getSystemModule?: <T extends SystemModuleName>(
    moduleName: T
  ) => Promise<SystemModuleMap[T]>;

  /** 他の拡張機能との通信 (オプション) */
  messaging?: {
    send: (targetId: string, message: unknown) => Promise<unknown>;
    onMessage: (handler: (message: unknown) => unknown) => void;
  };

  /** Tab API - 拡張機能が自分のタブを作成・管理 */
  tabs?: {
    registerTabType: (component: any) => void;
    createTab: (options: any) => string;
    updateTab: (tabId: string, options: any) => boolean;
    closeTab: (tabId: string) => boolean;
    onTabClose: (tabId: string, callback: (tabId: string) => void | Promise<void>) => void;
    getTabData: <T = any>(tabId: string) => T | null;
    openSystemTab: (file: any, options?: any) => void;
  };

  /** Sidebar API - 拡張機能がサイドバーパネルを追加 */
  sidebar?: {
    createPanel: (definition: any) => void;
    updatePanel: (panelId: string, state: any) => void;
    removePanel: (panelId: string) => void;
    onPanelActivate: (panelId: string, callback: (panelId: string) => void | Promise<void>) => void;
  };

  /** Commands API - 拡張機能がターミナルコマンドを追加 */
  commands?: {
    registerCommand: (
      commandName: string,
      handler: (args: string[], context: any) => Promise<string>
    ) => () => void;
  };
}

/**
 * 拡張機能のアクティベーション結果
 */
export interface ExtensionActivation {
  /** ビルトインモジュールの実装 (builtin-moduleタイプの拡張機能のみ) */
  builtInModules?: Record<string, unknown>;

  /** Runtime機能の実装 (transpilerタイプの拡張機能のみ) */
  runtimeFeatures?: {
    /** TypeScript等のトランスパイラ */
    transpiler?: (code: string, options: unknown) => Promise<{ code: string }>;

    /** その他のRuntime拡張 */
    [key: string]: unknown;
  };

  /** サービスの実装 (serviceタイプの拡張機能のみ。現在は language-pack のみ使用) */
  services?: Record<string, unknown>;

  /** その他のAPI */
  [key: string]: unknown;
}
