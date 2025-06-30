import { Tab, FileItem } from '../types';

export const createNewTab = (file: FileItem): Tab => {
  return {
    id: Date.now().toString(),
    name: file.name,
    content: file.content || '',
    isDirty: false,
    path: file.path
  };
};

export const openFile = (
  file: FileItem,
  tabs: Tab[],
  setTabs: (tabs: Tab[]) => void,
  setActiveTabId: (id: string) => void
) => {
  if (file.type === 'folder') return;
  
  const existingTab = tabs.find(tab => tab.path === file.path);
  if (existingTab) {
    setActiveTabId(existingTab.id);
    return;
  }

  const newTab = createNewTab(file);
  setTabs([...tabs, newTab]);
  setActiveTabId(newTab.id);
};

export const closeTab = (
  tabId: string,
  tabs: Tab[],
  activeTabId: string,
  setTabs: (tabs: Tab[]) => void,
  setActiveTabId: (id: string) => void
) => {
  const newTabs = tabs.filter(tab => tab.id !== tabId);
  setTabs(newTabs);
  
  if (activeTabId === tabId) {
    setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : '');
  }
};

export const updateTabContent = (
  tabId: string,
  content: string,
  tabs: Tab[],
  setTabs: (tabs: Tab[]) => void
) => {
  setTabs(tabs.map(tab => 
    tab.id === tabId 
      ? { ...tab, content, isDirty: true }
      : tab
  ));
};
