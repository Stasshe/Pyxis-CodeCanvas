'use client';

import { useState, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { 
  FileText, 
  Search, 
  Settings, 
  FolderOpen, 
  File,
  X,
  Plus,
  Folder
} from 'lucide-react';
import clsx from 'clsx';

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileItem[];
  path: string;
}

interface Tab {
  id: string;
  name: string;
  content: string;
  isDirty: boolean;
  path: string;
}

export default function Home() {
  const [activeMenuTab, setActiveMenuTab] = useState<'files' | 'search' | 'settings'>('files');
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(240);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: '1',
      name: 'welcome.txt',
      content: '// Pyxis Editor\n// VS Code風のエディターです\n\nこんにちは！\nこちらはPyxisエディターです。\n\n機能:\n- ファイル管理\n- コードエディティング\n- ターミナル（準備中）\n- 検索機能（準備中）',
      isDirty: false,
      path: '/welcome.txt'
    }
  ]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [files] = useState<FileItem[]>([
    {
      id: '1',
      name: 'src',
      type: 'folder',
      path: '/src',
      children: [
        {
          id: '2',
          name: 'components',
          type: 'folder',
          path: '/src/components',
          children: [
            { id: '3', name: 'Button.tsx', type: 'file', path: '/src/components/Button.tsx', content: 'export default function Button() {\n  return <button>Click me</button>;\n}' },
            { id: '4', name: 'Input.tsx', type: 'file', path: '/src/components/Input.tsx', content: 'export default function Input() {\n  return <input type="text" />;\n}' }
          ]
        },
        { id: '5', name: 'index.ts', type: 'file', path: '/src/index.ts', content: 'console.log("Hello, Pyxis!");' }
      ]
    },
    { id: '6', name: 'package.json', type: 'file', path: '/package.json', content: '{\n  "name": "pyxis-project",\n  "version": "1.0.0"\n}' },
    { id: '7', name: 'README.md', type: 'file', path: '/README.md', content: '# Pyxis Project\n\nThis is a sample project in Pyxis Editor.' }
  ]);

  const leftResizerRef = useRef<HTMLDivElement>(null);
  const explorerResizerRef = useRef<HTMLDivElement>(null);
  const bottomResizerRef = useRef<HTMLDivElement>(null);

  const handleResize = useCallback((
    setWidth: (width: number) => void,
    initialX: number,
    initialWidth: number
  ) => {
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - initialX;
      const newWidth = Math.max(200, Math.min(400, initialWidth + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleBottomResize = useCallback((
    initialY: number,
    initialHeight: number
  ) => {
    const handleMouseMove = (e: MouseEvent) => {
      const delta = initialY - e.clientY;
      const newHeight = Math.max(100, Math.min(window.innerHeight * 0.5, initialHeight + delta));
      setBottomPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const openFile = (file: FileItem) => {
    if (file.type === 'folder') return;
    
    const existingTab = tabs.find(tab => tab.path === file.path);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    const newTab: Tab = {
      id: Date.now().toString(),
      name: file.name,
      content: file.content || '',
      isDirty: false,
      path: file.path
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const closeTab = (tabId: string) => {
    setTabs(prev => prev.filter(tab => tab.id !== tabId));
    if (activeTabId === tabId) {
      const remainingTabs = tabs.filter(tab => tab.id !== tabId);
      setActiveTabId(remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : '');
    }
  };

  const updateTabContent = (tabId: string, content: string) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId 
        ? { ...tab, content, isDirty: true }
        : tab
    ));
  };

  const renderFileTree = (items: FileItem[], level = 0) => {
    return items.map(item => (
      <div key={item.id} style={{ marginLeft: `${level * 16}px` }}>
        <div
          className="flex items-center gap-2 px-2 py-1 hover:bg-accent cursor-pointer select-none"
          onClick={() => openFile(item)}
        >
          {item.type === 'folder' ? (
            <Folder size={16} className="text-blue-400" />
          ) : (
            <File size={16} className="text-gray-400" />
          )}
          <span className="text-sm truncate">{item.name}</span>
        </div>
        {item.children && renderFileTree(item.children, level + 1)}
      </div>
    ));
  };

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-background">
      {/* Left Menu Bar */}
      <div className="w-12 bg-muted border-r border-border flex flex-col">
        <button
          className={clsx(
            'h-12 w-12 flex items-center justify-center hover:bg-accent',
            activeMenuTab === 'files' && 'bg-accent text-primary'
          )}
          onClick={() => setActiveMenuTab('files')}
        >
          <FileText size={20} />
        </button>
        <button
          className={clsx(
            'h-12 w-12 flex items-center justify-center hover:bg-accent',
            activeMenuTab === 'search' && 'bg-accent text-primary'
          )}
          onClick={() => setActiveMenuTab('search')}
        >
          <Search size={20} />
        </button>
        <button
          className={clsx(
            'h-12 w-12 flex items-center justify-center hover:bg-accent',
            activeMenuTab === 'settings' && 'bg-accent text-primary'
          )}
          onClick={() => setActiveMenuTab('settings')}
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Left Sidebar */}
      <div 
        className="bg-card border-r border-border flex flex-col"
        style={{ width: leftSidebarWidth }}
      >
        <div className="h-8 bg-muted border-b border-border flex items-center px-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {activeMenuTab === 'files' && 'ファイル'}
            {activeMenuTab === 'search' && '検索'}
            {activeMenuTab === 'settings' && '設定'}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {activeMenuTab === 'files' && (
            <div className="p-2">
              <div className="flex items-center gap-2 mb-2">
                <FolderOpen size={14} />
                <span className="text-xs font-medium">エクスプローラー</span>
              </div>
              {renderFileTree(files)}
            </div>
          )}
          {activeMenuTab === 'search' && (
            <div className="p-4">
              <p className="text-sm text-muted-foreground">検索機能は準備中です</p>
            </div>
          )}
          {activeMenuTab === 'settings' && (
            <div className="p-4">
              <p className="text-sm text-muted-foreground">設定画面は準備中です</p>
            </div>
          )}
        </div>
      </div>

      {/* Left Resizer */}
      <div
        ref={leftResizerRef}
        className="resizer resizer-vertical"
        onMouseDown={(e) => {
          e.preventDefault();
          handleResize(setLeftSidebarWidth, e.clientX, leftSidebarWidth);
        }}
      />

      {/* Explorer Panel */}
      <div 
        className="bg-card border-r border-border flex flex-col"
        style={{ width: explorerWidth }}
      >
        <div className="h-8 bg-muted border-b border-border flex items-center px-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            ファイル一覧
          </span>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {renderFileTree(files)}
        </div>
      </div>

      {/* Explorer Resizer */}
      <div
        ref={explorerResizerRef}
        className="resizer resizer-vertical"
        onMouseDown={(e) => {
          e.preventDefault();
          handleResize(setExplorerWidth, e.clientX, explorerWidth);
        }}
      />

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col">
        {/* Tab Bar */}
        <div className="h-10 bg-muted border-b border-border flex items-center overflow-x-auto">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={clsx(
                'h-full flex items-center px-3 border-r border-border cursor-pointer min-w-0 flex-shrink-0',
                tab.id === activeTabId ? 'tab-active' : 'tab-inactive'
              )}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span className="text-sm truncate max-w-32">{tab.name}</span>
              {tab.isDirty && <span className="ml-1 text-xs">●</span>}
              <button
                className="ml-2 p-1 hover:bg-accent rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button className="h-full px-3 hover:bg-accent flex items-center justify-center">
            <Plus size={16} />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1" style={{ height: `calc(100vh - 40px - ${bottomPanelHeight}px)` }}>
          {activeTab ? (
            <Editor
              height="100%"
              language={activeTab.name.endsWith('.tsx') || activeTab.name.endsWith('.ts') ? 'typescript' : activeTab.name.endsWith('.json') ? 'json' : activeTab.name.endsWith('.md') ? 'markdown' : 'plaintext'}
              value={activeTab.content}
              onChange={(value) => value !== undefined && updateTabContent(activeTab.id, value)}
              theme="vs-dark"
              options={{
                fontSize: 14,
                lineNumbers: 'on',
                roundedSelection: false,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                minimap: { enabled: true },
                wordWrap: 'on',
                tabSize: 2,
                insertSpaces: true
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FileText size={48} className="mx-auto mb-4 opacity-50" />
                <p>ファイルを選択してください</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Resizer */}
        <div
          ref={bottomResizerRef}
          className="resizer resizer-horizontal"
          onMouseDown={(e) => {
            e.preventDefault();
            handleBottomResize(e.clientY, bottomPanelHeight);
          }}
        />

        {/* Bottom Panel (Terminal placeholder) */}
        <div 
          className="bg-card border-t border-border"
          style={{ height: bottomPanelHeight }}
        >
          <div className="h-8 bg-muted border-b border-border flex items-center px-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              ターミナル
            </span>
          </div>
          <div className="h-full p-4 overflow-auto">
            <p className="text-sm text-muted-foreground">ターミナル機能は準備中です</p>
          </div>
        </div>
      </div>
    </div>
  );
}
