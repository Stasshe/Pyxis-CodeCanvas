import type { AIReviewEntry, AIReviewHistoryEntry } from '@/types/index';

export type {
  AIReviewTab,
  BaseTab,
  BinaryTab,
  DiffFileEntry,
  DiffTab,
  EditorPane,
  EditorTab,
  ExtensionInfoTab,
  ExtensionTab,
  MergeConflictTab,
  PaneLayoutType,
  PreviewTab,
  SettingsTab,
  Tab,
  TabKind,
  WebPreviewTab,
  WelcomeTab,
} from '@/types/tabs';

import type { DiffTab, EditorTab, PreviewTab, Tab, TabKind } from '@/types/tabs';

export type { MergeConflictFileEntry } from '@/engine/core/fs/git';

/**
 * タブを開くときのオプション
 */
export interface OpenTabOptions {
  kind?: TabKind;
  paneId?: string; // 指定されない場合はアクティブなペイン
  makeActive?: boolean; // デフォルトtrue
  jumpToLine?: number;
  jumpToColumn?: number;
  editorMode?: 'monaco' | 'codemirror';
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
  title?: string;
  path?: string;
  icon?: string;
  closable?: boolean;
  data?: Record<string, unknown>;
  content?: string;
  kind?: TabKind;
  isCodeMirror?: boolean;
  isBufferArray?: boolean;
  bufferContent?: ArrayBuffer;
  mimeType?: string;
  /** 拡張プロパティ - 各タブタイプ固有の追加データ */
  [key: string]: unknown;
}

/**
 * セッション復元コンテキスト
 * restoreContent で利用可能な情報
 */
export interface SessionRestoreContext {
  /** Open workspace root path. */
  rootPath: string;
  /**
   * ファイルをパスで取得する関数
   * Reads file content through the filesystem client.
   */
  getFileByPath: (
    path: string
  ) => Promise<{ content?: string; bufferContent?: ArrayBuffer; mimeType?: string } | null>;
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
  onClose?: (tab: Tab) => void | Promise<void>;
  /** Whether this tab has metadata or draft changes that must be persisted before closing. */
  hasPendingChanges?: (tab: Tab) => boolean;
  /** Persist pending metadata or draft changes before a destructive workspace operation. */
  flushPendingChanges?: (tab: Tab) => Promise<void>;
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
   * - File tabs are restored from the filesystem client.
   * - 自己完結型タブ（diff, ai等）はシリアライズされたデータから復元
   * - 未実装かつneedsContentRestore=trueの場合、デフォルトでファイルから復元を試みる
   * @param tab 復元対象のタブ
   * @param context Restore context with absolute filesystem paths.
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
/**
 * 型ガード: contentプロパティを持つタブ
 */
export function hasContent(tab: Tab): tab is EditorTab | PreviewTab {
  return tab.kind === 'editor' || tab.kind === 'preview';
}
