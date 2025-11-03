/**
 * Extension System Types
 * 各拡張機能が必要とする共通の型定義
 */

import type { 
  SystemModuleName as _SystemModuleName, 
  SystemModuleMap as _SystemModuleMap 
} from './systemModuleTypes';

export type ExtensionType =
  | 'transpiler'
  | 'service'
  | 'builtin-module'
  | 'language-runtime'
  | 'tool'
  | 'ui';

/**
 * システムモジュール名（再エクスポート）
 */
export type SystemModuleName = _SystemModuleName;

/**
 * システムモジュールの型マップ（再エクスポート）
 */
export type SystemModuleMap = _SystemModuleMap;

export interface ExtensionContext {
  extensionId: string;
  extensionPath: string;
  version: string;
  logger?: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  /** 
   * システムモジュールへのアクセス（型安全）
   * @example
   * const fileRepo = await context.getSystemModule('fileRepository');
   * const storage = await context.getSystemModule('storageService');
   */
  getSystemModule?: <T extends SystemModuleName>(
    moduleName: T
  ) => Promise<SystemModuleMap[T]>;
  
  /** Tab API - 拡張機能が自分のタブを作成・管理 */
  tabs?: {
    registerTabType: (component: any) => void;
    createTab: (options: {
      title: string;
      icon?: string;
      closable?: boolean;
      activateAfterCreate?: boolean;
      paneId?: string;
      data?: any;
    }) => string;
    updateTab: (tabId: string, options: {
      title?: string;
      icon?: string;
      data?: any;
    }) => boolean;
    closeTab: (tabId: string) => boolean;
    onTabClose: (tabId: string, callback: (tabId: string) => void | Promise<void>) => void;
    getTabData: <T = any>(tabId: string) => T | null;
    openSystemTab: (file: any, options?: {
      kind?: string;
      jumpToLine?: number;
      jumpToColumn?: number;
      activateAfterOpen?: boolean;
    }) => void;
  };
  
  /** Sidebar API - 拡張機能がサイドバーパネルを追加 */
  sidebar?: {
    createPanel: (definition: {
      id: string;
      title: string;
      icon: string;
      component: any;
      order?: number;
    }) => void;
    updatePanel: (panelId: string, state: any) => void;
    removePanel: (panelId: string) => void;
    onPanelActivate: (panelId: string, callback: (panelId: string) => void | Promise<void>) => void;
  };
}

export interface ExtensionActivation {
  runtimeFeatures?: {
    transpiler?: (code: string, options?: any) => Promise<{ 
      code: string; 
      map?: string;
      dependencies?: string[];
    }>;
    supportedExtensions?: string[];
    needsTranspile?: (filePath: string) => boolean;
    builtInModules?: Record<string, unknown>;
  };
  services?: Record<string, unknown>;
  commands?: Record<string, (...args: any[]) => any>;
  dispose?: () => void;
}
