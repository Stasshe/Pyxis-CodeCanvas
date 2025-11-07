# Pyxis Storage & Keybindings System

## 概要

`pyxis-global` IndexedDBを使用した統一的なストレージシステムと、プラットフォーム対応のキーバインディングシステムを実装しました。

## アーキテクチャ

### 1. 汎用ストレージレイヤー (`src/engine/storage/index.ts`)

**特徴:**
- 単一のIndexedDB (`pyxis-global`) で全データを管理
- メモリキャッシュによる高速アクセス
- TTL（有効期限）サポート
- 自動期限切れデータクリーンアップ

**ストア構成:**
- `translations`: i18n翻訳データ
- `keybindings`: ショートカットキー設定
- `user_preferences`: ユーザー設定（拡張可能）

**使用例:**
```typescript
import { storageService, STORES } from '@/engine/storage';

// データ保存
await storageService.set(STORES.KEYBINDINGS, 'my-key', data, { ttl: 7 * 24 * 60 * 60 * 1000 });

// データ取得（自動キャッシュ）
const data = await storageService.get(STORES.KEYBINDINGS, 'my-key');

// データ削除
await storageService.delete(STORES.KEYBINDINGS, 'my-key');

// ストアクリア
await storageService.clear(STORES.KEYBINDINGS);
```

### 2. キーバインディングシステム (`src/hooks/useKeyBindings.ts`)

**特徴:**
- **プラットフォーム自動対応**: Mac (Cmd) / Windows/Linux (Ctrl) を自動判定
- **グローバルキーボードリスナー**: アプリケーション全体で統一管理
- **入力フィールド除外**: input/textarea/contentEditable内では自動的に無効化
- **カテゴリー分類**: アクションをカテゴリーごとに整理

**デフォルトキーバインディング:**
| アクション | Windows/Linux | Mac | カテゴリー |
|-----------|--------------|-----|-----------|
| Open File | Ctrl+O | Cmd+O | file |
| Save File | Ctrl+S | Cmd+S | file |
| Find | Ctrl+F | Cmd+F | search |
| Toggle Sidebar | Ctrl+B | Cmd+B | view |
| Run File | Ctrl+R | Cmd+R | execution |
| New Tab | Ctrl+T | Cmd+T | tab |
| Close Tab | Ctrl+W | Cmd+W | tab |
| Next Tab | Ctrl+Tab | Cmd+Tab | tab |
| Prev Tab | Ctrl+Shift+Tab | Cmd+Shift+Tab | tab |

**使用例:**

```typescript
import { useKeyBinding, useKeyBindings } from '@/hooks/useKeyBindings';

// 方法1: シンプルなアクション登録
function MyComponent() {
  useKeyBinding('saveFile', () => {
    console.log('Save triggered!');
  }, [/* dependencies */]);
}

// 方法2: 詳細なコントロール
function MyComponent() {
  const { registerAction, getKeyCombo, bindings, updateBindings } = useKeyBindings();
  
  useEffect(() => {
    const unregister = registerAction('customAction', () => {
      console.log('Custom action!');
    });
    return unregister;
  }, [registerAction]);
  
  // キーコンボを取得
  const combo = getKeyCombo('saveFile'); // "Cmd+S" (Mac) or "Ctrl+S" (Win/Linux)
}
```

### 3. 適用例

#### TabBar (`src/components/Tab/TabBar.tsx`)

わずか数行で完全なキーボードショートカット対応:

```typescript
import { useKeyBinding } from '@/hooks/useKeyBindings';

// 新しいタブ (Ctrl/Cmd+T)
useKeyBinding('newTab', () => {
  if (onAddTab) onAddTab();
}, [onAddTab]);

// タブを閉じる (Ctrl/Cmd+W)
useKeyBinding('closeTab', () => {
  if (activeTabId) {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab) {
      requestClose(activeTab.id, activeTab.isDirty, onTabClose);
    }
  }
}, [activeTabId, tabs, onTabClose, requestClose]);

// 次のタブへ (Ctrl/Cmd+Tab)
useKeyBinding('nextTab', () => {
  if (tabs.length === 0) return;
  const currentIndex = tabs.findIndex(t => t.id === activeTabId);
  const nextIndex = (currentIndex + 1) % tabs.length;
  onTabClick(tabs[nextIndex].id);
}, [tabs, activeTabId, onTabClick]);
```

#### ショートカットキー設定画面 (`src/components/Tab/ShortcutKeysTab.tsx`)

- カテゴリー別表示
- リアルタイムキーキャプチャ
- 重複検出
- デフォルトリセット機能

#### i18n (`src/engine/i18n/storage-adapter.ts`)

汎用ストレージを使用した薄いアダプターレイヤー:

```typescript
import { storageService, STORES } from '@/engine/storage';

export async function saveTranslationCache(
  locale: Locale,
  namespace: string,
  data: Record<string, unknown>
): Promise<void> {
  const id = `${locale}-${namespace}`;
  await storageService.set(STORES.TRANSLATIONS, id, data, { ttl: 7 * 24 * 60 * 60 * 1000 });
}
```

## 設計の利点

### 1. **DRY (Don't Repeat Yourself)**
- ストレージロジックは1箇所に集約
- キーバインディングの登録が1行で完結

### 2. **簡潔性**
- コンポーネントコードが冗長にならない
- `useKeyBinding` フックで宣言的に記述

### 3. **拡張性**
- 新しいストアを簡単に追加可能
- 新しいキーバインディングは `DEFAULT_BINDINGS` に追加するだけ

### 4. **型安全性**
- TypeScriptでフル型付け
- ストア名は列挙型で管理

### 5. **パフォーマンス**
- メモリキャッシュで高速アクセス
- IndexedDBで永続化
- 自動期限切れクリーンアップ

### 6. **ユーザビリティ**
- プラットフォーム自動判定
- 設定画面でカスタマイズ可能
- 重複検出とエラー表示

## 今後の拡張例

### 新しいストアの追加

```typescript
// src/engine/storage/index.ts
export const STORES = {
  TRANSLATIONS: 'translations',
  KEYBINDINGS: 'keybindings',
  USER_PREFERENCES: 'user_preferences',
  RECENT_FILES: 'recent_files', // 追加
} as const;
```

### 新しいキーバインディングの追加

```typescript
// src/hooks/useKeyBindings.ts
export const DEFAULT_BINDINGS: Binding[] = [
  // ... existing bindings
  { id: 'toggleTerminal', name: 'Toggle Terminal', combo: 'Ctrl+`', category: 'view' },
];

// 使用例
useKeyBinding('toggleTerminal', () => {
  toggleTerminal();
}, [toggleTerminal]);
```

## まとめ

この実装により、以下が実現されました:

✅ **統一されたデータ管理**: `pyxis-global` IndexedDBで全データを一元管理  
✅ **高速なキャッシュシステム**: メモリ + IndexDBの二層キャッシュ  
✅ **プラットフォーム対応**: Mac/Windows/Linux で自動的に適切なキーを使用  
✅ **簡潔な実装**: どのコンポーネントからも1行でショートカット登録可能  
✅ **ユーザーカスタマイズ**: 設定画面で自由にキーバインディングを変更可能  
✅ **拡張性**: 新しい機能追加が容易  

開発者は `useKeyBinding` フックを使うだけで、プラットフォーム対応やストレージ管理を意識する必要がありません。
