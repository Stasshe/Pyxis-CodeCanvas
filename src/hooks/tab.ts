// プロジェクトファイルが更新された時に開いているタブの内容も同期
import { useEffect } from 'react';
import type { Tab, Project, FileItem } from '@/types';

export function useProjectFilesSyncEffect({
  currentProject,
  projectFiles,
  tabs,
  setTabs,
  nodeRuntimeOperationInProgress
}: {
  currentProject: Project | null;
  projectFiles: FileItem[];
  tabs: Tab[];
  setTabs: (update: any) => void;
  nodeRuntimeOperationInProgress: boolean;
}) {
  useEffect(() => {
    // プロジェクトが変更されたときはタブ同期をスキップ
    if (!currentProject || tabs.length === 0) return;
    if (projectFiles.length > 0 && tabs.length > 0) {
      let hasRealChanges = false;
      const updatedTabs = tabs.map(tab => {
        const correspondingFile = projectFiles.find(f => f.path === tab.path);
        // ファイルが見つからない、または内容が同じ場合はスキップ
        if (!correspondingFile || correspondingFile.content === tab.content) {
          return tab;
        }
        // NodeRuntime操作中は強制的に更新、そうでなければisDirtyをチェック
        const shouldUpdate = nodeRuntimeOperationInProgress || !tab.isDirty;
        if (!shouldUpdate) {
          return tab;
        }
        hasRealChanges = true;
        return {
          ...tab,
          content: correspondingFile.content || '',
          isDirty: false // DBから同期したので汚れていない状態にリセット
        };
      });
      // 実際に内容が変更された場合のみ更新
      if (hasRealChanges) {
        setTabs(updatedTabs);
      }
    }
  }, [projectFiles, currentProject?.id, nodeRuntimeOperationInProgress]);
}
// src/hooks/pageEffects.ts
// page.tsx の長めのuseEffect（プロジェクト変更時のタブリセット）を分離


export function useProjectTabResetEffect({
  currentProject,
  setTabs,
  setActiveTabId
}: {
  currentProject: Project | null;
  setTabs: (update: any) => void;
  setActiveTabId: (id: string) => void;
}) {
  useEffect(() => {
    if (currentProject) {
      // プロジェクトが変更されたら全てのタブを閉じる
      setTabs([]);
      setActiveTabId('');
      // 少し遅延させてからウェルカムタブを作成
      setTimeout(() => {
        const welcomeTab: Tab = {
          id: 'welcome',
          name: 'Welcome',
          content: `# ${currentProject.name}\n\n${currentProject.description || ''}\n\nプロジェクトファイルはIndexedDBに保存されています。\n./${currentProject.name}/~$`,
          isDirty: false,
          path: '/'
        };
  setTabs([welcomeTab]);
  setActiveTabId('welcome');
      }, 50);
    } else {
      setTabs([]);
      setActiveTabId('');
    }
  }, [currentProject?.id]);
}
