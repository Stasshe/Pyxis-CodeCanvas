/**
 * Extension System Types (Extension-Facing)
 *
 * This file contains the stable, extension-facing types. It is intentionally
 * focused and minimal so extension authors have a clear import surface.
 * Internal/engine types live under `src/engine/...` and should not be
 * imported by extensions.
 *
 * 拡張機能開発者向けの型定義
 * エンジン側の実装と一致していますが、ファイルとしては完全に独立しています。
 */

/**
 * 拡張機能の種類
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

/**
 * システムモジュール関連の型定義
 * Re-export from systemModuleTypes for convenience
 */
import type { GetSystemModule } from './systemModuleTypes';
export type { SystemModuleName, SystemModuleMap } from './systemModuleTypes';

/**
 * 拡張機能用タブデータ
 * 拡張機能が定義する任意のデータ
 */
export interface ExtensionTabData {
  [key: string]: unknown;
}

/**
 * タブ作成オプション
 * Resource-local tab creation options used by extensions.
 */
export interface CreateTabOptions {
  /**
   * タブの一意識別子（オプション）
   * 指定すると同じIDのタブを再利用します
   * The stable resource identifier within the extension (eg. a note id).
   */
  id?: string;
  /** タブのタイトル */
  title: string;
  /** タブのアイコン（オプション・Lucide React icon name） */
  icon?: string;
  /** タブが閉じられるか（デフォルト: true） */
  closable?: boolean;
  /** 作成後にアクティブ化するか（デフォルト: true） */
  activateAfterCreate?: boolean;
  /** 開くペインID（オプション） */
  paneId?: string;
  /** 拡張機能固有のデータ */
  data?: ExtensionTabData;
}

/**
 * タブ更新オプション
 */
export interface UpdateTabOptions {
  /** 新しいタイトル */
  title?: string;
  /** 新しいアイコン */
  icon?: string;
  /** 拡張機能固有のデータ（部分更新） */
  data?: Partial<ExtensionTabData>;
}

/**
 * タブクローズコールバック
 */
export type TabCloseCallback = (tabId: string) => void | Promise<void>;

/**
 * Tabs API - 拡張機能がタブを管理
 * Minimal Tabs API exposed to extensions.
 */
export interface ExtensionTabsAPI {
  registerTabType: (component: any) => void;
  createTab: (options: CreateTabOptions) => string;
  updateTab: (tabId: string, options: UpdateTabOptions) => boolean;
  closeTab: (tabId: string) => boolean;
  onTabClose: (tabId: string, callback: TabCloseCallback) => void;
  getTabData: <T = ExtensionTabData>(tabId: string) => T | null;
  openSystemTab: (
    file: any,
    options?: {
      kind?: string;
      jumpToLine?: number;
      jumpToColumn?: number;
      activateAfterOpen?: boolean;
    }
  ) => void;
}

/**
 * サイドバーパネル定義
 */
export interface SidebarPanelDefinition {
  /** パネルID (拡張機能内で一意) */
  id: string;
  /** パネルタイトル */
  title: string;
  /** パネルアイコン (Lucide React icon name) */
  icon: string;
  /** パネルコンポーネント */
  component: React.ComponentType<any>;
  /** 初期状態 (オプション) */
  initialState?: any;
}

/**
 * Sidebar API - 拡張機能がサイドバーパネルを追加
 */
export interface ExtensionSidebarAPI {
  createPanel: (definition: SidebarPanelDefinition) => void;
  updatePanel: (panelId: string, state: any) => void;
  removePanel: (panelId: string) => void;
  onPanelActivate: (
    panelId: string,
    callback: (panelId: string) => void | Promise<void>
  ) => void;
}

/**
 * コマンド実行時のコンテキスト
 */
export interface CommandContext {
  /** プロジェクト名 */
  projectName: string;
  /** プロジェクトID */
  projectId: string;
  /** 現在のディレクトリ */
  currentDirectory: string;
  /** 拡張機能のコンテキスト全体（getSystemModule等も含む） */
  [key: string]: any;
}

/**
 * コマンドハンドラー
 */
/**
 * コマンドハンドラー
 * 実行時には ExtensionManager により `getSystemModule` を含む形で拡張されるため
 * handler が受け取る context には getSystemModule が存在します。
 */
export type CommandHandler = (
  args: string[],
  context: CommandContext & { getSystemModule: GetSystemModule }
) => Promise<string>;

/**
 * Commands API - 拡張機能がターミナルコマンドを追加
 */
export interface ExtensionCommandsAPI {
  registerCommand: (commandName: string, handler: CommandHandler) => () => void;
}

/**
 * 拡張機能の実行コンテキスト
 * The execution context passed to extension entrypoints (activate).
 * This is what extension authors should type their `context` parameter as.
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

  /**
   * システムモジュールへのアクセス (型安全)
   * Narrowed to only the system modules the runtime exposes.
   */
  // Use the shared GetSystemModule type to avoid repeating the module map/type logic.
  // This keeps the extension-facing API concise and aligned with the engine's types.
  getSystemModule: GetSystemModule;

  /** トランスパイラーを登録（transpiler拡張機能用） */
  registerTranspiler?: (config: {
    id: string;
    supportedExtensions: string[];
    needsTranspile?: (filePath: string) => boolean;
    transpile: (code: string, options: any) => Promise<{ code: string; map?: string; dependencies?: string[] }>;
  }) => Promise<void>;

  /** ランタイムを登録（language-runtime拡張機能用） */
  registerRuntime?: (config: {
    id: string;
    name: string;
    supportedExtensions: string[];
    canExecute: (filePath: string) => boolean;
    initialize?: (projectId: string, projectName: string) => Promise<void>;
    execute: (options: any) => Promise<any>;
    executeCode?: (code: string, options: any) => Promise<any>;
    clearCache?: () => void;
    dispose?: () => Promise<void>;
    isReady?: () => boolean;
  }) => Promise<void>;

  /** 他の拡張機能との通信 (オプション・未実装) */
  messaging?: {
    send: (targetId: string, message: unknown) => Promise<unknown>;
    onMessage: (handler: (message: unknown) => unknown) => void;
  };

  /** Tab API - extension-facing tabs API */
  tabs: ExtensionTabsAPI;

  /** Sidebar API */
  sidebar: ExtensionSidebarAPI;

  /** Commands API */
  commands: ExtensionCommandsAPI;
}

/**
 * 拡張機能のアクティベーション結果
 * Activation result returned by an extension's activate() function.
 */
export interface ExtensionActivation {
  /** ビルトインモジュールの実装 (builtin-moduleタイプの拡張機能のみ) */
  builtInModules?: Record<string, unknown>;

  /** Runtime機能の実装 (transpilerタイプの拡張機能のみ) */
  runtimeFeatures?: {
    transpiler?: (code: string, options: unknown) => Promise<{ code: string }>;
    [key: string]: unknown;
  };

  /** サービスの実装 (serviceタイプの拡張機能のみ) */
  services?: Record<string, unknown>;

  /** その他のAPI */
  [key: string]: unknown;
}

/**
 * 拡張機能のエクスポート
 * Extension entrypoint exports
 */
export interface ExtensionExports {
  activate: (context: ExtensionContext) => Promise<ExtensionActivation>;
  deactivate?: () => Promise<void>;
}
