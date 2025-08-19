// プロジェクトファイルが更新された時に開いているタブの内容も同期
import { useEffect } from 'react';
import type { Tab, Project, FileItem } from '@/types';

// FileItem[]を平坦化する関数
function flattenFileItems(items: FileItem[]): FileItem[] {
  const result: FileItem[] = [];
  
  function traverse(items: FileItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children && item.children.length > 0) {
        traverse(item.children);
      }
    }
  }
  
  traverse(items);
  return result;
}

export function useProjectFilesSyncEffect({
  currentProject,
  projectFiles,
  tabs,
  setTabs,
  nodeRuntimeOperationInProgress,
  externalOperationInProgress,
  isRestoredFromLocalStorage
}: {
  currentProject: Project | null;
  projectFiles: FileItem[];
  tabs: Tab[];
  setTabs: (update: any) => void;
  nodeRuntimeOperationInProgress: boolean;
  externalOperationInProgress: boolean;
  isRestoredFromLocalStorage: boolean;
}) {
  useEffect(() => {
    // localStorage復元が完了していない場合は処理をスキップ
    if (!isRestoredFromLocalStorage) {
      console.log('[DEBUG] Skipping useProjectFilesSyncEffect: localStorage restoration not complete');
      return;
    }
    
    // currentProjectがnullの場合は処理をスキップ
    if (!currentProject) {
      console.log('[DEBUG] Skipping useProjectFilesSyncEffect: currentProject is null');
      return;
    }
    
  // プロジェクトファイルを平坦化
  const flattenedFiles = flattenFileItems(projectFiles);
  // デバッグ: 全ファイルパス一覧
  console.log('[DEBUG] ProjectFiles paths:', flattenedFiles.map(f => f.path));
  // デバッグ: 全タブパス一覧
  console.log('[DEBUG] Tabs paths:', tabs.map(t => t.path));
    //console.log('[DEBUG] Flattened project files:', flattenedFiles.map(f => ({ path: f.path, contentLength: f.content?.length || 0 })));
    
    // タブにneedsContentRestoreフラグがあるかチェック
    const tabsNeedingRestore = tabs.filter(tab => tab.needsContentRestore);
    if (tabsNeedingRestore.length > 0) {
      console.log('[DEBUG] Tabs needing content restore:', tabsNeedingRestore.map(t => ({ path: t.path, id: t.id })));
    }
    
    // tabsが空でもprojectFilesが存在する場合は同期を試みる
    if (flattenedFiles.length > 0) {
      let hasRealChanges = false;
      const updatedTabs = tabs
        .filter(tab => tab.content !== null) // contentがnullのタブを閉じる
        .map(tab => {
          const correspondingFile = flattenedFiles.find(f => f.path === tab.path);
          if (!correspondingFile) {
            if (tab.needsContentRestore) {
              console.log('[DEBUG] No corresponding file found for tab needing restore:', tab.path);
              // 追加: どのファイルパスと一致しないか詳細表示
              flattenedFiles.forEach(f => {
                console.log(`[DEBUG] Compare: tab.path="${tab.path}" vs file.path="${f.path}" =>`, tab.path === f.path);
              });
            }
            return tab;
          }

          // localStorage復元後のコンテンツ復元が必要な場合
          if (tab.needsContentRestore) {
            hasRealChanges = true;
            console.log('[DEBUG] Restoring content from DB for tab:', tab.path, 'fileContent:', correspondingFile.content?.slice(0, 50) + '...');
            
            if (tab.isBufferArray && correspondingFile.isBufferArray) {
              return {
                ...tab,
                content: correspondingFile.content || '',
                bufferContent: correspondingFile.bufferContent,
                isDirty: false,
                needsContentRestore: false, // 復元完了
              };
            } else {
              return {
                ...tab,
                content: correspondingFile.content || '',
                bufferContent: undefined,
                isDirty: false,
                needsContentRestore: false, // 復元完了
              };
            }
          }
          
          // バイナリファイルの場合はbufferContentを同期
          if (tab.isBufferArray && correspondingFile.isBufferArray) {
            const newBuf = correspondingFile.bufferContent;
            const oldBuf = tab.bufferContent;
            // バッファ長が異なる、または未設定の場合にのみ更新
            if (!oldBuf || (newBuf && oldBuf.byteLength !== newBuf.byteLength)) {
              hasRealChanges = true;
              return {
                ...tab,
                bufferContent: correspondingFile.bufferContent,
                content: correspondingFile.content,
                isDirty: false
              };
            }
            return tab;
          }
          // テキストファイルはcontentで比較
          if (correspondingFile.content === tab.content) {
            return tab;
          }
          
          // ユーザーの最近の変更チェック（0.5秒以内）
          const hasRecentUserChange = tab.userChangeTimestamp && 
            (Date.now() - tab.userChangeTimestamp < 500);
          
          // NodeRuntime操作中や外部操作中は強制的に更新、そうでなければisDirtyと最近のユーザー変更をチェック
          const shouldUpdate = nodeRuntimeOperationInProgress || externalOperationInProgress || (!tab.isDirty && !hasRecentUserChange);
          if (!shouldUpdate) {
            console.log('[DEBUG] Skipping tab sync due to user protection:', {
              tabPath: tab.path,
              isDirty: tab.isDirty,
              hasRecentUserChange,
              nodeRuntimeOperationInProgress,
              externalOperationInProgress
            });
            return tab;
          }
          hasRealChanges = true;
          return {
            ...tab,
            content: correspondingFile.content,
            isDirty: false, // DBから同期したので汚れていない状態にリセット
            userChangeTimestamp: undefined // 外部同期時はユーザー変更タイムスタンプをクリア
          };
        });
      // 実際に内容が変更された場合のみ更新
      if (hasRealChanges) {
        console.log('[DEBUG] Updating tabs in useProjectFilesSyncEffect', updatedTabs.map(t => ({ id: t.id, path: t.path, needsContentRestore: t.needsContentRestore, contentLength: t.content?.length || 0 })));
        setTabs(updatedTabs);
      }
    }
  }, [projectFiles, currentProject?.id, nodeRuntimeOperationInProgress, externalOperationInProgress, isRestoredFromLocalStorage]);

  // 追加：プロジェクトファイルが初回読み込まれた時に、コンテンツ復元を強制実行
  useEffect(() => {
    if (!isRestoredFromLocalStorage || !currentProject || projectFiles.length === 0) {
      return;
    }

    const tabsNeedingRestore = tabs.filter(tab => tab.needsContentRestore);
    if (tabsNeedingRestore.length > 0) {
      console.log('[DEBUG] Force restoring content for tabs after project load');
      
      // プロジェクトファイルを平坦化
      const flattenedFiles = flattenFileItems(projectFiles);
      
      const updatedTabs = tabs
        .filter(tab => tab.content !== null) // contentがnullのタブを閉じる
        .map(tab => {
          if (!tab.needsContentRestore) return tab;
          
          const correspondingFile = flattenedFiles.find(f => f.path === tab.path);
          if (!correspondingFile) {
            console.log('[DEBUG] No file found for force restore:', tab.path);
            return tab;
          }
          
          console.log('[DEBUG] Force restoring:', tab.path, 'content length:', correspondingFile.content?.length || 0);
          return {
            ...tab,
            content: correspondingFile.content || '',
            bufferContent: tab.isBufferArray ? correspondingFile.bufferContent : undefined,
            isDirty: false,
            needsContentRestore: false,
          };
        });
      
      setTabs(updatedTabs);
    }
  }, [currentProject?.id, projectFiles.length, isRestoredFromLocalStorage]);
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
            path: '/',
            fullPath: ''
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

// タブアクティブ時のコンテンツ復元フック（全ペイン対応）
export function useActiveTabContentRestore({
  editors,
  projectFiles,
  setEditors,
  isRestoredFromLocalStorage
}: {
  editors: any[]; // EditorPane[]
  projectFiles: FileItem[];
  setEditors: (update: any) => void;
  isRestoredFromLocalStorage: boolean;
}) {
  useEffect(() => {
    // localStorage復元が完了していない、またはエディタがない場合はスキップ
    if (!isRestoredFromLocalStorage || !editors.length) {
      return;
    }

    // 全ペインのアクティブタブでneedsContentRestoreが必要なものを探す
    const needsRestore = editors.some(editor => {
      if (!editor.activeTabId) return false;
      const activeTab = editor.tabs.find((tab: any) => tab.id === editor.activeTabId);
      return activeTab?.needsContentRestore;
    });

    if (needsRestore) {
      console.log('[DEBUG] Some active tabs need content restore');
      
      // プロジェクトファイルを平坦化
      const flattenedFiles = flattenFileItems(projectFiles);
      
      setEditors((prevEditors: any[]) => {
        return prevEditors.map(editor => {
          if (!editor.activeTabId) return editor;
          const activeTab = editor.tabs.find((tab: any) => tab.id === editor.activeTabId);
          if (!activeTab?.needsContentRestore) return editor;
          const correspondingFile = flattenedFiles.find(f => f.path === activeTab.path);
          if (!correspondingFile) {
            // ...existing code...
            return editor;
          }
          // タブIDをeditor.id + ':' + tab.pathでユニーク化
          return {
            ...editor,
            tabs: editor.tabs.map((tab: any) => {
              if (tab.id !== activeTab.id) return tab;
              const newTabId = tab.id === 'welcome' ? tab.id : `${editor.id}:${tab.path}`;
              return {
                ...tab,
                id: newTabId,
                content: correspondingFile.content || '',
                bufferContent: tab.isBufferArray ? correspondingFile.bufferContent : undefined,
                isDirty: false,
                needsContentRestore: false, // 復元完了
              };
            })
          };
        });
      });
    }
  }, [
    // 全ペインのアクティブタブIDを監視
    editors.map(editor => editor.activeTabId).join(','),
    // needsContentRestoreフラグがあるアクティブタブがあるかチェック
    editors.some(editor => {
      if (!editor.activeTabId) return false;
      const activeTab = editor.tabs.find((tab: any) => tab.id === editor.activeTabId);
      return activeTab?.needsContentRestore;
    }),
    projectFiles.length,
    isRestoredFromLocalStorage
  ]);
}
