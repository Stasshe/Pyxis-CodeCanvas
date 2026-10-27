import type { MergeConflictFileEntry } from '@/engine/core/fs/git';
import type { ExtensionManifest } from './extensions';
import type { AIReviewEntry, AIReviewHistoryEntry } from './index';

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

export interface BaseTab {
  id: string;
  name: string;
  kind: TabKind;
  path: string;
  paneId: string;
  isDirty?: boolean;
  needsContentRestore?: boolean;
  icon?: string;
}

export interface ExtensionTab extends BaseTab {
  kind: `extension:${string}`;
  closable?: boolean;
  data?: Record<string, unknown>;
}

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

export interface PreviewTab extends BaseTab {
  kind: 'preview';
  content: string;
}

export interface WebPreviewTab extends BaseTab {
  kind: 'webPreview';
  url?: string;
}

export interface AIReviewTab extends BaseTab {
  kind: 'ai';
  originalContent: string;
  suggestedContent: string;
  filePath: string;
  aiEntry?: AIReviewEntry;
  history?: readonly AIReviewHistoryEntry[];
}

export interface DiffTab extends BaseTab {
  kind: 'diff';
  diffs: readonly DiffFileEntry[];
  editable?: boolean;
}

export interface DiffFileEntry {
  formerFullPath: string;
  formerCommitId: string;
  latterFullPath: string;
  latterCommitId: string;
  formerContent: string;
  latterContent: string;
}

export interface SettingsTab extends BaseTab {
  kind: 'settings';
  settingsType?: string;
}

export interface WelcomeTab extends BaseTab {
  kind: 'welcome';
}

export interface BinaryTab extends BaseTab {
  isSnapshot?: boolean;
  kind: 'binary';
  content: string;
  bufferContent?: ArrayBuffer;
  mimeType?: string;
  type?: string;
}

export interface ExtensionInfoTab extends BaseTab {
  kind: 'extension-info';
  manifest: ExtensionManifest;
  isEnabled: boolean;
}

export interface MergeConflictTab extends BaseTab {
  kind: 'merge-conflict';
  conflicts: readonly MergeConflictFileEntry[];
  oursBranch: string;
  theirsBranch: string;
  rootPath: string;
}

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
  | MergeConflictTab
  | ExtensionTab;

export type PaneLayoutType = 'vertical' | 'horizontal';

export interface EditorPane {
  id: string;
  tabs: readonly Tab[];
  activeTabId: string;
  layout?: PaneLayoutType;
  size?: number;
  children?: readonly EditorPane[];
  parentId?: string;
}
