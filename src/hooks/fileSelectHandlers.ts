// src/app/fileSelectHandlers.ts
// page.tsx の FileSelectModal 用ロジックを分離
import type { Tab, FileItem, Project, EditorPane } from '@/types';

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
      const updated = [...prev];
      const pane = updated[fileSelectState.paneIdx!];
      let fileToOpen = file;
      if (currentProject && projectFiles.length > 0) {
        const latestFile = projectFiles.find(f => f.path === file.path);
        if (latestFile) {
          fileToOpen = { ...file, content: latestFile.content };
        }
      }
      const existingTab = pane.tabs.find(t => t.path === fileToOpen.path);
      let newTabs;
      let newActiveTabId;
      if (existingTab) {
        newTabs = pane.tabs;
        newActiveTabId = existingTab.id;
      } else {
        const newTab: Tab = {
          id: `${fileToOpen.path}-${Date.now()}`,
          name: fileToOpen.name,
          content: fileToOpen.content || '',
          isDirty: false,
          path: fileToOpen.path,
          fullPath: fileToOpen.path // Corrected to fullPath
        };
        newTabs = [...pane.tabs, newTab];
        newActiveTabId = newTab.id;
      }
      updated[fileSelectState.paneIdx!] = {
        ...pane,
        tabs: newTabs,
        activeTabId: newActiveTabId
      };
      return updated;
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
      const updated = [...prev];
      const pane = updated[fileSelectState.paneIdx!];
      let fileToPreview = file;
      if (currentProject && projectFiles.length > 0) {
        const latestFile = projectFiles.find(f => f.path === file.path);
        if (latestFile) {
          fileToPreview = { ...file, content: latestFile.content };
        }
      }
      const previewTabId = `${fileToPreview.path}-preview`;
      const existingTab = pane.tabs.find(t => t.id === previewTabId);
      let newTabs;
      let newActiveTabId;
      if (existingTab) {
        newTabs = pane.tabs;
        newActiveTabId = existingTab.id;
      } else {
        const newTab: Tab = {
          id: previewTabId,
          name: fileToPreview.name,
          content: fileToPreview.content || '',
          isDirty: false,
          path: fileToPreview.path,
          preview: true,
          fullPath: fileToPreview.path // Corrected to fullPath
        };
        newTabs = [...pane.tabs, newTab];
        newActiveTabId = newTab.id;
      }
      updated[fileSelectState.paneIdx!] = {
        ...pane,
        tabs: newTabs,
        activeTabId: newActiveTabId
      };
      return updated;
    });
  }
}
