/**
 * Extension System Types (extension-facing)
 *
 * This file contains the stable, extension-facing types. It is intentionally
 * focused and minimal so extension authors have a clear import surface.
 * Internal/engine types live under `src/engine/...` and should not be
 * imported by extensions.
 */

import type {
  SystemModuleName as _SystemModuleName,
  SystemModuleMap as _SystemModuleMap,
} from './systemModuleTypes';

/**
 * Extension categories; stable values consumed by extension manifests.
 */
export enum ExtensionType {
  BUILTIN_MODULE = 'builtin-module',
  SERVICE = 'service',
  TRANSPILER = 'transpiler',
  LANGUAGE_RUNTIME = 'language-runtime',
  TOOL = 'tool',
  UI = 'ui',
}

/** Re-export system module names and map for convenience in extensions */
export type SystemModuleName = _SystemModuleName;
export type SystemModuleMap = _SystemModuleMap;

/**
 * Resource-local tab creation options used by extensions.
 * - `id` is the stable resource identifier within the extension (eg. a note id).
 * - The runtime composes the final global tab id as `${kind}:${path}` where
 *   `kind` is the tab kind (for extensions: `extension:<extensionId>`) and
 *   `path` is this `id` (or provided path string).
 *
 * Note: Use stable unique IDs (UUID) for resources when the same resource
 * should always map to the same tab.
 */
export interface ExtensionCreateTabOptions {
  id?: string;
  title: string;
  icon?: string;
  closable?: boolean;
  activateAfterCreate?: boolean;
  paneId?: string;
  data?: any; // extension-controlled arbitrary data
}

/**
 * Minimal Tabs API exposed to extensions. Keep `data` as `any` to allow
 * extensions to store arbitrary payloads.
 */
export interface ExtensionTabsAPI {
  registerTabType: (component: any) => void;
  createTab: (options: ExtensionCreateTabOptions) => string;
  updateTab: (tabId: string, options: { title?: string; icon?: string; data?: any }) => boolean;
  closeTab: (tabId: string) => boolean;
  onTabClose: (tabId: string, callback: (tabId: string) => void | Promise<void>) => void;
  getTabData: <T = any>(tabId: string) => T | null;
  openSystemTab: (file: any, options?: any) => void;
}

/**
 * The execution context passed to extension entrypoints (activate).
 * This is what extension authors should type their `context` parameter as.
 */
export interface ExtensionContext {
  extensionId: string;
  extensionPath: string;
  version: string;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  getSystemModule?: <T extends SystemModuleName>(moduleName: T) => Promise<SystemModuleMap[T]>;
  messaging?: { send: (targetId: string, message: unknown) => Promise<unknown>; onMessage: (handler: (message: unknown) => unknown) => void };
  // extension-facing tabs API
  tabs?: ExtensionTabsAPI;
  sidebar?: { createPanel: (definition: any) => void; updatePanel: (panelId: string, state: any) => void; removePanel: (panelId: string) => void; onPanelActivate: (panelId: string, callback: (panelId: string) => void | Promise<void>) => void };
  commands?: { registerCommand: (commandName: string, handler: (args: string[], context: any) => Promise<string>) => () => void };
}

/**
 * Activation result returned by an extension's activate() function.
 */
export interface ExtensionActivation {
  builtInModules?: Record<string, unknown>;
  runtimeFeatures?: { transpiler?: (code: string, options: unknown) => Promise<{ code: string }>; [key: string]: unknown };
  services?: Record<string, unknown>;
  [key: string]: unknown;
}