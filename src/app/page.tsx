'use client';

import { useState, useEffect } from 'react';
import MenuBar from '@/components/MenuBar';
import LeftSidebar from '@/components/LeftSidebar';
import TabBar from '@/components/TabBar';
import CodeEditor from '@/components/CodeEditor';
import BottomPanel from '@/components/BottomPanel';
import ProjectModal from '@/components/ProjectModal';
import { useLeftSidebarResize, useBottomPanelResize } from '@/utils/resize';
import { openFile, closeTab, updateTabContent } from '@/utils/tabs';
import { useProject } from '@/utils/project';
import { GitCommands } from '@/utils/cmd/git';
import type { MenuTab, Tab, FileItem } from '@/types';
import { Project } from '@/utils/database';

export default function Home() {
  const [activeMenuTab, setActiveMenuTab] = useState<MenuTab>('files');
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(240);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);
  const [isLeftSidebarVisible, setIsLeftSidebarVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [gitRefreshTrigger, setGitRefreshTrigger] = useState(0);
  const [gitChangesCount, setGitChangesCount] = useState(0); // Git変更ファイル数
  const [nodeRuntimeOperationInProgress, setNodeRuntimeOperationInProgress] = useState(false); // NodeRuntime操作中フラグ
  
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');

  // プロジェクト管理
  const { 
    currentProject, 
    projectFiles, 
    loading: projectLoading,
    loadProject,
    saveFile,
    deleteFile,
    createProject,
    syncTerminalFileOperation,
    refreshProjectFiles,
  } = useProject();

  const handleLeftResize = useLeftSidebarResize(leftSidebarWidth, setLeftSidebarWidth);
  const handleBottomResize = useBottomPanelResize(bottomPanelHeight, setBottomPanelHeight);

  const activeTab = tabs.find(tab => tab.id === activeTabId);
  /*
  // タブの状態変化をデバッグ
  useEffect(() => {
    console.log('[DEBUG] Tabs state changed:', {
      tabCount: tabs.length,
      tabIds: tabs.map(t => t.id),
      activeTabId,
      currentProjectId: currentProject?.id
    });
  }, [tabs, activeTabId, currentProject?.id]);
  */

  // プロジェクトが変更された時にタブをリセット（プロジェクトIDが変わった場合のみ）
  useEffect(() => {
    if (currentProject) {
      console.log('[useEffect] Project changed, clearing all tabs and creating welcome tab:', currentProject.name);
      
      // プロジェクトが変更されたら全てのタブを閉じる
      setTabs([]);
      setActiveTabId('');
      
      // 少し遅延させてからウェルカムタブを作成（状態更新の競合を避ける）
      setTimeout(() => {
        const welcomeTab: Tab = {
          id: 'welcome',
          name: 'README.md',
          content: `# ${currentProject.name}\n\n${currentProject.description || ''}\n\nプロジェクトファイルはIndexedDBに保存されています。\n./${currentProject.name}/~$`,
          isDirty: false,
          path: '/README.md'
        };
        
        setTabs([welcomeTab]);
        setActiveTabId('welcome');
      }, 50);
    } else {
      // プロジェクトがない場合はタブをクリア
      setTabs([]);
      setActiveTabId('');
    }
  }, [currentProject?.id]); // currentProject.id のみを監視

  // プロジェクトファイルが更新された時に開いているタブの内容も同期
  useEffect(() => {
    // プロジェクトが変更されたときはタブ同期をスキップ
    if (!currentProject || tabs.length === 0) return;
    
    if (projectFiles.length > 0 && tabs.length > 0) {
      let hasRealChanges = false;
      const updatedTabs = tabs.map(tab => {
        const correspondingFile = projectFiles.find(f => f.path === tab.path);
        // ファイルが見つからない、または内容が同じ場合はスキップ
        // NodeRuntime操作中またはタブが編集中でない場合は強制更新
        if (!correspondingFile || correspondingFile.content === tab.content) {
          return tab;
        }
        
        // NodeRuntime操作中は強制的に更新、そうでなければisDirtyをチェック
        const shouldUpdate = nodeRuntimeOperationInProgress || !tab.isDirty;
        
        if (!shouldUpdate) {
          return tab;
        }
        
        console.log('[useEffect] Syncing tab content from DB after external operation:', {
          tabPath: tab.path,
          oldContentLength: tab.content.length,
          newContentLength: correspondingFile.content?.length || 0,
          tabIsDirty: tab.isDirty,
          nodeRuntimeInProgress: nodeRuntimeOperationInProgress
        });
        hasRealChanges = true;
        return {
          ...tab,
          content: correspondingFile.content || '',
          isDirty: false // DBから同期したので汚れていない状態にリセット
        };
      });
      
      // 実際に内容が変更された場合のみ更新
      if (hasRealChanges) {
        console.log('[useEffect] Updating tabs with new content from DB after external operation');
        setTabs(updatedTabs);
      }
    }
  }, [projectFiles, currentProject?.id, nodeRuntimeOperationInProgress]); // nodeRuntimeOperationInProgressも依存に追加

  // Git状態を独立して監視（GitPanelが表示されていない時でも動作）
  useEffect(() => {
    if (!currentProject) {
      setGitChangesCount(0);
      return;
    }

    const checkGitStatus = async () => {
      try {
        // onFileOperationコールバック付きでGitCommandsを作成
        const gitCommands = new GitCommands(currentProject.name, async (path: string, type: 'file' | 'folder' | 'delete', content?: string) => {
          // 「.」パスはプロジェクト更新通知のためのダミー操作
          if (path === '.') {
            console.log('Git status monitoring: dummy refresh operation detected');
            if (currentProject && loadProject) {
              loadProject(currentProject);
            }
            // Git状態も再チェック
            setTimeout(checkGitStatus, 200);
            return;
          }
          
          // Git操作によるファイル変更をプロジェクトに即座に反映
          if (currentProject && loadProject) {
            loadProject(currentProject);
          }
          // Git状態も再チェック
          setTimeout(checkGitStatus, 200);
        });
        
        const statusResult = await gitCommands.status();
        
        // Git状態をパースして変更ファイル数を計算
        const parseGitStatus = (statusOutput: string) => {
          const lines = statusOutput.split('\n').map(line => line.trim()).filter(Boolean);
          let staged = 0, unstaged = 0, untracked = 0;
          let inChangesToBeCommitted = false;
          let inChangesNotStaged = false;
          let inUntrackedFiles = false;

          for (const line of lines) {
            if (line === 'Changes to be committed:') {
              inChangesToBeCommitted = true;
              inChangesNotStaged = false;
              inUntrackedFiles = false;
            } else if (line === 'Changes not staged for commit:') {
              inChangesToBeCommitted = false;
              inChangesNotStaged = true;
              inUntrackedFiles = false;
            } else if (line === 'Untracked files:') {
              inChangesToBeCommitted = false;
              inChangesNotStaged = false;
              inUntrackedFiles = true;
            } else if (line.startsWith('modified:') || line.startsWith('new file:') || line.startsWith('deleted:')) {
              if (inChangesToBeCommitted) staged++;
              else if (inChangesNotStaged) unstaged++;
            } else if (inUntrackedFiles && !line.includes('use "git add"') && !line.includes('to include') && !line.endsWith('/')) {
              untracked++;
            }
          }

          return staged + unstaged + untracked;
        };

        const changesCount = parseGitStatus(statusResult);
        console.log('[Git Monitor] Changes count:', changesCount);
        setGitChangesCount(changesCount);
      } catch (error) {
        // Git操作でエラーが発生した場合は変更ファイル数を0にリセット
        console.warn('[Git Monitor] Error checking status:', error);
        setGitChangesCount(0);
      }
    };

    // 初回チェック
    checkGitStatus();

    // 定期的にチェック（1分ごと）
    const interval = setInterval(checkGitStatus, 60000);

    // クリーンアップ
    return () => clearInterval(interval);
  }, [currentProject, gitRefreshTrigger]); // プロジェクトやGit更新トリガーが変わった時に再チェック

  const handleMenuTabClick = (tab: MenuTab) => {
    if (activeMenuTab === tab && isLeftSidebarVisible) {
      setIsLeftSidebarVisible(false);
    } else {
      setActiveMenuTab(tab);
      setIsLeftSidebarVisible(true);
    }
  };

  const toggleBottomPanel = () => {
    setIsBottomPanelVisible(!isBottomPanelVisible);
  };

  const handleFileOpen = (file: FileItem) => {
    console.log('[handleFileOpen] Opening file:', { 
      name: file.name, 
      path: file.path, 
      contentLength: file.content?.length || 0 
    });
    
    // 最新のプロジェクトファイルから正しいコンテンツを取得
    if (currentProject && projectFiles.length > 0) {
      const latestFile = projectFiles.find(f => f.path === file.path);
      if (latestFile) {
        const updatedFile = {
          ...file,
          content: latestFile.content
        };
        console.log('[handleFileOpen] Found latest file content:', {
          path: file.path,
          contentLength: latestFile.content?.length || 0
        });
        openFile(updatedFile, tabs, setTabs, setActiveTabId);
        return;
      }
    }
    
    openFile(file, tabs, setTabs, setActiveTabId);
  };

  const handleTabClose = (tabId: string) => {
    closeTab(tabId, tabs, activeTabId, setTabs, setActiveTabId);
  };

  const handleTabContentUpdate = async (tabId: string, content: string) => {
    console.log('[handleTabContentUpdate] Starting:', { tabId, contentLength: content.length });
    
    // ローカルタブを即座に更新（UI応答性のため）
    updateTabContent(tabId, content, tabs, setTabs);
    
    // ファイルをIndexedDBに保存
    const tab = tabs.find(t => t.id === tabId);
    if (tab && currentProject) {
      console.log('[handleTabContentUpdate] Found tab and project:', { tabPath: tab.path, projectName: currentProject.name });
      try {
        await saveFile(tab.path, content);
        console.log('[handleTabContentUpdate] File saved successfully');
        
        // 保存成功後にタブの isDirty 状態をクリア
        setTabs(prevTabs => prevTabs.map(t => 
          t.id === tabId ? { ...t, isDirty: false } : t
        ));
        console.log('[handleTabContentUpdate] Tab isDirty status cleared');
        
        // ファイル保存後にGitパネルを更新（ファイルシステム同期を待つ）
        setTimeout(() => {
          setGitRefreshTrigger(prev => prev + 1);
        }, 200);
      } catch (error) {
        console.error('[handleTabContentUpdate] Failed to save file:', error);
        // エラーをユーザーに通知（今後の拡張用）
        // toast.error(`Failed to save file: ${error.message}`);
      }
    } else {
      console.warn('[handleTabContentUpdate] Missing tab or project:', { tab: !!tab, currentProject: !!currentProject });
    }
  };

  // 即座のローカル更新専用関数
  const handleTabContentChangeImmediate = (tabId: string, content: string) => {
    updateTabContent(tabId, content, tabs, setTabs);
  };

  const handleProjectSelect = async (project: Project) => {
    await loadProject(project);
  };

  const handleProjectCreate = async (name: string, description?: string) => {
    if (createProject) {
      await createProject(name, description);
    }
  };

  const handleProjectModalOpen = () => {
    setIsProjectModalOpen(true);
  };

  return (
    <div className="h-full w-full flex overflow-hidden bg-background" style={{ paddingTop: '2px' }}>
      <MenuBar 
        activeMenuTab={activeMenuTab}
        onMenuTabClick={handleMenuTabClick}
        onProjectClick={handleProjectModalOpen}
        gitChangesCount={gitChangesCount}
      />

      {isLeftSidebarVisible && (
        <LeftSidebar
          activeMenuTab={activeMenuTab}
          leftSidebarWidth={leftSidebarWidth}
          files={projectFiles}
          currentProject={currentProject?.name}
          onFileOpen={handleFileOpen}
          onResize={handleLeftResize}
          onGitRefresh={() => {
            // Git操作後にプロジェクトを再読み込み
            if (currentProject && loadProject) {
              loadProject(currentProject);
            }
          }}
          gitRefreshTrigger={gitRefreshTrigger}
          onGitStatusChange={setGitChangesCount}
          onFileOperation={async (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => {
            console.log('=== onFileOperation called ===');
            console.log('path:', path);
            console.log('type:', type);
            console.log('content length:', content?.length || 'N/A');
            console.log('isNodeRuntime:', isNodeRuntime);
            
            // NodeRuntime操作の場合はフラグを設定
            if (isNodeRuntime) {
              console.log('NodeRuntime operation detected, setting flag');
              setNodeRuntimeOperationInProgress(true);
            }
            
            // 「.」パスはプロジェクト更新通知のためのダミー操作
            // 実際のファイル作成は行わず、プロジェクトリロードのみ実行
            if (path === '.') {
              console.log('Dummy project refresh operation detected, skipping file operations');
              if (currentProject && loadProject) {
                console.log('Reloading project for refresh:', currentProject.name);
                loadProject(currentProject);
                setGitRefreshTrigger(prev => prev + 1);
              }
              return;
            }            // Gitコマンドからのファイル操作をプロジェクトに反映
            if (currentProject) {
              console.log('Processing real file operation for project:', currentProject.name);
                
                // NodeRuntime操作の場合は、まずDBに保存してからタブを更新
                if (isNodeRuntime) {
                  console.log('NodeRuntime operation: saving to DB first');
                  
                  // 該当ファイルがタブで開かれている場合、その内容を即座に更新
                  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
                  const openTab = tabs.find(tab => tab.path === normalizedPath);
                  
                  if (openTab && content !== undefined) {
                    console.log('NodeRuntime: Immediately updating open tab content');
                    setTabs(prevTabs => 
                      prevTabs.map(tab => {
                        if (tab.id === openTab.id) {
                          return { 
                            ...tab, 
                            content: content,
                            isDirty: false 
                          };
                        }
                        return tab;
                      })
                    );
                  }
                  
                  // IndexedDBにも保存
                  if (saveFile) {
                    try {
                      await saveFile(normalizedPath, content || '');
                      console.log('NodeRuntime: File saved to IndexedDB successfully');
                    } catch (error) {
                      console.error('NodeRuntime: Failed to save to IndexedDB:', error);
                    }
                  }
                  
                  // Git状態を更新
                  setGitRefreshTrigger(prev => prev + 1);
                  
                  // NodeRuntime操作フラグをリセット
                  setNodeRuntimeOperationInProgress(false);
                  console.log('NodeRuntime operation completed');
                  return;
                }
                
                // 通常のGit操作の場合
                console.log('Git operation: processing file operation', { path, type, contentLength: content?.length || 0 });
                
                // 削除操作の場合、IndexedDBからも削除
                if (type === 'delete') {
                  console.log('=== GIT DELETE OPERATION PROCESSING ===');
                  console.log('Git delete operation: removing file from IndexedDB');
                  console.log('Delete request path:', path);
                  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
                  console.log('Normalized path:', normalizedPath);
                  console.log('Current projectFiles count:', projectFiles.length);
                  console.log('Available projectFiles paths:', projectFiles.map(f => f.path));
                  const fileToDelete = projectFiles.find(f => f.path === normalizedPath);
                  console.log('File to delete found:', !!fileToDelete);
                  if (fileToDelete) {
                    console.log('File to delete details:', { id: fileToDelete.id, path: fileToDelete.path });
                  }
                  
                  if (fileToDelete && deleteFile) {
                    try {
                      console.log('Attempting to delete file from IndexedDB:', fileToDelete.id);
                      await deleteFile(fileToDelete.id);
                      console.log('Successfully deleted file from IndexedDB:', normalizedPath);
                    } catch (error) {
                      console.error('Failed to delete file from IndexedDB:', error);
                    }
                  } else {
                    console.log('File not found in projectFiles or deleteFile function not available');
                    console.log('fileToDelete:', !!fileToDelete);
                    console.log('deleteFile:', !!deleteFile);
                  }
                  
                  // タブも閉じる
                  const openTab = tabs.find(tab => tab.path === normalizedPath);
                  if (openTab) {
                    console.log('=== CLOSING TAB FOR DELETED FILE ===');
                    console.log('Closing tab for deleted file:', normalizedPath);
                    console.log('Tab details:', { id: openTab.id, path: openTab.path });
                    
                    // タブを即座に閉じる（setTimeoutを使わない）
                    setTabs(prevTabs => {
                      const filteredTabs = prevTabs.filter(tab => tab.id !== openTab.id);
                      console.log('Tabs after closing deleted file tab:', filteredTabs.length);
                      return filteredTabs;
                    });
                    
                    // アクティブタブが削除されたタブの場合は別のタブをアクティブにする
                    if (activeTabId === openTab.id) {
                      const remainingTabs = tabs.filter(tab => tab.id !== openTab.id);
                      if (remainingTabs.length > 0) {
                        setActiveTabId(remainingTabs[0].id);
                        console.log('Set new active tab:', remainingTabs[0].id);
                      } else {
                        setActiveTabId('');
                        console.log('No tabs remaining, cleared active tab');
                      }
                    }
                  } else {
                    console.log('No open tab found for deleted file:', normalizedPath);
                  }
                } else {
                  // ファイル作成・更新の場合
                  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
                  const openTab = tabs.find(tab => tab.path === normalizedPath);
                  
                  if (openTab && content !== undefined) {
                    console.log('Git operation: updating open tab content');
                    setTabs(prevTabs => 
                      prevTabs.map(tab => {
                        if (tab.id === openTab.id) {
                          return { 
                            ...tab, 
                            content: content,
                            isDirty: false 
                          };
                        }
                        return tab;
                      })
                    );
                  }
                  
                  // ファイルをIndexedDBに保存（作成・更新）
                  if (content !== undefined && saveFile) {
                    try {
                      await saveFile(normalizedPath, content);
                      console.log('Git operation: file saved to IndexedDB successfully');
                    } catch (error) {
                      console.error('Git operation: failed to save to IndexedDB:', error);
                    }
                  }                }
                
                // Git状態とプロジェクトファイル状態を更新
                setGitRefreshTrigger(prev => prev + 1);
                
                // プロジェクトファイル状態も即座に更新
                if (refreshProjectFiles) {
                  console.log('Refreshing project files after Git operation');
                  await refreshProjectFiles();
                  console.log('Project files refreshed after Git operation');
                }
                
                console.log('Git operation completed');
              } else {
                console.log('No current project or loadProject function');
              }
          }}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabClick={setActiveTabId}
          onTabClose={handleTabClose}
          isBottomPanelVisible={isBottomPanelVisible}
          onToggleBottomPanel={toggleBottomPanel}
        />

        <CodeEditor
          activeTab={activeTab}
          onContentChange={handleTabContentUpdate}
          onContentChangeImmediate={handleTabContentChangeImmediate}
          isBottomPanelVisible={isBottomPanelVisible}
          bottomPanelHeight={bottomPanelHeight}
          nodeRuntimeOperationInProgress={nodeRuntimeOperationInProgress}
        />

        {isBottomPanelVisible && (
          <BottomPanel
            height={bottomPanelHeight}
            currentProject={currentProject?.name}
            projectFiles={projectFiles}
            onResize={handleBottomResize}
            onTerminalFileOperation={async (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => {
              // NodeRuntime操作の場合はフラグを設定
              if (isNodeRuntime) {
                setNodeRuntimeOperationInProgress(true);
              }
              
              // ターミナルからのファイル操作を処理
              if (syncTerminalFileOperation) {
                await syncTerminalFileOperation(path, type, content);
              }
              
              // Git状態も更新
              setGitRefreshTrigger(prev => prev + 1);
            }}
          />
        )}
      </div>

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        onProjectSelect={handleProjectSelect}
        onProjectCreate={handleProjectCreate}
        currentProject={currentProject}
      />
    </div>
  );
}
