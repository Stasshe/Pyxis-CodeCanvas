export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder' | 'symlink' | 'fifo' | 'characterDevice';
  content?: string;
  children?: FileItem[];
  path: string;
  isCodeMirror?: boolean;
  isBufferArray?: boolean; // バイナリファイルの場合true
  bufferContent?: ArrayBuffer; // バイナリデータ本体
  mimeType?: string;
  /** 拡張プロパティ許可（TabFileInfoとの互換性） */
  [key: string]: unknown;
}

export type { MergeConflictFileEntry } from '@/engine/core/fs/git';
export type {
  OpenTabOptions,
  TabComponentProps,
  TabFileInfo,
  TabTypeDefinition,
} from '@/engine/ide/tabs/types';
export type {
  AIReviewTab,
  DiffTab,
  EditorPane,
  EditorTab,
  MergeConflictTab,
  PaneLayoutType,
  PreviewTab,
  SettingsTab,
  Tab,
  TabKind,
  WebPreviewTab,
} from './tabs';

// Legacy: SingleFileDiff (still used in some places)
export interface SingleFileDiff {
  formerFullPath: string;
  formerCommitId: string;
  latterFullPath: string;
  latterCommitId: string;
  formerContent: string;
  latterContent: string;
}

// Legacy: EditorLayoutType alias
export type EditorLayoutType = 'vertical' | 'horizontal';

export interface Project {
  rootPath: string;
  name: string;
  updatedAt: Date;
}

export interface ProjectFile {
  path: string;
  type: 'file' | 'folder' | 'symlink' | 'fifo' | 'characterDevice';
  mode: number;
  size: number;
  mtime: number;
  mount?: 'memory' | 'devices';
}

export type MenuTab = 'files' | 'search' | 'git' | 'run' | 'extensions' | 'settings';

/** AI Review status */
export type AIReviewStatus = 'pending' | 'applied' | 'discarded' | 'reverted';

/** AI Review history entry */
export interface AIReviewHistoryEntry {
  id: string;
  timestamp: Date;
  content: string;
  note?: string;
}

/** AI Review entry (stored in IndexedDB) */
export interface AIReviewEntry {
  rootPath: string;
  filePath: string;
  suggestedContent: string;
  originalSnapshot: string;
  status: AIReviewStatus;
  comments?: string;
  parentMessageId?: string;
  history: readonly AIReviewHistoryEntry[];
  updatedAt: number;
}

// AI Agent関連の型定義
export interface AIMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  fileContext?: string[]; // 参照されたファイルパス
}

export interface AIEditRequest {
  files: Array<{
    path: string;
    content: string;
  }>;
  instruction: string;
}

export interface AIEditResponse {
  changedFiles: Array<{
    path: string;
    originalContent: string;
    suggestedContent: string;
    explanation: string;
    applied?: boolean; // Track if this change has been applied to file
    appliedContent?: string; // Exact bytes written, including user-edited review content and BOM
    isNewFile?: boolean; // Track if this is a new file created by AI (for revert: delete instead of restore empty)
  }>;
  message: string;
}

export interface AIFileContext {
  path: string;
  name: string;
  content: string;
  selected: boolean;
}

// チャットスペース関連の型定義
export interface ChatSpaceMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  parentMessageId?: string; // チャット上のブランチ元メッセージID
  action?: 'apply' | 'revert' | 'note'; // UI用アクションラベル
  mode: 'ask' | 'edit'; // メッセージが送信された時のモード
  fileContext?: string[]; // 参照されたファイルパス
  editResponse?: AIEditResponse; // 編集モードの場合のレスポンス
}

export interface ChatSpace {
  id: string;
  name: string;
  rootPath: string;
  messages: ChatSpaceMessage[];
  selectedFiles: string[]; // 選択されたファイルパスのリスト
  createdAt: Date;
  updatedAt: Date;
}
