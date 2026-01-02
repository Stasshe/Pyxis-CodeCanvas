// src/engine/tabs/types.ts

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
  // Optional AI review metadata (stored in aiStorageAdapter). Included so
  // that tabs can receive aiEntry/history from callers like AIPanel.
  aiEntry?: any;
  history?: any[];
}

/**
 * Diffタブ
 */
export interface DiffTab extends BaseTab {
  kind: 'diff';
  diffs: Array<{
    formerFullPath: string;
    formerCommitId: string;
    latterFullPath: string;
    latterCommitId: string;
    formerContent: string;
    latterContent: string;
  }>;
  editable?: boolean;
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
  manifest: any; // ExtensionManifest
  isEnabled: boolean;
}

/**
 * すべてのタブ型のユニオン
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
  | ExtensionInfoTab;

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
    // optional history and aiEntry payload passed when opening an AI review tab
    history?: any[];
    aiEntry?: any;
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
 * タブタイプの定義
 */
export interface TabTypeDefinition {
  kind: TabKind;
  displayName: string;
  icon?: string;
  canEdit: boolean;
  canPreview: boolean;
  component: React.ComponentType<TabComponentProps>;
  createTab: (file: any, options?: OpenTabOptions) => Tab;
  shouldReuseTab?: (existingTab: Tab, newFile: any, options?: OpenTabOptions) => boolean;
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
  tabs: Tab[];
  activeTabId: string;
  layout?: PaneLayoutType;
  size?: number;
  children?: EditorPane[];
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
