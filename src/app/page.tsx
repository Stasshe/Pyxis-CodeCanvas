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
  
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');

  // プロジェクト管理
  const { 
    currentProject, 
    projectFiles, 
    loading: projectLoading,
    loadProject,
    saveFile,
    createProject,
    syncTerminalFileOperation,
  } = useProject();

  const handleLeftResize = useLeftSidebarResize(leftSidebarWidth, setLeftSidebarWidth);
  const handleBottomResize = useBottomPanelResize(bottomPanelHeight, setBottomPanelHeight);

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  // タブの状態変化をデバッグ
  useEffect(() => {
    console.log('[DEBUG] Tabs state changed:', {
      tabCount: tabs.length,
      tabIds: tabs.map(t => t.id),
      activeTabId,
      currentProjectId: currentProject?.id
    });
  }, [tabs, activeTabId, currentProject?.id]);

  // プロジェクトが変更された時にタブをリセット（プロジェクトIDが変わった場合のみ）
  useEffect(() => {
    if (currentProject) {
      // 初回読み込み時のみウェルカムタブを作成
      if (tabs.length === 0) {
        console.log('[useEffect] Creating welcome tab for new project:', currentProject.name);
        // ウェルカムタブを作成
        const welcomeTab: Tab = {
          id: 'welcome',
          name: 'README.md',
          content: `# ${currentProject.name}\n\n${currentProject.description || ''}\n\nプロジェクトファイルはIndexedDBに保存されています。\n./${currentProject.name}/~$`,
          isDirty: false,
          path: '/README.md'
        };
        
        setTabs([welcomeTab]);
        setActiveTabId('welcome');
      } else {
        console.log('[useEffect] Project loaded, keeping existing tabs:', tabs.length);
      }
    }
  }, [currentProject?.id]); // currentProject.id のみを監視

  // プロジェクトファイルが更新された時に開いているタブの内容も同期
  useEffect(() => {
    if (projectFiles.length > 0 && tabs.length > 0) {
      let hasRealChanges = false;
      const updatedTabs = tabs.map(tab => {
        const correspondingFile = projectFiles.find(f => f.path === tab.path);
        // ファイルが見つからない、または内容が同じ、またはタブが編集中の場合はスキップ
        if (!correspondingFile || correspondingFile.content === tab.content || tab.isDirty) {
          return tab;
        }
        
        console.log('[useEffect] Syncing tab content from DB:', {
          tabPath: tab.path,
          oldContentLength: tab.content.length,
          newContentLength: correspondingFile.content?.length || 0,
          tabIsDirty: tab.isDirty
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
        console.log('[useEffect] Updating tabs with new content from DB');
        setTabs(updatedTabs);
      }
    }
  }, [projectFiles.length]); // ファイル数の変更のみを監視して、不要な実行を防ぐ

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
        
        // ファイル保存後にGitパネルを更新（少し遅延を入れる）
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
        />

        {isBottomPanelVisible && (
          <BottomPanel
            height={bottomPanelHeight}
            currentProject={currentProject?.name}
            projectFiles={projectFiles}
            onResize={handleBottomResize}
            onTerminalFileOperation={syncTerminalFileOperation}
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
