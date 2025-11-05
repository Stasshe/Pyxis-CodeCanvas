/**
 * Pyxis Extension System - Type Definitions
 *
 * 拡張機能システムの型定義
 * - Extension Manifest: 拡張機能のメタデータ
 * - Installed Extension: インストール状態の管理
 * - Extension Loader: ロード・初期化のインターフェース
 * - Extension Context: 実行環境
 */

/* --------------------------------------------------------------------------
 * NOTICE (engine/internal)
 *
 * This file contains runtime/internal type definitions used by the engine
 * implementation under `src/`. These types are allowed to change more
 * frequently and are not intended to be imported by extension authors.
 *
 * If you are developing an extension, import types from
 * `extensions/_shared/types.ts` (the extension-facing, stable surface).
 * ------------------------------------------------------------------------- */

import type { SystemModuleMap, SystemModuleName } from './systemModuleTypes';
import type { TabAPI } from './system-api/TabAPI';

/**
 * グローバル型定義の拡張
 */
declare global {
  interface Window {
    __PYXIS_REACT__?: typeof import('react');
  }
}

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
 * 拡張機能の状態
 */
export enum ExtensionStatus {
  /** 利用可能（未インストール） */
  AVAILABLE = 'available',

  /** インストール中 */
  INSTALLING = 'installing',

  /** インストール済み（無効） */
  INSTALLED = 'installed',

  /** 有効化済み */
  ENABLED = 'enabled',

  /** エラー */
  ERROR = 'error',

  /** 更新中 */
  UPDATING = 'updating',
}

/**
 * 拡張機能のマニフェスト
 */
export interface ExtensionManifest {
  /** 拡張機能の一意なID (例: "pyxis.typescript-runtime") */
  id: string;

  /** 表示名 */
  name: string;

  /** バージョン (semver) */
  version: string;

  /** 種類 */
  type: ExtensionType;

  /** 説明 */
  description: string;

  /** 作者 */
  author: string;

  /** アイコンURL (オプション) */
  icon?: string;

  /** ホームページURL (オプション) */
  homepage?: string;

  /** 依存する他の拡張機能のID (オプション) */
  dependencies?: string[];

  /** エントリーポイント (相対パス) */
  entry: string;

  /** 追加で必要なファイル (オプション) */
  files?: string[];

  /** 同じグループで同時に1つのみ有効化を許可 (例: "lang-pack") */
  onlyOne?: string;

  /** パックグループ情報 (UIでグループ化表示する際に使用) */
  packGroup?: {
    /** グループID (例: "language-packs") */
    id: string;
    /** グループ名 (例: "Language Packs") */
    name: string;
  };

  /** メタデータ */
  metadata: {
    /** 公開日 */
    publishedAt: string;

    /** 更新日 */
    updatedAt: string;

    /** ダウンロード数 (オプション) */
    downloads?: number;

    /** タグ */
    tags?: string[];
  };
}

/**
 * インストール済み拡張機能の情報
 */
export interface InstalledExtension {
  /** マニフェスト */
  manifest: ExtensionManifest;

  /** 状態 */
  status: ExtensionStatus;

  /** インストール日時 */
  installedAt: number;

  /** 最終更新日時 */
  updatedAt: number;

  /** 有効化されているか */
  enabled: boolean;

  /** エラーメッセージ (エラー時) */
  error?: string;

  /** コードとファイルのキャッシュ */
  cache: {
    /** エントリーポイントのコード */
    entryCode: string;

    /** 追加ファイルのコード (ファイルパス -> コード) */
    // files can be string (JS/text/data URL) or Blob for binary assets
    files?: Record<string, string | Blob>;

    /** キャッシュ日時 */
    cachedAt: number;
  };
}

/**
 * 拡張機能のレジストリ情報 (public/extensions/registry.json)
 */
export interface ExtensionRegistry {
  /** レジストリのバージョン */
  version: string;

  /** 最終更新日時 */
  updatedAt: string;

  /** 利用可能な拡張機能のリスト */
  extensions: Array<{
    /** 拡張機能のID */
    id: string;

    /** マニフェストURL (相対パス) */
    manifestUrl: string;

    /** 種類 */
    type: ExtensionType;

    /** デフォルトで有効 (オプション) */
    defaultEnabled?: boolean;
  }>;
}

/**
 * 拡張機能の実行コンテキスト
 */
/**
 * Runtime ExtensionContext used by the engine when calling extensions.
 *
 * This type is derived from the extension-facing `ExtensionContext` but
 * replaces the lightweight `tabs` surface with the runtime `TabAPI` class
 * so engine implementors can pass the real API instance.
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
  getSystemModule?: <T extends SystemModuleName>(moduleName: T) => Promise<SystemModuleMap[T]>;

  /** 他の拡張機能との通信 (オプション) */
  messaging?: {
    send: (targetId: string, message: unknown) => Promise<unknown>;
    onMessage: (handler: (message: unknown) => unknown) => void;
  };

  /** Tab API - 拡張機能が自分のタブを作成・管理 */
  tabs?: TabAPI;

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
 * 拡張機能のエクスポート (エントリーポイントが返す型)
 */
export interface ExtensionExports {
  /** アクティベーション関数 (拡張が有効化された時に呼ばれる) */
  activate: (context: ExtensionContext) => Promise<ExtensionActivation>;

  /** デアクティベーション関数 (拡張が無効化された時に呼ばれる) */
  deactivate?: () => Promise<void>;
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
