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

  // プロジェクトが変更された時にタブをリセット
  useEffect(() => {
    if (currentProject) {
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
    }
  }, [currentProject]);

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
    openFile(file, tabs, setTabs, setActiveTabId);
  };

  const handleTabClose = (tabId: string) => {
    closeTab(tabId, tabs, activeTabId, setTabs, setActiveTabId);
  };

  const handleTabContentUpdate = async (tabId: string, content: string) => {
    // ローカルタブを更新
    updateTabContent(tabId, content, tabs, setTabs);
    
    // ファイルをIndexedDBに保存
    const tab = tabs.find(t => t.id === tabId);
    if (tab && currentProject) {
      try {
        await saveFile(tab.path, content);
      } catch (error) {
        console.error('Failed to save file:', error);
      }
    }
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
          onFileOpen={handleFileOpen}
          onResize={handleLeftResize}
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
