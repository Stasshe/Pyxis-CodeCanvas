// src/engine/tabs/types.ts
import { ReactNode } from 'react';

/**
 * タブの種類を表す型
 * 'editor' | 'preview' | 'webPreview' | 'ai' | 'diff' | 'settings' | string (拡張機能用)
 */
export type TabKind = 'editor' | 'preview' | 'webPreview' | 'ai' | 'diff' | 'settings' | string;

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
  | BinaryTab;

/**
 * タブを開くときのオプション
 */
export interface OpenTabOptions {
  kind?: TabKind;
  paneId?: string; // 指定されない場合はアクティブなペイン
  makeActive?: boolean; // デフォルトtrue
  jumpToLine?: number;
  jumpToColumn?: number;
  // kind別の追加オプション
  aiReviewProps?: {
    originalContent: string;
    suggestedContent: string;
    filePath: string;
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
