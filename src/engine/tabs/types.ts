// src/engine/tabs/types.ts

import type { ExtensionManifest } from '@/engine/extensions/types';
import type { AIReviewEntry, AIReviewHistoryEntry, FileItem } from '@/types';

/**
 * タブの種類を表す型
 * 'editor' | 'preview' | 'webPreview' | 'ai' | 'diff' | 'settings' | string (拡張機能用)
 */
export type TabKind =
  | 'editor'
  | 'preview'
  | 'webPreview'
  | 'ai'
  | 'diff'
  | 'settings'
  | 'extension-info'
  | 'merge-conflict'
  | string;

/**
 * ベースとなるタブインターフェース
 */
export interface BaseTab {
  id: string;
  name: string;
  kind: TabKind;
  path: string;
  paneId: string; // どのペインに属するか
  isDirty?: boolean;
  icon?: string; // アイコン名（lucide-react等）
}

/**
 * エディタタブ
 */
export interface EditorTab extends BaseTab {
  kind: 'editor';
  content: string;
  isDirty: boolean;
  isCodeMirror?: boolean;
  isBufferArray?: boolean;
  bufferContent?: ArrayBuffer;
  jumpToLine?: number;
  jumpToColumn?: number;
}

/**
 * プレビュータブ（Markdown等）
 */
export interface PreviewTab extends BaseTab {
  kind: 'preview';
  content: string;
}

/**
 * Webプレビュータブ
 */
export interface WebPreviewTab extends BaseTab {
  kind: 'webPreview';
  url?: string;
  projectName?: string; // プロジェクト名を保存
}

/**
 * AIレビュータブ
 */
export interface AIReviewTab extends BaseTab {
  kind: 'ai';
  originalContent: string;
  suggestedContent: string;
  filePath: string;
  /** AIレビューエントリ (projectIdやoriginalSnapshotなどを含む) */
  aiEntry?: AIReviewEntry;
  /** 履歴 */
  history?: readonly AIReviewHistoryEntry[];
}

/**
 * Diffタブ
 */
export interface DiffTab extends BaseTab {
  kind: 'diff';
  diffs: readonly DiffFileEntry[];
  editable?: boolean;
}

/** 単一ファイルのDiff情報 */
export interface DiffFileEntry {
  formerFullPath: string;
  formerCommitId: string;
  latterFullPath: string;
  latterCommitId: string;
  formerContent: string;
  latterContent: string;
}

/**
 * 設定タブ
 */
export interface SettingsTab extends BaseTab {
  kind: 'settings';
  settingsType?: string; // 'shortcuts' | 'general' | etc
}

/**
 * ウェルカムタブ
 */
export interface WelcomeTab extends BaseTab {
  kind: 'welcome';
}

/**
 * バイナリタブ
 */
export interface BinaryTab extends BaseTab {
  kind: 'binary';
  content: string;
  bufferContent?: ArrayBuffer;
  type?: string;
}

/**
 * 拡張機能詳細タブ
 */
export interface ExtensionInfoTab extends BaseTab {
  kind: 'extension-info';
  manifest: ExtensionManifest;
  isEnabled: boolean;
}

/**
 * Merge conflict file entry
 */
export interface MergeConflictFileEntry {
  /** File path */
  filePath: string;
  /** Base (common ancestor) content */
  baseContent: string;
  /** OURS (current branch) content */
  oursContent: string;
  /** THEIRS (branch being merged) content */
  theirsContent: string;
  /** Resolved content (user edited) */
  resolvedContent: string;
  /** Whether the conflict is resolved */
  isResolved: boolean;
}

/**
 * Merge conflict resolution tab
 */
export interface MergeConflictTab extends BaseTab {
  kind: 'merge-conflict';
  /** List of conflicting files */
  conflicts: readonly MergeConflictFileEntry[];
  /** OURS branch name/commit ID */
  oursBranch: string;
  /** THEIRS branch name/commit ID */
  theirsBranch: string;
  /** Project ID */
  projectId: string;
  /** Project name */
  projectName: string;
}

/**
 * Union of all tab types
 */
export type Tab =
  | EditorTab
  | PreviewTab
  | WebPreviewTab
  | AIReviewTab
  | DiffTab
  | SettingsTab
  | WelcomeTab
  | BinaryTab
  | ExtensionInfoTab
  | MergeConflictTab;

/**
 * タブを開くときのオプション
 */
export interface OpenTabOptions {
  kind?: TabKind;
  paneId?: string; // 指定されない場合はアクティブなペイン
  makeActive?: boolean; // デフォルトtrue
  jumpToLine?: number;
  jumpToColumn?: number;
  // shouldReuseTabで全てのペインを検索するかどうか
  // ボトムパネルからの操作時にtrue（paneIndexが小さいペインを優先）
  searchAllPanesForReuse?: boolean;
  // kind別の追加オプション
  aiReviewProps?: {
    originalContent: string;
    suggestedContent: string;
    filePath: string;
    history?: readonly AIReviewHistoryEntry[];
    aiEntry?: AIReviewEntry;
  };
  diffProps?: {
    diffs: DiffTab['diffs'];
    editable?: boolean;
  };
  webPreviewUrl?: string;
  [key: string]: unknown; // 拡張機能用の追加プロパティを許可
}

/**
 * タブコンポーネントのProps
 */
export interface TabComponentProps {
  tab: Tab;
  isActive: boolean;
  onClose?: () => void;
  onMakeActive?: () => void;
}

/**
 * タブ作成用のファイル情報の基本型
 * FileItemと互換性があり、拡張プロパティを許可する
 */
export interface TabFileInfo {
  id?: string;
  name?: string;
  path?: string;
  content?: string;
  kind?: TabKind;
  isCodeMirror?: boolean;
  isBufferArray?: boolean;
  bufferContent?: ArrayBuffer;
  /** 拡張プロパティ - 各タブタイプ固有の追加データ */
  [key: string]: unknown;
}

/**
 * セッション復元コンテキスト
 * restoreContent で利用可能な情報
 */
export interface SessionRestoreContext {
  /** 現在のプロジェクトID */
  projectId?: string;
  /**
   * ファイルをパスで取得する関数
   * fileRepository.getFileByPath のラッパー
   */
  getFileByPath: (
    path: string
  ) => Promise<{ content?: string; bufferContent?: ArrayBuffer } | null>;
}

/**
 * タブタイプの定義
 */
export interface TabTypeDefinition {
  kind: TabKind;
  displayName: string;
  icon?: string;
  canEdit: boolean;
  canPreview: boolean;
  component: React.ComponentType<TabComponentProps>;
  createTab: (file: TabFileInfo, options?: OpenTabOptions) => Tab;
  shouldReuseTab?: (existingTab: Tab, newFile: TabFileInfo, options?: OpenTabOptions) => boolean;
  /**
   * コンテンツ更新メソッド - タブのコンテンツを更新して新しいタブオブジェクトを返す
   * 各タブタイプが自身のコンテンツ構造に応じて実装する
   * @param tab 更新対象のタブ
   * @param content 新しいコンテンツ
   * @param isDirty 変更フラグ
   * @returns 更新されたタブ（変更がない場合は元のタブを返す）
   */
  updateContent?: (tab: Tab, content: string, isDirty: boolean) => Tab;
  /**
   * 同期対象のファイルパスを取得
   * タブのコンテンツがファイルと同期する必要がある場合に実装
   * @param tab タブ
   * @returns ファイルパス、同期不要の場合はundefined
   */
  getContentPath?: (tab: Tab) => string | undefined;
  /**
   * セッション保存時にタブをシリアライズする
   * - コンテンツやバイナリなど、ファイルから復元可能なデータは除外すべき
   * - 復元に必要なメタデータ（diffs, suggestedContent等）は保持すべき
   * - 未実装の場合、デフォルト動作（content, bufferContent を除外）が適用される
   * @param tab シリアライズ対象のタブ
   * @returns シリアライズされたタブ（保存用）
   */
  serializeForSession?: (tab: Tab) => Tab;
  /**
   * セッション復元時にタブのコンテンツを復元する
   * - ファイルベースのタブはfileRepositoryから復元
   * - 自己完結型タブ（diff, ai等）はシリアライズされたデータから復元
   * - 未実装かつneedsContentRestore=trueの場合、デフォルトでファイルから復元を試みる
   * @param tab 復元対象のタブ
   * @param context 復元コンテキスト（projectFiles, fileRepository等）
   * @returns 復元されたタブ（needsContentRestore=falseに設定される）
   */
  restoreContent?: (tab: Tab, context: SessionRestoreContext) => Promise<Tab>;
  /**
   * このタブタイプがセッション復元を必要とするかどうか
   * - false: welcome, settings など復元不要なタブ
   * - true または未定義: 復元が必要（デフォルト）
   */
  needsSessionRestore?: boolean;
}

/**
 * ペインのレイアウト方向
 */
export type PaneLayoutType = 'vertical' | 'horizontal';

/**
 * エディタペイン
 */
export interface EditorPane {
  id: string;
  tabs: readonly Tab[];
  activeTabId: string;
  layout?: PaneLayoutType;
  size?: number;
  children?: readonly EditorPane[];
  parentId?: string;
}

/**
 * 型ガード: contentプロパティを持つタブ
 */
export function hasContent(tab: Tab): tab is EditorTab | PreviewTab {
  return tab.kind === 'editor' || tab.kind === 'preview';
}

/**
 * 型ガード: bufferContentプロパティを持つタブ
 */
export function hasBufferContent(tab: Tab): tab is EditorTab | BinaryTab {
  return (
    (tab.kind === 'editor' && 'bufferContent' in tab) ||
    (tab.kind === 'binary' && 'bufferContent' in tab)
  );
}

/**
 * 型ガード: jumpToLineプロパティを持つタブ
 */
export function hasJumpToLine(tab: Tab): tab is EditorTab {
  return tab.kind === 'editor';
}
