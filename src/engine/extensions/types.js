/**
 * Pyxis Extension System - Type Definitions
 *
 * 拡張機能システムの型定義
 * - Extension Manifest: 拡張機能のメタデータ
 * - Installed Extension: インストール状態の管理
 * - Extension Loader: ロード・初期化のインターフェース
 * - Extension Context: 実行環境
 */
/**
 * 拡張機能の種類
 */
export var ExtensionType;
(function (ExtensionType) {
    /** ビルトインモジュール (fs, path等) */
    ExtensionType["BUILTIN_MODULE"] = "builtin-module";
    /** サービス拡張 (i18n, Git統合など) */
    ExtensionType["SERVICE"] = "service";
    /** トランスパイラ (TypeScript, JSX等) */
    ExtensionType["TRANSPILER"] = "transpiler";
    /** 言語ランタイム (Python, Rust等) */
    ExtensionType["LANGUAGE_RUNTIME"] = "language-runtime";
    /** ツール (linter, formatter等) */
    ExtensionType["TOOL"] = "tool";
    /** UI拡張 */
    ExtensionType["UI"] = "ui";
})(ExtensionType || (ExtensionType = {}));
/**
 * 拡張機能の状態
 */
export var ExtensionStatus;
(function (ExtensionStatus) {
    /** 利用可能（未インストール） */
    ExtensionStatus["AVAILABLE"] = "available";
    /** インストール中 */
    ExtensionStatus["INSTALLING"] = "installing";
    /** インストール済み（無効） */
    ExtensionStatus["INSTALLED"] = "installed";
    /** 有効化済み */
    ExtensionStatus["ENABLED"] = "enabled";
    /** エラー */
    ExtensionStatus["ERROR"] = "error";
    /** 更新中 */
    ExtensionStatus["UPDATING"] = "updating";
})(ExtensionStatus || (ExtensionStatus = {}));
