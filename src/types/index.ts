export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileItem[];
  path: string;
  isCodeMirror?: boolean;
  isBufferArray?: boolean; // バイナリファイルの場合true
  bufferContent?: ArrayBuffer; // バイナリデータ本体
}

// Re-export new tab system types
export type {
  Tab,
  EditorTab,
  PreviewTab,
  WebPreviewTab,
  AIReviewTab,
  DiffTab,
  SettingsTab,
  TabKind,
  OpenTabOptions,
  TabComponentProps,
  TabTypeDefinition,
  PaneLayoutType,
  EditorPane,
} from '@/engine/tabs/types';

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
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  description?: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  name: string;
  content: string; // テキストファイル用
  type: 'file' | 'folder';
  parentPath?: string;
  createdAt: Date;
  updatedAt: Date;
  isBufferArray?: boolean; // バイナリファイルの場合true
  bufferContent?: ArrayBuffer; // バイナリデータ本体
  isAiAgentReview?: boolean; // AIエージェントによるレビュー中フラグ
  aiAgentCode?: string; // AIが提案するコード
  // AIレビュー用メタデータ
  aiReviewStatus?: string; // eg. 'pending' | 'applied' | 'discarded'
  aiReviewComments?: string; // 簡易コメント/説明
  aiAgentSuggestedContent?: string; // AIが提案した内容（最新）
  aiAgentOriginalSnapshot?: string; // AI提案時のオリジナルスナップショット
  aiReviewHistory?: Array<{
    id: string;
    timestamp: Date;
    content: string; // 保存されたスナップショット
    note?: string;
  }>;
}

export type MenuTab = 'files' | 'search' | 'git' | 'run' | 'extensions' | 'settings';

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
  projectId: string;
  messages: ChatSpaceMessage[];
  selectedFiles: string[]; // 選択されたファイルパスのリスト
  createdAt: Date;
  updatedAt: Date;
}
