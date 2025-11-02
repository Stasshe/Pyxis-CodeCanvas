/**
 * Extension System Types
 * 各拡張機能が必要とする共通の型定義
 */

export type ExtensionType =
  | 'transpiler'
  | 'service'
  | 'builtin-module'
  | 'language-runtime'
  | 'tool'
  | 'ui';

export interface ExtensionContext {
  extensionId: string;
  extensionPath: string;
  version: string;
  logger?: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  storage?: {
    get: <T>(key: string) => Promise<T | null>;
    set: <T>(key: string, value: T) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
  getSystemModule?: <T = any>(moduleName: string) => Promise<T>;
}

export interface ExtensionActivation {
  runtimeFeatures?: {
    transpiler?: (code: string, options?: any) => Promise<{ code: string; map?: string }>;
    supportedExtensions?: string[];
    needsTranspile?: (filePath: string) => boolean;
    builtInModules?: Record<string, unknown>;
  };
  services?: Record<string, unknown>;
  dispose?: () => void;
}
