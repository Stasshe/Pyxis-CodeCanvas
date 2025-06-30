export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileItem[];
  path: string;
}

export interface Tab {
  id: string;
  name: string;
  content: string;
  isDirty: boolean;
  path: string;
}

export type MenuTab = 'files' | 'search' | 'git' | 'settings';
