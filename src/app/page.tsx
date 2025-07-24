'use client';

import { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import MenuBar from '@/components/MenuBar';
import LeftSidebar from '@/components/LeftSidebar';
import TabBar from '@/components/TabBar';
import CodeEditor from '@/components/CodeEditor';
import BottomPanel from '@/components/BottomPanel';
import ProjectModal from '@/components/ProjectModal';
import { useLeftSidebarResize, useBottomPanelResize } from '@/utils/resize';
import { openFile } from '@/utils/tabs';
import { GitCommands } from '@/utils/cmd/git';
import { useProject } from '@/utils/project';
import { Project } from '@/types';
import type { Tab,FileItem, MenuTab, EditorLayoutType, EditorPane } from '@/types';
import FileSelectModal from '@/components/FileSelect';
import { Terminal } from 'lucide-react';
import { handleFileOperation } from '@/utils/handleFileOperation';


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
  const [fileSelectState, setFileSelectState] = useState<{ open: boolean, paneIdx: number|null }>({ open: false, paneIdx: null });
  const [editorLayout, setEditorLayout] = useState<EditorLayoutType>('vertical');
  const [editors, setEditors] = useState<EditorPane[]>([
    { id: 'editor-1', tabs: [], activeTabId: '' }
  ]);
  const { colors } = useTheme();

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
    loadProject,
    saveFile,
    deleteFile,
    createProject,
    syncTerminalFileOperation,
    refreshProjectFiles,
  } = useProject();

  
  

  const handleLeftResize = useLeftSidebarResize(leftSidebarWidth, setLeftSidebarWidth);
  const handleBottomResize = useBottomPanelResize(bottomPanelHeight, setBottomPanelHeight);

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
          name: 'Welcome',
          content: `# ${currentProject.name}\n\n${currentProject.description || ''}\n\nプロジェクトファイルはIndexedDBに保存されています。\n./${currentProject.name}/~$`,
          isDirty: false,
          path: '/'
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
          // handleFileOperation を使ってDB・UIと同期
          await handleFileOperation({
            path,
            type,
            content,
            isNodeRuntime: false,
            currentProject,
            loadProject,
            saveFile,
            deleteFile,
            tabs,
            setTabs,
            activeTabId,
            setActiveTabId,
            projectFiles,
            setGitRefreshTrigger,
            setNodeRuntimeOperationInProgress,
            refreshProjectFiles,
          });
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
    <>
    <div
      className="w-full flex justify-end items-center overflow-hidden"
      style={{
      background: colors.background,
      height: '30px',
      }}
    >
      <button
        className={`relative right-3 h-6 px-2 flex items-center justify-center border rounded transition-colors`}
        onClick={toggleBottomPanel}
        title="ターミナル表示/非表示"
        style={{
          zIndex: 50,
          background: isBottomPanelVisible ? colors.accentBg : colors.mutedBg,
          color: isBottomPanelVisible ? colors.primary : colors.mutedFg,
          borderColor: colors.border,
        }}
        >
        <Terminal size={8} color={isBottomPanelVisible ? colors.primary : colors.mutedFg} />
      </button>
    </div>
    <div
      className="h-full w-full flex overflow-hidden"
      style={{
        background: colors.background,
        position: 'relative'
      }}
    >
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
          // !型アサーションビミョい
          currentProject={currentProject!}
          onFileOpen={handleFileOpen}
          onFilePreview={file => {
            // Markdownプレビュータブとして開く
            const previewTabId = `preview-${file.path}`;
            setTabs(prevTabs => {
              // 既存プレビュータブがあればアクティブ化
              const existing = prevTabs.find(tab => tab.id === previewTabId);
              if (existing) {
                setActiveTabId(previewTabId);
                return prevTabs;
              }
              // 最新のファイル内容取得
              let fileToPreview = file;
              if (currentProject && projectFiles.length > 0) {
                const latestFile = projectFiles.find(f => f.path === file.path);
                if (latestFile) {
                  fileToPreview = { ...file, content: latestFile.content };
                }
              }
              // プレビュータブ追加
              const newTab = {
                id: previewTabId,
                name: `${fileToPreview.name} (Preview)`,
                content: fileToPreview.content || '',
                isDirty: false,
                path: fileToPreview.path,
                preview: true // プレビューフラグ
              };
              setActiveTabId(previewTabId);
              return [...prevTabs, newTab];
            });
          }}
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

  <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div
          className={editorLayout === 'vertical' ? 'flex-1 flex flex-row overflow-hidden min-h-0' : 'flex-1 flex flex-col overflow-hidden min-h-0'}
          style={{ gap: '2px' }}
        >
          {editors.map((editor, idx) => {
            const activeTab = editor.tabs.find(tab => tab.id === editor.activeTabId);
            return (
              <div
                key={editor.id}
                className="flex-1 flex flex-col rounded relative min-w-0 min-h-0"
                style={{
                  background: colors.background,
                  border: `1px solid ${colors.border}`
                }}
              >
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
                    
                    // ファイルパスを取得 - 最新のエディタ状態を使用するために関数内で取得
                    setEditors(currentEditors => {
                      // 現在のタブを見つける
                      const tab = currentEditors[idx].tabs.find(t => t.id === tabId);
                      if (!tab || !currentProject) return currentEditors; // タブが見つからない場合は何もしない
                      
                      //const minPaneIdx = Math.min(...panesWithSameFile);

                      (async () => {
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
                      })();
                      
                      // 元のエディタ状態を返す（setEditorsの中なので）
                      return currentEditors;
                    })
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
        onFilePreview={file => {
          // プレビュー用タブを開く
          setFileSelectState({ open: false, paneIdx: null });
          if (fileSelectState.paneIdx !== null) {
            setEditors(prev => {
              const updated = [...prev];
              const pane = updated[fileSelectState.paneIdx!];
              let fileToPreview = file;
              if (currentProject && projectFiles.length > 0) {
                const latestFile = projectFiles.find(f => f.path === file.path);
                if (latestFile) {
                  fileToPreview = { ...file, content: latestFile.content };
                }
              }
              // プレビュー用タブ（preview: true）
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
                  preview: true
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
        onFileOperation={async (path, type, content, isNodeRuntime) => {
          // 既存のonFileOperationのロジックを流用
          if (isNodeRuntime) {
            setNodeRuntimeOperationInProgress(true);
          }
          if (syncTerminalFileOperation) {
            await syncTerminalFileOperation(path, type, content);
          }
          setGitRefreshTrigger(prev => prev + 1);
        }}
        currentProjectName={currentProject?.name || ''}
      />
    </div>
    </>
  );
}
