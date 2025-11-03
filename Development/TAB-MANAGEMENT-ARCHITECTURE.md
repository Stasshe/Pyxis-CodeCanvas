# タブ管理システム アーキテクチャドキュメント

## 概要

Pyxis-CodeCanvasのタブ管理システムを、中央集権的なprops渡し方式から、分散型の自律的アーキテクチャに完全刷新しました。

## 変更前の問題点

### 旧アーキテクチャの課題

```
page.tsx (800+ lines)
  ↓ props drilling
  ├─ LeftSidebar (onFileOpen, onFilePreview, onWebPreview)
  │   ├─ FileTree (onFileOpen, onFilePreview, onWebPreview)
  │   └─ SearchPanel (onFileOpen)
  ├─ OperationWindow (editors, setEditors, onFileSelect)
  └─ PaneContainer (massive props, 15+)
      └─ TabBar (onTabClick, onTabClose, onTabMove, ...)
```

**問題点:**
1. **Props地獄**: page.tsxから深くネストしたコンポーネントまで、大量のpropsを渡す必要
2. **中央集権**: 全てのタブ操作がpage.tsxに集約され、コードが肥大化（800行超）
3. **拡張性の欠如**: 新しいタブ種類を追加する際、多数のファイルを修正する必要
4. **テストの困難性**: 状態が分散せず、単一ファイルへの依存が強い
5. **保守性の低下**: コンポーネント間の結合度が高く、変更の影響範囲が大きい

## 新アーキテクチャの設計方針

### 1. 分散型自律アーキテクチャ

各コンポーネントが`TabContext`を通じて直接タブを操作。propsによる依存を排除。

```
TabContext (Global State)
  ↓
各コンポーネントが自律的にタブを操作
  ├─ FileTree.tsx → useTabContext().openTab()
  ├─ SearchPanel.tsx → useTabContext().openTab()
  ├─ OperationWindow.tsx → useTabContext().openTab()
  ├─ TabBar.tsx → useTabContext().closeTab(), activateTab()
  └─ PaneContainer.tsx → TabContext経由でタブ描画
```

### 2. Registry Pattern による動的拡張

タブ種類を動的に登録・管理する仕組みを導入。

```typescript
// 拡張可能なタブ種類
type TabKind = 'editor' | 'preview' | 'webPreview' | 'ai' | 'diff' | 'settings' | string;
```

### 3. 統一されたAPI

全てのタブ操作を`openTab(data, options)`に統一。

```typescript
openTab(file, { kind: 'editor', jumpToLine: 10 });
openTab(file, { kind: 'preview' });
openTab(file, { kind: 'webPreview' });
```

---

## システム構成

### コアコンポーネント

#### 1. TabRegistry (`engine/tabs/TabRegistry.ts`)

**役割**: タブ種類の動的登録と管理

```typescript
class TabRegistry {
  private types: Map<string, TabTypeDefinition<any>>;

  register<T extends Tab>(kind: string, definition: TabTypeDefinition<T>): void
  get<T extends Tab>(kind: string): TabTypeDefinition<T> | undefined
  has(kind: string): boolean
}
```

**使用方法:**
```typescript
import { tabRegistry } from '@/engine/tabs/TabRegistry';

// タブ種類を登録
tabRegistry.register('editor', EditorTabType);
tabRegistry.register('preview', PreviewTabType);
tabRegistry.register('myCustomTab', MyCustomTabType);

// タブ定義を取得
const definition = tabRegistry.get('editor');
const component = definition.component; // Reactコンポーネント
```

#### 2. TabStore (`stores/tabStore.ts`)

**役割**: Zustand を使用したグローバル状態管理

**状態:**
```typescript
interface TabStoreState {
  panes: EditorPane[];           // ペイン配列
  activePane: string | null;     // アクティブなペインID
  globalActiveTab: string | null; // グローバルでアクティブなタブID
}
```

**操作:**
```typescript
interface TabStoreActions {
  openTab(data: any, options?: OpenTabOptions): void;
  closeTab(paneId: string, tabId: string): void;
  activateTab(paneId: string, tabId: string): void;
  moveTab(fromPaneId: string, toPaneId: string, tabId: string, index?: number): void;
  updateTab(paneId: string, tabId: string, updates: Partial<Tab>): void;
  setPanes(panes: EditorPane[]): void;
  splitPane(paneId: string, direction: 'horizontal' | 'vertical'): void;
  closePane(paneId: string): void;
}
```

**openTabの処理フロー:**
```typescript
openTab(data, options) {
  // 1. kindの決定
  const kind = options?.kind || 'editor';
  
  // 2. TabRegistryから定義を取得
  const definition = tabRegistry.get(kind);
  
  // 3. タブの再利用判定
  if (definition.shouldReuseTab?.(existingTab, data)) {
    // 既存タブをアクティブ化
    activateTab(paneId, existingTab.id);
    return;
  }
  
  // 4. 新しいタブを作成
  const newTab = definition.createTab(data, options);
  
  // 5. ペインに追加してアクティブ化
  addTabToPane(paneId, newTab);
  activateTab(paneId, newTab.id);
}
```

#### 3. TabContext (`context/TabContext.tsx`)

**役割**: React ContextでTabStoreをラップし、コンポーネントからのアクセスを提供

```typescript
export function TabProvider({ children }: { children: React.ReactNode }) {
  const store = useTabStore();
  return (
    <TabContext.Provider value={store}>
      {children}
    </TabContext.Provider>
  );
}

export function useTabContext() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabContext must be used within TabProvider');
  }
  return context;
}
```

**使用例:**
```typescript
function MyComponent() {
  const { openTab, closeTab, panes } = useTabContext();
  
  const handleOpenFile = (file: FileItem) => {
    openTab(file, { kind: 'editor' });
  };
  
  return <button onClick={() => handleOpenFile(file)}>Open</button>;
}
```

### 型システム (`engine/tabs/types.ts`)

#### BaseTab

全タブの基底型:
```typescript
interface BaseTab {
  id: string;              // 一意のタブID
  kind: TabKind;           // タブの種類
  label: string;           // タブバーに表示されるラベル
  isDirty?: boolean;       // 未保存変更があるか
  icon?: string;           // タブアイコン（オプション）
}
```

#### 拡張されたタブ型

```typescript
// エディタタブ
interface EditorTab extends BaseTab {
  kind: 'editor';
  file: FileItem;
  isCodeMirror?: boolean;
  jumpToLine?: number;
  jumpToColumn?: number;
}

// プレビュータブ
interface PreviewTab extends BaseTab {
  kind: 'preview';
  file: FileItem;
}

// Webプレビュータブ
interface WebPreviewTab extends BaseTab {
  kind: 'webPreview';
  file: FileItem;
}

// AIレビュータブ
interface AIReviewTab extends BaseTab {
  kind: 'ai';
  file: FileItem;
  reviewContent?: string;
}

// Diffタブ
interface DiffTab extends BaseTab {
  kind: 'diff';
  files: SingleFileDiff;
}

// 設定タブ
interface SettingsTab extends BaseTab {
  kind: 'settings';
  settingsType: string;
}
```

#### Tab Union Type

```typescript
type Tab = 
  | EditorTab 
  | PreviewTab 
  | WebPreviewTab 
  | AIReviewTab 
  | DiffTab 
  | SettingsTab;
```

#### OpenTabOptions

タブを開く際のオプション:
```typescript
interface OpenTabOptions {
  kind?: TabKind;           // タブ種類
  paneId?: string;          // 対象ペインID（省略時はアクティブペイン）
  activateAfterOpen?: boolean; // 開いた後にアクティブ化（デフォルト: true）
  [key: string]: unknown;   // 拡張用の任意のプロパティ
}
```

---

## タブ種類の定義方法

### TabTypeDefinition インターフェース

```typescript
interface TabTypeDefinition<T extends Tab> {
  component: React.ComponentType<{ tab: T; paneId: string }>;
  createTab: (data: any, options?: OpenTabOptions) => T;
  shouldReuseTab?: (existingTab: T, newData: any) => boolean;
}
```

### 組み込みタブ種類の実装例

#### EditorTabType (`engine/tabs/builtins/EditorTabType.tsx`)

```typescript
import CodeEditor from '@/components/Tab/CodeEditor';

export const EditorTabType: TabTypeDefinition<EditorTab> = {
  // 1. タブを描画するReactコンポーネント
  component: ({ tab, paneId }) => {
    return (
      <CodeEditor
        key={tab.id}
        file={tab.file}
        isCodeMirror={tab.isCodeMirror}
        jumpToLine={tab.jumpToLine}
        jumpToColumn={tab.jumpToColumn}
      />
    );
  },

  // 2. データからタブオブジェクトを生成
  createTab: (data: FileItem, options?: OpenTabOptions): EditorTab => {
    return {
      id: `editor-${data.path}-${Date.now()}`,
      kind: 'editor',
      label: data.name,
      file: data,
      isCodeMirror: data.isCodeMirror || false,
      jumpToLine: options?.jumpToLine,
      jumpToColumn: options?.jumpToColumn,
      isDirty: false,
    };
  },

  // 3. タブの再利用判定（オプション）
  shouldReuseTab: (existingTab: EditorTab, newData: FileItem): boolean => {
    // 同じファイルの場合は既存タブを再利用
    return existingTab.file.path === newData.path;
  },
};
```

#### PreviewTabType (`engine/tabs/builtins/PreviewTabType.tsx`)

```typescript
import MarkdownPreview from '@/components/Tab/MarkdownPreview';

export const PreviewTabType: TabTypeDefinition<PreviewTab> = {
  component: ({ tab }) => {
    return <MarkdownPreview file={tab.file} />;
  },

  createTab: (data: FileItem): PreviewTab => {
    return {
      id: `preview-${data.path}-${Date.now()}`,
      kind: 'preview',
      label: `Preview: ${data.name}`,
      file: data,
      icon: '👁️',
    };
  },

  shouldReuseTab: (existingTab, newData) => {
    return existingTab.file.path === newData.path;
  },
};
```

### カスタムタブ種類の追加方法

#### 1. タブ型を定義

```typescript
// types/customTabs.ts
interface ImageViewerTab extends BaseTab {
  kind: 'imageViewer';
  imageUrl: string;
  fileName: string;
  metadata?: {
    width: number;
    height: number;
    size: number;
  };
}
```

#### 2. TabTypeDefinitionを実装

```typescript
// engine/tabs/custom/ImageViewerTabType.tsx
import ImageViewer from '@/components/Tab/ImageViewer';

export const ImageViewerTabType: TabTypeDefinition<ImageViewerTab> = {
  component: ({ tab }) => {
    return (
      <ImageViewer
        imageUrl={tab.imageUrl}
        fileName={tab.fileName}
        metadata={tab.metadata}
      />
    );
  },

  createTab: (data: { url: string; name: string; metadata?: any }): ImageViewerTab => {
    return {
      id: `image-${data.name}-${Date.now()}`,
      kind: 'imageViewer',
      label: data.name,
      imageUrl: data.url,
      fileName: data.name,
      metadata: data.metadata,
      icon: '🖼️',
    };
  },

  shouldReuseTab: (existingTab, newData) => {
    return existingTab.imageUrl === newData.url;
  },
};
```

#### 3. 登録

```typescript
// app/layout.tsx または初期化ロジック
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import { ImageViewerTabType } from '@/engine/tabs/custom/ImageViewerTabType';

// アプリ起動時に登録
tabRegistry.register('imageViewer', ImageViewerTabType);
```

#### 4. 使用

```typescript
// 任意のコンポーネントから
function MyComponent() {
  const { openTab } = useTabContext();

  const handleOpenImage = (imageFile: FileItem) => {
    openTab(
      {
        url: imageFile.path,
        name: imageFile.name,
        metadata: {
          width: 1920,
          height: 1080,
          size: imageFile.size,
        },
      },
      { kind: 'imageViewer' }
    );
  };

  return <button onClick={() => handleOpenImage(file)}>View Image</button>;
}
```

---

## 拡張機能によるタブ種類の追加

### Extension Manifest での定義

```json
{
  "name": "my-custom-extension",
  "version": "1.0.0",
  "contributes": {
    "tabTypes": [
      {
        "kind": "myCustomTab",
        "component": "./components/MyCustomTab.tsx",
        "label": "My Custom Tab",
        "icon": "icon.svg"
      }
    ]
  }
}
```

### Extension での実装

```typescript
// extensions/my-extension/components/MyCustomTab.tsx
interface MyCustomTabData extends BaseTab {
  kind: 'myCustomTab';
  customData: any;
}

export const MyCustomTabType: TabTypeDefinition<MyCustomTabData> = {
  component: ({ tab }) => {
    return <div>Custom tab content: {tab.customData}</div>;
  },

  createTab: (data: any): MyCustomTabData => {
    return {
      id: `custom-${Date.now()}`,
      kind: 'myCustomTab',
      label: 'Custom Tab',
      customData: data,
    };
  },
};

// Extension 初期化時
export function activate() {
  tabRegistry.register('myCustomTab', MyCustomTabType);
}

export function deactivate() {
  // 必要に応じて登録解除
}
```

---

## タブの開き方

### 基本的な使い方

#### 1. ファイルをエディタで開く

```typescript
const { openTab } = useTabContext();

openTab(fileItem, { kind: 'editor' });
```

#### 2. 特定の行にジャンプして開く

```typescript
openTab(fileItem, {
  kind: 'editor',
  jumpToLine: 42,
  jumpToColumn: 10,
});
```

#### 3. CodeMirrorエディタで開く

```typescript
openTab(
  { ...fileItem, isCodeMirror: true },
  { kind: 'editor' }
);
```

#### 4. Markdownプレビューで開く

```typescript
openTab(markdownFile, { kind: 'preview' });
```

#### 5. Webプレビューで開く

```typescript
openTab(htmlFile, { kind: 'webPreview' });
```

#### 6. AIレビューで開く

```typescript
openTab(fileItem, { kind: 'ai' });
```

#### 7. Diffビューで開く

```typescript
openTab(
  {
    oldContent: '...',
    newContent: '...',
    fileName: 'example.ts',
  },
  { kind: 'diff' }
);
```

#### 8. 設定画面を開く

```typescript
openTab(
  { settingsType: 'shortcuts' },
  { kind: 'settings' }
);
```

### 特定のペインに開く

```typescript
openTab(fileItem, {
  kind: 'editor',
  paneId: 'pane-2', // 特定のペインID
});
```

### 開いた後にアクティブ化しない

```typescript
openTab(fileItem, {
  kind: 'editor',
  activateAfterOpen: false, // バックグラウンドで開く
});
```

---

## コンポーネント別の実装詳細

### FileTree.tsx

**変更前:**
```typescript
interface FileTreeProps {
  onFileOpen: (file: FileItem) => void;
  onFilePreview?: (file: FileItem) => void;
  onWebPreview?: (file: FileItem) => void;
  // ... その他のprops
}

const handleItemClick = (item: FileItem) => {
  if (item.type === 'file') {
    onFileOpen(item); // propsを使用
  }
};
```

**変更後:**
```typescript
interface FileTreeProps {
  // onFileOpen, onFilePreview, onWebPreview を削除
  // ... その他のprops
}

function FileTree({ ... }: FileTreeProps) {
  const { openTab } = useTabContext(); // 追加

  const handleItemClick = (item: FileItem) => {
    if (item.type === 'file') {
      const defaultEditor = localStorage.getItem('pyxis-defaultEditor');
      openTab(
        { ...item, isCodeMirror: defaultEditor === 'codemirror' },
        { kind: 'editor' }
      );
    }
  };

  const handlePreview = (item: FileItem) => {
    openTab(item, { kind: 'preview' });
  };

  const handleWebPreview = (item: FileItem) => {
    openTab(item, { kind: 'webPreview' });
  };
}
```

### SearchPanel.tsx

**変更前:**
```typescript
interface SearchPanelProps {
  onFileOpen: (file: FileItem, line?: number, column?: number) => void;
}

const handleResultClick = (result: SearchResult) => {
  onFileOpen(result.file, result.line, result.column);
};
```

**変更後:**
```typescript
interface SearchPanelProps {
  // onFileOpenを削除
}

function SearchPanel({ ... }: SearchPanelProps) {
  const { openTab } = useTabContext();

  const handleResultClick = (result: SearchResult) => {
    const defaultEditor = localStorage.getItem('pyxis-defaultEditor');
    openTab(
      { ...result.file, isCodeMirror: defaultEditor === 'codemirror' },
      {
        kind: 'editor',
        jumpToLine: result.line,
        jumpToColumn: result.column,
      }
    );
  };
}
```

### OperationWindow.tsx

**変更前:**
```typescript
interface OperationWindowProps {
  editors: EditorPane[];
  setEditors: Dispatch<SetStateAction<EditorPane[]>>;
  setFileSelectState: (state: {...}) => void;
  currentPaneIndex?: number;
  onFileSelect?: (file: FileItem) => void;
}

const actuallyOpenFile = (file: FileItem, preview: boolean) => {
  if (preview) {
    handleFilePreview({ file, ... }); // 複雑な処理
  } else {
    handleFileSelect({ file, ... }); // 複雑な処理
  }
};
```

**変更後:**
```typescript
interface OperationWindowProps {
  // editors, setEditors, setFileSelectState, currentPaneIndex を削除
  onFileSelect?: (file: FileItem) => void; // AIモード用のみ
  aiMode?: boolean;
}

function OperationWindow({ ... }: OperationWindowProps) {
  const { openTab } = useTabContext();

  const actuallyOpenFile = (file: FileItem, preview: boolean) => {
    if (aiMode && onFileSelect) {
      onFileSelect(file);
      return;
    }

    const defaultEditor = localStorage.getItem('pyxis-defaultEditor');
    const fileWithEditor = { ...file, isCodeMirror: defaultEditor === 'codemirror' };

    if (preview) {
      openTab(fileWithEditor, { kind: 'preview' });
    } else {
      openTab(fileWithEditor, { kind: 'editor' });
    }
  };
}
```

### PaneContainer.tsx

**変更前:**
```typescript
interface PaneContainerProps {
  pane: EditorPane;
  onTabClick: (paneId: string, tabId: string) => void;
  onTabClose: (paneId: string, tabId: string) => void;
  onTabMove: (...) => void;
  onSaveFile: (...) => void;
  onDiffApply: (...) => void;
  // ... 15個以上のprops
}
```

**変更後:**
```typescript
interface PaneContainerProps {
  pane: EditorPane; // たった1つのprop！
}

function PaneContainer({ pane }: PaneContainerProps) {
  const { openTab } = useTabContext();

  // タブのコンテンツを描画
  const renderTabContent = (tab: Tab) => {
    const definition = tabRegistry.get(tab.kind);
    if (!definition) {
      return <div>Unknown tab type: {tab.kind}</div>;
    }

    const Component = definition.component;
    return <Component tab={tab} paneId={pane.id} />;
  };

  return (
    <div className="pane-container">
      <TabBar paneId={pane.id} tabs={pane.tabs} activeTabId={pane.activeTabId} />
      <div className="tab-content">
        {pane.tabs.map(tab => (
          <div key={tab.id} style={{ display: tab.id === pane.activeTabId ? 'block' : 'none' }}>
            {renderTabContent(tab)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### TabBar.tsx

**変更前:**
```typescript
interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabMove: (...) => void;
  // ... その他のprops
}
```

**変更後:**
```typescript
interface TabBarProps {
  paneId: string;
  tabs: Tab[];
  activeTabId: string;
  // 全てのハンドラーを削除
}

function TabBar({ paneId, tabs, activeTabId }: TabBarProps) {
  const { activateTab, closeTab, moveTab } = useTabContext();

  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => activateTab(paneId, tab.id)}
          className={tab.id === activeTabId ? 'active' : ''}
        >
          {tab.label}
          {tab.isDirty && <span className="dirty-indicator">●</span>}
          <button onClick={(e) => {
            e.stopPropagation();
            closeTab(paneId, tab.id);
          }}>×</button>
        </div>
      ))}
    </div>
  );
}
```

### page.tsx

**変更前 (800+ lines):**
```typescript
function Home() {
  const [editors, setEditors] = useState<EditorPane[]>([...]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  
  const handleFileOpen = (file: FileItem, line?: number, column?: number) => {
    // 100行以上の複雑なロジック
  };

  const handleTabClick = (paneId: string, tabId: string) => {
    // ...
  };

  const handleTabClose = (paneId: string, tabId: string) => {
    // ...
  };

  // ... 15個以上のハンドラー関数

  return (
    <div>
      <LeftSidebar
        onFileOpen={handleFileOpen}
        onFilePreview={handleFilePreview}
        onWebPreview={handleWebPreview}
        // ... 大量のprops
      />
      <PaneContainer
        pane={pane}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onTabMove={handleTabMove}
        onSaveFile={handleSaveFile}
        // ... 15個以上のprops
      />
    </div>
  );
}
```

**変更後 (~300 lines):**
```typescript
function Home() {
  const { panes, openTab, setPanes } = useTabContext();
  
  // handleFileOpen などの関数は不要！
  // タブ操作は各コンポーネントが自律的に実行

  return (
    <div>
      <LeftSidebar
        // onFileOpen, onFilePreview, onWebPreview を削除
        // 必要最小限のpropsのみ
      />
      <PaneContainer pane={pane} />
      {/* たった1つのprop！ */}
    </div>
  );
}
```

---

## タブ状態の永続化

### localStorage への保存

```typescript
// stores/tabStore.ts
export const useTabStore = create<TabStoreState & TabStoreActions>(
  persist(
    (set, get) => ({
      // ... state and actions
    }),
    {
      name: 'pyxis-tab-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        panes: state.panes.map(pane => ({
          ...pane,
          tabs: pane.tabs.map(tab => ({
            // 必要な情報のみを保存
            id: tab.id,
            kind: tab.kind,
            label: tab.label,
            // ファイル情報などを保存
          })),
        })),
      }),
    }
  )
);
```

### 復元時の処理

```typescript
// context/TabContext.tsx
function TabInitializer() {
  useEffect(() => {
    const { panes } = useTabStore.getState();
    
    if (panes.length === 0) {
      // デフォルトのペインを作成
      useTabStore.getState().setPanes([
        { id: 'pane-1', tabs: [], activeTabId: '' }
      ]);
    } else {
      // 保存されたタブを復元
      panes.forEach(pane => {
        pane.tabs.forEach(tab => {
          // ファイルの内容を再読み込み
          refreshTabContent(tab);
        });
      });
    }
  }, []);

  return null;
}
```

---

## テスト戦略

### Unit Tests

#### TabRegistry のテスト

```typescript
describe('TabRegistry', () => {
  it('should register and retrieve tab type', () => {
    const registry = new TabRegistry();
    registry.register('test', TestTabType);
    
    const definition = registry.get('test');
    expect(definition).toBe(TestTabType);
  });

  it('should check if tab type exists', () => {
    const registry = new TabRegistry();
    registry.register('test', TestTabType);
    
    expect(registry.has('test')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });
});
```

#### TabStore のテスト

```typescript
describe('TabStore', () => {
  it('should open a new tab', () => {
    const { result } = renderHook(() => useTabStore());
    
    act(() => {
      result.current.openTab(mockFile, { kind: 'editor' });
    });
    
    expect(result.current.panes[0].tabs).toHaveLength(1);
    expect(result.current.panes[0].tabs[0].kind).toBe('editor');
  });

  it('should reuse existing tab', () => {
    const { result } = renderHook(() => useTabStore());
    
    act(() => {
      result.current.openTab(mockFile, { kind: 'editor' });
      result.current.openTab(mockFile, { kind: 'editor' });
    });
    
    expect(result.current.panes[0].tabs).toHaveLength(1);
  });

  it('should close tab', () => {
    const { result } = renderHook(() => useTabStore());
    
    act(() => {
      result.current.openTab(mockFile, { kind: 'editor' });
    });
    
    const tabId = result.current.panes[0].tabs[0].id;
    
    act(() => {
      result.current.closeTab('pane-1', tabId);
    });
    
    expect(result.current.panes[0].tabs).toHaveLength(0);
  });
});
```

### Integration Tests

```typescript
describe('Tab Management Integration', () => {
  it('should open file from FileTree', async () => {
    const { getByText } = render(
      <TabProvider>
        <FileTree items={mockFiles} />
        <PaneContainer pane={mockPane} />
      </TabProvider>
    );
    
    const fileItem = getByText('example.ts');
    fireEvent.click(fileItem);
    
    await waitFor(() => {
      expect(screen.getByText('example.ts')).toBeInTheDocument();
    });
  });
});
```

---

## パフォーマンス最適化

### 1. Zustand による最適化

```typescript
// 必要な状態のみをサブスクライブ
const activeTab = useTabStore(state => 
  state.panes.find(p => p.id === paneId)?.tabs.find(t => t.id === activeTabId)
);
```

### 2. React.memo による最適化

```typescript
const TabBarItem = React.memo(({ tab, isActive, onClick }: TabBarItemProps) => {
  return (
    <div className={isActive ? 'active' : ''} onClick={onClick}>
      {tab.label}
    </div>
  );
});
```

### 3. useCallback の活用

```typescript
const handleTabClick = useCallback((tabId: string) => {
  activateTab(paneId, tabId);
}, [paneId, activateTab]);
```

### 4. lazy loading

```typescript
const CodeEditor = lazy(() => import('@/components/Tab/CodeEditor'));
const MarkdownPreview = lazy(() => import('@/components/Tab/MarkdownPreview'));

// タブコンポーネントで使用
<Suspense fallback={<LoadingSpinner />}>
  <Component tab={tab} paneId={paneId} />
</Suspense>
```

---

## マイグレーションガイド

### 既存コードの移行手順

#### Step 1: TabContext の追加

```typescript
// 変更前
function MyComponent({ onFileOpen }) {
  return <button onClick={() => onFileOpen(file)}>Open</button>;
}

// 変更後
function MyComponent() {
  const { openTab } = useTabContext();
  return <button onClick={() => openTab(file, { kind: 'editor' })}>Open</button>;
}
```

#### Step 2: Props の削除

```typescript
// 変更前
interface MyComponentProps {
  onFileOpen: (file: FileItem) => void;
  onFilePreview: (file: FileItem) => void;
  // ...
}

// 変更後
interface MyComponentProps {
  // タブ関連のpropsを削除
}
```

#### Step 3: 親コンポーネントの更新

```typescript
// 変更前
<MyComponent
  onFileOpen={handleFileOpen}
  onFilePreview={handleFilePreview}
/>

// 変更後
<MyComponent />
```

---

## トラブルシューティング

### よくある問題

#### 1. TabContext が使えない

**エラー:** `useTabContext must be used within TabProvider`

**解決策:** `TabProvider` でアプリをラップする

```typescript
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <TabProvider>
          {children}
        </TabProvider>
      </body>
    </html>
  );
}
```

#### 2. タブが開かない

**原因:** TabRegistry にタブ種類が登録されていない

**解決策:** builtin タブを登録する

```typescript
// app/layout.tsx または TabContext.tsx
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import { EditorTabType } from '@/engine/tabs/builtins/EditorTabType';

tabRegistry.register('editor', EditorTabType);
```

#### 3. タブの内容が表示されない

**原因:** タブのコンポーネントが正しくエクスポートされていない

**解決策:** TabTypeDefinition の component プロパティを確認

```typescript
export const MyTabType: TabTypeDefinition<MyTab> = {
  component: ({ tab }) => <MyTabComponent tab={tab} />, // ✓ 正しい
  // component: MyTabComponent, // ✗ 間違い（props が渡らない）
  // ...
};
```

---

## 今後の拡張予定

### 1. タブグループ

複数のタブをグループ化して管理

```typescript
interface TabGroup {
  id: string;
  label: string;
  tabs: Tab[];
  color?: string;
}
```

### 2. タブの保存と復元

ワークスペースごとにタブ状態を保存

```typescript
interface TabWorkspace {
  id: string;
  name: string;
  panes: EditorPane[];
  savedAt: Date;
}
```

### 3. タブのドラッグ&ドロップ改善

- ペイン間のドラッグ&ドロップ
- タブの並び替え
- 新しいウィンドウへのドラッグアウト

### 4. タブの検索とフィルタリング

```typescript
const { searchTabs } = useTabContext();
const results = searchTabs({ query: 'test', kind: 'editor' });
```

---

## まとめ

### 新アーキテクチャの利点

1. **Props削減**: page.tsx が 800行 → 300行（62.5%削減）
2. **拡張性**: 新しいタブ種類を簡単に追加可能
3. **保守性**: コンポーネント間の結合度が低く、変更の影響範囲が小さい
4. **テスト容易性**: 各コンポーネントを独立してテスト可能
5. **型安全性**: TypeScript で完全に型付けされた API
6. **パフォーマンス**: Zustand による効率的な状態管理

### 設計の核心

- **分散型**: 各コンポーネントが自律的にタブを操作
- **Registry Pattern**: タブ種類の動的な登録と管理
- **統一 API**: `openTab(data, options)` で全てのタブを開く
- **拡張可能**: Extension からもタブ種類を追加可能

この新アーキテクチャにより、Pyxis-CodeCanvas は真に拡張可能で保守性の高いコードベースとなりました。
