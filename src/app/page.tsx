'use client';

import { useState, useEffect } from 'react';
import MenuBar from '@/components/MenuBar';
import LeftSidebar from '@/components/LeftSidebar';
import TabBar from '@/components/TabBar';
import FileTree from '@/components/FileTree';
import CodeEditor from '@/components/CodeEditor';
import BottomPanel from '@/components/BottomPanel';
import ProjectModal from '@/components/ProjectModal';
import { useLeftSidebarResize, useBottomPanelResize } from '@/utils/resize';
import { openFile, closeTab, updateTabContent } from '@/utils/tabs';
import { GitCommands } from '@/utils/cmd/git';
import { useProject } from '@/utils/project';
import { Project } from '@/utils/database';
import type { Tab,FileItem, MenuTab, EditorLayoutType, EditorPane } from '@/types';


// ファイル選択モーダル用の簡易コンポーネント（Home関数の外に移動）
function FileSelectModal({ isOpen, onClose, files, onFileSelect }: { isOpen: boolean, onClose: () => void, files: FileItem[], onFileSelect: (file: FileItem) => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-background rounded shadow-lg p-4 min-w-[320px] max-h-[80vh] overflow-auto">
        <div className="flex justify-between items-center mb-2">
          <span className="font-bold text-lg">ファイルを選択</span>
          <button className="px-2 py-1 text-xs bg-muted rounded" onClick={onClose}>閉じる</button>
        </div>
        <div className="border rounded p-2 bg-muted">
          <FileTree items={files} onFileOpen={onFileSelect} />
        </div>
      </div>
    </div>
  );
}
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
  //const [tabs, setTabs] = useState<Tab[]>([]);
  // --- VSCode風エディタペイン分割 ---
  // ファイル選択モーダルの状態（どのペインで開くかも保持）
  const [fileSelectState, setFileSelectState] = useState<{ open: boolean, paneIdx: number|null }>({ open: false, paneIdx: null });
  const [editorLayout, setEditorLayout] = useState<EditorLayoutType>('vertical');
  const [editors, setEditors] = useState<EditorPane[]>([
    { id: 'editor-1', tabs: [], activeTabId: '' }
  ]);

  // ペイン追加
  const addEditorPane = () => {
    const newId = `editor-${editors.length + 1}`;
    setEditors([...editors, { id: newId, tabs: [], activeTabId: '' }]);
  };
  // ペイン削除
  const removeEditorPane = (id: string) => {
    if (editors.length === 1) return; // 最低1ペインは残す
    setEditors(editors.filter(e => e.id !== id));
  };
  // ペイン分割方向切替
  const toggleEditorLayout = () => {
    setEditorLayout(l => l === 'vertical' ? 'horizontal' : 'vertical');
  };

  // --- 既存のタブ・ファイル操作は最初のペインに集約（初期実装） ---
  const tabs = editors[0].tabs;
  const setTabs: React.Dispatch<React.SetStateAction<Tab[]>> = (update) => {
    setEditors(prev => {
      const updated = [...prev];
      const newTabs = typeof update === 'function' ? update(updated[0].tabs) : update;
      updated[0] = { ...updated[0], tabs: newTabs };
      return updated;
    });
  };
  const activeTabId = editors[0].activeTabId;
  const setActiveTabId = (id: string) => {
    setEditors(prev => {
      const updated = [...prev];
      updated[0] = { ...updated[0], activeTabId: id };
      return updated;
    });
  };
  

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
    // どのペインでも同じファイルタブは全て更新
    setEditors(prevEditors => {
      // 対象ファイルパスを取得
      const targetPath = (() => {
        for (const pane of prevEditors) {
          const tab = pane.tabs.find(t => t.id === tabId);
          if (tab) return tab.path;
        }
        return undefined;
      })();
      if (!targetPath) return prevEditors;
      return prevEditors.map(pane => ({
        ...pane,
        tabs: pane.tabs.map(t =>
          t.path === targetPath ? { ...t, content, isDirty: true } : t
        )
      }));
    });
    // ファイルをIndexedDBに保存
    const tab = tabs.find(t => t.id === tabId);
    if (tab && currentProject) {
      try {
        await saveFile(tab.path, content);
        // 保存成功後、projectFilesを明示的に再取得
        if (refreshProjectFiles) await refreshProjectFiles();
        // 全ペインの同じファイルタブのisDirtyをfalseに
        setEditors(prevEditors => {
          const targetPath = tab.path;
          return prevEditors.map(pane => ({
            ...pane,
            tabs: pane.tabs.map(t =>
              t.path === targetPath ? { ...t, isDirty: false } : t
            )
          }));
        });
        setTimeout(() => {
          setGitRefreshTrigger(prev => prev + 1);
        }, 200);
      } catch (error) {
        console.error('[handleTabContentUpdate] Failed to save file:', error);
      }
    } else {
      console.warn('[handleTabContentUpdate] Missing tab or project:', { tab: !!tab, currentProject: !!currentProject });
    }
  // projectFiles更新時、全ペインの同じファイルタブの内容・isDirtyを強制同期
  useEffect(() => {
    if (!currentProject || projectFiles.length === 0) return;
    setEditors(prevEditors => {
      return prevEditors.map(pane => ({
        ...pane,
        tabs: pane.tabs.map(tab => {
          const file = projectFiles.find(f => f.path === tab.path);
          if (file && tab.content !== (file.content ?? '')) {
            return { ...tab, content: file.content ?? '', isDirty: false };
          }
          return tab;
        })
      }));
    });
  }, [projectFiles, currentProject?.id]);
  };

  // 即座のローカル更新専用関数
  // 即座のローカル更新: 全ペインの同じファイルタブも同期
  const handleTabContentChangeImmediate = (tabId: string, content: string) => {
    setEditors(prevEditors => {
      // 対象ファイルパスを取得
      const targetPath = (() => {
        for (const pane of prevEditors) {
          const tab = pane.tabs.find(t => t.id === tabId);
          if (tab) return tab.path;
        }
        return undefined;
      })();
      if (!targetPath) return prevEditors;
      return prevEditors.map(pane => ({
        ...pane,
        tabs: pane.tabs.map(t =>
          t.path === targetPath ? { ...t, content, isDirty: true } : t
        )
      }));
    });
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
        <div
          className={editorLayout === 'vertical' ? 'flex-1 flex flex-row overflow-hidden min-h-0' : 'flex-1 flex flex-col overflow-hidden min-h-0'}
          style={{ gap: '2px' }}
        >
          {editors.map((editor, idx) => {
            const activeTab = editor.tabs.find(tab => tab.id === editor.activeTabId);
            return (
              <div key={editor.id} className="flex-1 flex flex-col border border-border rounded bg-background relative min-w-0 min-h-0">
                <TabBar
                  tabs={editor.tabs}
                  activeTabId={editor.activeTabId}
                  onTabClick={tabId => {
                    setEditors(prev => {
                      const updated = [...prev];
                      updated[idx] = { ...updated[idx], activeTabId: tabId };
                      return updated;
                    });
                  }}
                  onTabClose={tabId => {
                    setEditors(prev => {
                      const updated = [...prev];
                      updated[idx] = { ...updated[idx], tabs: updated[idx].tabs.filter(t => t.id !== tabId) };
                      if (updated[idx].activeTabId === tabId) {
                        updated[idx].activeTabId = updated[idx].tabs.length > 0 ? updated[idx].tabs[0].id : '';
                      }
                      return updated;
                    });
                  }}
                  isBottomPanelVisible={isBottomPanelVisible}
                  onToggleBottomPanel={toggleBottomPanel}
                  extraButtons={
                    <div className="flex gap-1 ml-2">
                      <button className="px-2 py-1 text-xs bg-accent rounded" onClick={addEditorPane} title="ペイン追加">＋</button>
                      <button className="px-2 py-1 text-xs bg-destructive rounded" onClick={() => removeEditorPane(editor.id)} title="ペイン削除">－</button>
                      <button className="px-2 py-1 text-xs bg-muted rounded" onClick={toggleEditorLayout} title="分割方向切替">⇄</button>
                    </div>
                  }
                  onAddTab={() => setFileSelectState({ open: true, paneIdx: idx })}
                />
                <CodeEditor
                  activeTab={activeTab}
                  onContentChange={async (tabId, content) => {
                    // ローカル状態を更新
                    setEditors(prev => {
                      const updated = [...prev];
                      updated[idx] = {
                        ...updated[idx],
                        tabs: updated[idx].tabs.map(t => t.id === tabId ? { ...t, content, isDirty: true } : t)
                      };
                      return updated;
                    });
                    
                    // ファイルパスを取得
                    const tab = editors[idx].tabs.find(t => t.id === tabId);
                    if (tab && currentProject) {
                      // 同じファイルを開いているペインのうち、最小のペインインデックスを見つける
                      const panesWithSameFile = editors.map((editor, editorIdx) => {
                        const hasFile = editor.tabs.some(t => t.path === tab.path);
                        return hasFile ? editorIdx : -1;
                      }).filter(i => i !== -1);
                      
                      const minPaneIdx = Math.min(...panesWithSameFile);
                      
                      // 現在のペインが最小のペインインデックスの場合のみ保存処理を実行
                      if (idx === minPaneIdx) {
                        try {
                          console.log(`[Pane ${idx}] Saving file as minimum pane index:`, tab.path);
                          // IndexedDBに保存
                          await saveFile(tab.path, content);
                          console.log(`[Pane ${idx}] File saved to IndexedDB:`, tab.path);
                          
                          // 保存成功後、projectFilesを明示的に再取得
                          if (refreshProjectFiles) await refreshProjectFiles();
                          
                          // 全ペインの同じファイルタブのisDirtyをfalseに
                          setEditors(prevEditors => {
                            const targetPath = tab.path;
                            return prevEditors.map(pane => ({
                              ...pane,
                              tabs: pane.tabs.map(t =>
                                t.path === targetPath ? { ...t, isDirty: false } : t
                              )
                            }));
                          });
                          
                          // Git状態を更新
                          setTimeout(() => {
                            setGitRefreshTrigger(prev => prev + 1);
                          }, 200);
                        } catch (error) {
                          console.error(`[Pane ${idx}] Failed to save file:`, error);
                        }
                      } else {
                        console.log(`[Pane ${idx}] Skipping save as not minimum pane index (min: ${minPaneIdx}):`, tab.path);
                      }
                    }
                  }}
                  onContentChangeImmediate={handleTabContentChangeImmediate}
                  isBottomPanelVisible={isBottomPanelVisible}
                  bottomPanelHeight={bottomPanelHeight}
                  nodeRuntimeOperationInProgress={nodeRuntimeOperationInProgress}
                />
              </div>
            );
          })}
        </div>
        {isBottomPanelVisible && (
          <BottomPanel
            height={bottomPanelHeight}
            currentProject={currentProject?.name}
            projectFiles={projectFiles}
            onResize={handleBottomResize}
            onTerminalFileOperation={async (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => {
              if (isNodeRuntime) {
                setNodeRuntimeOperationInProgress(true);
              }
              if (syncTerminalFileOperation) {
                await syncTerminalFileOperation(path, type, content);
              }
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
      {/* ファイル選択モーダル */}
      <FileSelectModal
        isOpen={fileSelectState.open}
        onClose={() => setFileSelectState({ open: false, paneIdx: null })}
        files={projectFiles}
        onFileSelect={file => {
          setFileSelectState({ open: false, paneIdx: null });
          // 開くペインを判定
          if (fileSelectState.paneIdx !== null) {
            setEditors(prev => {
              const updated = [...prev];
              const pane = updated[fileSelectState.paneIdx!];
              // 最新のファイル内容取得
              let fileToOpen = file;
              if (currentProject && projectFiles.length > 0) {
                const latestFile = projectFiles.find(f => f.path === file.path);
                if (latestFile) {
                  fileToOpen = { ...file, content: latestFile.content };
                }
              }
              // 既存タブがあればアクティブ化、なければ追加
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
                  path: fileToOpen.path
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
        }}
      />
    </div>
  );
}
