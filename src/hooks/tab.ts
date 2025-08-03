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
    // currentProjectがnullの場合は処理をスキップ
    if (!currentProject) {
      console.log('[DEBUG] Skipping useProjectFilesSyncEffect: currentProject is null');
      return;
    }// tabsが空でもprojectFilesが存在する場合は同期を試みる
    if (projectFiles.length > 0) {
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
        console.log('[DEBUG] Updating tabs in useProjectFilesSyncEffect', updatedTabs);
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
  setActiveTabId,
  pane
}: {
  currentProject: Project | null;
  setTabs: (update: any) => void;
  setActiveTabId: (id: string) => void;
  pane: number;
}) {
  useEffect(() => {
    if (currentProject) {
      setTimeout(() => {
        setTabs((prevTabs: Tab[] | undefined) => {
          // 既存のタブがある場合は何もしない
          if (prevTabs && prevTabs.length > 0) {
            return prevTabs;
          }
          // paneが0以外ならWelcomeタブを生成しない
          if (pane !== 0) {
            return [];
          }
          // Welcomeタブを追加
          const welcomeTab: Tab = {
            id: 'welcome',
            name: 'Welcome',
            content: `# ${currentProject.name}\n\n${currentProject.description || ''}\n\nプロジェクトファイルはIndexedDBに保存されています。\n./${currentProject.name}/~$`,
            isDirty: false,
            path: '/'
          };
          return [welcomeTab];
        });
        // paneが0以外ならactiveTabIdも空に
        setActiveTabId('welcome');
      }, 50);
    } else {
      setTabs([]);
      setActiveTabId('');
    }
  }, [currentProject?.id, pane]);
}
