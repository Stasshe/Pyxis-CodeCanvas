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

export interface SingleFileDiff {
  formerFullPath: string;
  formerCommitId: string;
  latterFullPath: string;
  latterCommitId: string;
  formerContent: string;
  latterContent: string;
}

export interface Tab {
  id: string;
  name: string;
  content: string;
  isDirty: boolean;
  path: string;
  fullPath: string;
  preview?: boolean;
  isCodeMirror?: boolean;
  isBufferArray?: boolean; // バイナリファイルの場合true
  bufferContent?: ArrayBuffer; // バイナリデータ本体
  needsContentRestore?: boolean; // localStorage復元時のコンテンツ再取得が必要かどうか
  // Diffタブ用のprops（通常タブではundefined）
  diffProps?: {
    diffs: SingleFileDiff[];
  };
  // AIレビュータブ用のprops
  aiReviewProps?: {
    originalContent: string;
    suggestedContent: string;
    filePath: string;
  };
  webPreview?: boolean; // Added for WebPreviewTab
}

// VSCode風ウィンドウ分割用エディタペイン型
export type EditorLayoutType = 'vertical' | 'horizontal';

export interface EditorPane {
  id: string;
  tabs: Tab[];
  activeTabId: string;
}

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
}

export type MenuTab = 'files' | 'search' | 'git' | 'settings' | 'run';

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
  }>;
  message: string;
}

export interface AIFileContext {
  path: string;
  name: string;
  content: string;
  selected: boolean;
}
