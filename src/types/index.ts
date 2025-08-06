export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileItem[];
  path: string;
  isCodeMirror?: boolean;
}

export interface Tab {
  id: string;
  name: string;
  content: string;
  isDirty: boolean;
  path: string;
  fullPath: string;
  preview?: boolean;
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
  content: string;
  type: 'file' | 'folder';
  parentPath?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type MenuTab = 'files' | 'search' | 'git' | 'settings' | 'run';
