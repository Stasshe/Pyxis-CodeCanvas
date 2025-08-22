// src/app/fileSelectHandlers.ts
// page.tsx の FileSelectModal 用ロジックを分離
import type { Tab, FileItem, Project, EditorPane } from '@/types';
import { flattenPanes } from '@/hooks/pane';

// ヘルパー関数：ペインを再帰的に更新
function updatePaneRecursively(panes: EditorPane[], targetId: string, updates: Partial<EditorPane>): EditorPane[] {
  return panes.map(pane => {
    if (pane.id === targetId) {
      return { ...pane, ...updates };
    }
    
    if (pane.children && pane.children.length > 0) {
      return {
        ...pane,
        children: updatePaneRecursively(pane.children, targetId, updates)
      };
    }
    
    return pane;
  });
}

export function handleFileSelect({
  file,
  fileSelectState,
  currentProject,
  projectFiles,
  editors,
  setEditors
}: {
  file: FileItem;
  fileSelectState: { open: boolean, paneIdx: number | null };
  currentProject: Project | null;
  projectFiles: FileItem[];
  editors: EditorPane[];
  setEditors: (update: any) => void;
}) {
  if (fileSelectState.paneIdx !== null) {
    setEditors((prev: EditorPane[]) => {
      // フラット化してターゲットペインを特定
      const flatPanes = flattenPanes(prev);
      if (fileSelectState.paneIdx! < 0 || fileSelectState.paneIdx! >= flatPanes.length) {
        return prev;
      }
      
      const targetPane = flatPanes[fileSelectState.paneIdx!];
      let fileToOpen = file;
      if (currentProject && projectFiles.length > 0) {
        const latestFile = projectFiles.find(f => f.path === file.path);
        if (latestFile) {
          fileToOpen = { ...file, content: latestFile.content };
        }
      }
      
      // パスとIDの両方で既存タブをチェック
      const existingTab = targetPane.tabs.find(t => 
        t.path === fileToOpen.path || 
        t.id === `${targetPane.id}:${fileToOpen.path}`
      );
      let newTabs;
      let newActiveTabId;
      if (existingTab) {
        newTabs = targetPane.tabs;
        newActiveTabId = existingTab.id;
      } else {
        // タブIDの生成方法を統一: ペインID:ファイルパス
        const newTab: Tab = {
          id: `${targetPane.id}:${fileToOpen.path}`,
          name: fileToOpen.name,
          content: fileToOpen.content || '',
          isDirty: false,
          path: fileToOpen.path,
          fullPath: fileToOpen.path,
          isCodeMirror: fileToOpen.isCodeMirror ?? false
        };
        newTabs = [...targetPane.tabs, newTab];
        newActiveTabId = newTab.id;
      }
      
      // IDベースでペインを更新
      return updatePaneRecursively(prev, targetPane.id, {
        tabs: newTabs,
        activeTabId: newActiveTabId
      });
    });
  }
}

export function handleFilePreview({
  file,
  fileSelectState,
  currentProject,
  projectFiles,
  editors,
  setEditors
}: {
  file: FileItem;
  fileSelectState: { open: boolean, paneIdx: number | null };
  currentProject: Project | null;
  projectFiles: FileItem[];
  editors: EditorPane[];
  setEditors: (update: any) => void;
}) {
  if (fileSelectState.paneIdx !== null) {
    setEditors((prev: EditorPane[]) => {
      // フラット化してターゲットペインを特定
      const flatPanes = flattenPanes(prev);
      if (fileSelectState.paneIdx! < 0 || fileSelectState.paneIdx! >= flatPanes.length) {
        return prev;
      }
      
      const targetPane = flatPanes[fileSelectState.paneIdx!];
      let fileToPreview = file;
      if (currentProject && projectFiles.length > 0) {
        const latestFile = projectFiles.find(f => f.path === file.path);
        if (latestFile) {
          fileToPreview = { ...file, content: latestFile.content };
        }
      }
      
      const previewTabId = `${fileToPreview.path}-preview`;
      const existingTab = targetPane.tabs.find(t => t.id === previewTabId);
      let newTabs;
      let newActiveTabId;
      if (existingTab) {
        newTabs = targetPane.tabs;
        newActiveTabId = existingTab.id;
      } else {
        const newTab: Tab = {
          id: previewTabId,
          name: fileToPreview.name,
          content: fileToPreview.content || '',
          isDirty: false,
          path: fileToPreview.path,
          preview: true,
          fullPath: fileToPreview.path,
          isCodeMirror: fileToPreview.isCodeMirror ?? false,
          isBufferArray: fileToPreview.isBufferArray,
          bufferContent: fileToPreview.bufferContent
        };
        newTabs = [...targetPane.tabs, newTab];
        newActiveTabId = newTab.id;
      }
      
      // IDベースでペインを更新
      return updatePaneRecursively(prev, targetPane.id, {
        tabs: newTabs,
        activeTabId: newActiveTabId
      });
    });
  }
}