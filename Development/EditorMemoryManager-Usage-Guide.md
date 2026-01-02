# EditorMemoryManager 使い方ガイド

## 概要

EditorMemoryManagerは、エディタータブ（editor, diff, ai-review）の保存状態・デバウンス保存を一元管理するシングルトンクラスです。

**重要: コンテンツはtabStoreで保持し、EditorMemoryManagerはメタデータのみ保持**
- メモリ効率化のため、コンテンツの二重保持を避ける設計

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                   EditorMemoryManager                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  metadataMap: Map<path, MetadataEntry>              │    │
│  │    path1 → { lastModified, saveTimerId }            │    │
│  │    path2 → { lastModified, saveTimerId }            │    │
│  │  ※コンテンツは保持しない（tabStoreに委譲）           │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ changeListeners  │  │  saveListeners   │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────┐        ┌─────────────────┐
│    tabStore     │        │ fileRepository  │
│ (コンテンツ保持) │        │  (IndexedDB)    │
└─────────────────┘        └─────────────────┘
```

## 基本的な使い方

### 1. インポート

```typescript
import { editorMemoryManager } from '@/engine/editor';
```

### 2. 初期化

コンポーネントのuseEffect内で初期化:

```typescript
useEffect(() => {
  const initMemory = async () => {
    await editorMemoryManager.init();
    // メタデータを登録（コンテンツはtabStoreが保持）
    if (tab.path) {
      editorMemoryManager.registerInitialContent(tab.path, tab.content);
    }
  };
  initMemory();
}, [tab.path, tab.content]);
```

### 3. コンテンツの変更（ユーザー編集時）

```typescript
const handleContentChange = useCallback((content: string) => {
  if (!tab.path) return;
  // EditorMemoryManagerを通じて更新
  // - tabStoreの全同一パスタブに自動同期
  // - デバウンス保存が自動スケジュール
  editorMemoryManager.setContent(tab.path, content);
}, [tab.path]);
```

### 4. 即時保存（Ctrl+S）

```typescript
const handleSave = useCallback(async () => {
  if (!tab.path) return;
  const success = await editorMemoryManager.saveImmediately(tab.path);
  if (success) {
    // Git状態更新など
    setGitRefreshTrigger(prev => prev + 1);
  }
}, [tab.path]);
```

### 5. 外部変更の反映（Git操作、AI適用後）

```typescript
const handleApplyChanges = async (filePath: string, content: string) => {
  // fileRepositoryに保存
  await fileRepository.saveFileByPath(projectId, filePath, content);
  
  // EditorMemoryManagerを通じて全タブに反映
  editorMemoryManager.updateFromExternal(filePath, content);
};
```

## API リファレンス

### EditorMemoryManager

#### init()

```typescript
async init(): Promise<void>
```

マネージャーを初期化。fileRepositoryのイベントリスナーを登録。

#### setContent(path, content, skipDebounce?)

```typescript
setContent(path: string, content: string, skipDebounce = false): void
```

コンテンツを更新。自動的に:
- メモリ内のcontentMapを更新
- tabStoreの全同一パスタブを同期
- デバウンス保存をスケジュール（skipDebounce=trueでスキップ）

#### saveImmediately(path)

```typescript
async saveImmediately(path: string): Promise<boolean>
```

即時保存を実行。保留中のデバウンスタイマーをキャンセルして即座にDB保存。

#### updateFromExternal(path, content)

```typescript
updateFromExternal(path: string, content: string): void
```

外部からの変更を反映。isDirty=falseで保存済み状態として扱う。

#### registerInitialContent(path, content)

```typescript
registerInitialContent(path: string, content: string): void
```

タブ表示時に初期コンテンツを登録。既にエントリがあれば無視。

#### getContent(path)

```typescript
getContent(path: string): string | undefined
```

指定パスのコンテンツを取得。

#### isDirty(path)

```typescript
isDirty(path: string): boolean
```

指定パスに未保存の変更があるかを返す。

#### addSaveListener(listener)

```typescript
addSaveListener(listener: SaveCompleteListener): () => void
```

保存完了時のリスナーを追加。戻り値は解除関数。

```typescript
type SaveCompleteListener = (path: string, success: boolean, error?: Error) => void;
```

#### addChangeListener(listener)

```typescript
addChangeListener(listener: ContentChangeListener): () => void
```

コンテンツ変更時のリスナーを追加。

```typescript
type ContentChangeListener = (
  path: string, 
  content: string, 
  source: 'editor' | 'external'
) => void;
```

## React Hook: useEditorMemory

```typescript
import { useEditorMemory } from '@/engine/editor';

function MyEditor({ path, initialContent }) {
  const {
    handleContentChange,    // (content: string) => void
    handleImmediateChange,  // (content: string) => void
    handleSaveImmediate,    // () => Promise<boolean>
    getContent,             // () => string | undefined
    isDirty,                // () => boolean
  } = useEditorMemory({
    path,
    initialContent,
    editable: true,
    onGitRefresh: () => setGitRefreshTrigger(prev => prev + 1),
  });

  return <Editor onChange={handleImmediateChange} />;
}
```

## タブタイプ別の実装例

### EditorTabType

```typescript
const EditorTabComponent: React.FC<TabComponentProps> = ({ tab, isActive }) => {
  const editorTab = tab as EditorTab;
  const { setGitRefreshTrigger } = useGitContext();

  useEffect(() => {
    const init = async () => {
      await editorMemoryManager.init();
      if (editorTab.path && editorTab.content !== undefined) {
        editorMemoryManager.registerInitialContent(editorTab.path, editorTab.content);
      }
    };
    init();
  }, [editorTab.path, editorTab.content]);

  useEffect(() => {
    if (!editorTab.path) return;
    return editorMemoryManager.addSaveListener((savedPath, success) => {
      if (success) setGitRefreshTrigger(prev => prev + 1);
    });
  }, [editorTab.path, setGitRefreshTrigger]);

  const handleChange = useCallback((tabId: string, content: string) => {
    if (!editorTab.path) return;
    editorMemoryManager.setContent(editorTab.path, content);
  }, [editorTab.path]);

  return <CodeEditor onImmediateContentChange={handleChange} />;
};
```

### DiffTabType (editable)

```typescript
const DiffTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const diffTab = tab as DiffTab;

  useEffect(() => {
    const init = async () => {
      await editorMemoryManager.init();
      if (diffTab.editable && diffTab.path && diffTab.diffs.length === 1) {
        const initialContent = diffTab.diffs[0].latterContent || '';
        editorMemoryManager.registerInitialContent(diffTab.path, initialContent);
      }
    };
    init();
  }, [diffTab.editable, diffTab.path, diffTab.diffs]);

  const handleChange = useCallback((content: string) => {
    if (!diffTab.editable || !diffTab.path) return;
    editorMemoryManager.setContent(diffTab.path, content);
  }, [diffTab.editable, diffTab.path]);

  return <DiffTabComponent onContentChange={handleChange} />;
};
```

### AIReviewTabType

```typescript
const handleApplyChanges = async (filePath: string, content: string) => {
  // DBに保存
  await fileRepository.saveFileByPath(projectId, filePath, content);
  
  // 全タブに変更を反映
  editorMemoryManager.updateFromExternal(filePath, content);
  
  // Git状態更新
  setGitRefreshTrigger(prev => prev + 1);
};
```

## 注意事項

### メモリ使用量（改善済み）

- `metadataMap` はメタデータのみ保持（`lastModified`, `saveTimerId`）
- **コンテンツは`tabStore`のみで保持** - 二重保持なし
- メモリ効率は main branch と同等

### 無限ループ防止

- `savingPaths` Setで自身の保存による変更イベントを無視
- fileRepositoryからの変更イベント処理時に内容比較で同一ならスキップ

### 初期化タイミング

- 各タブコンポーネントのマウント時に `init()` を呼び出す
- 既に初期化済みの場合は即座にreturn
