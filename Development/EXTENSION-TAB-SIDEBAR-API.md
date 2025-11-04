
# Extension Tab & Sidebar API（2025年最新版）

Pyxis拡張機能のカスタムタブ・サイドバーパネル追加APIの最新仕様です。

---

## 設計原則

1. **最小権限**：自分の拡張機能が作成したタブ/パネルのみ操作可能
2. **型安全・TSX推奨**：TypeScript/TSXで型安全・直感的なUI記述
3. **CLIテンプレート生成**：`pnpm run create-extension`で自動生成が標準
4. **npmライブラリ完全対応**：`pnpm install`で外部ライブラリ利用可能
5. **Terminalコマンド拡張**：独自コマンドをAPIで追加可能

---


## Tab API（カスタムタブ）

### 役割
- **タブ**は「エディタ領域」に表示される独立したウィンドウ。VSCodeのタブと同じ。
- 複数同時に開ける。各タブは独自のID・タイトル・データを持つ。

### 基本フロー
1. `context.tabs.registerTabType(Component)` でタブコンポーネント登録
2. `context.tabs.createTab({ ... })` でタブ作成
3. `context.tabs.onTabClose(tabId, cb)` でクローズイベント
4. `context.tabs.updateTab(tabId, { ... })` でタブ更新
5. `context.tabs.closeTab(tabId)` でタブを閉じる

### 型・props
- `tab: { id, title, icon, data, ... }`（タブ情報）
- `isActive: boolean`（アクティブ状態）

### 実装例（TSX推奨）
```tsx
function MyTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  // ...タブのUI
}
```

### API例
```typescript
context.tabs.registerTabType(MyTabComponent);
const tabId = context.tabs.createTab({
  id: 'main',
  title: 'My Tab',
  icon: 'FileText',
  closable: true,
  activateAfterCreate: true,
  data: { count: 0 },
});
context.tabs.onTabClose(tabId, () => {/* クリーンアップ */});
```

---

## Sidebar API（レフトサイドバー・パネル）

### 役割
- **サイドバーパネル**は「レフトサイドバー」に表示される独立したUI領域。VSCodeのエクスプローラーやGitパネルと同じ。
- パネルは1つの拡張につき複数追加可能。各パネルはID・タイトル・状態を持つ。

### 基本フロー
1. `context.sidebar.createPanel({ ... })` でパネル追加
2. `context.sidebar.onPanelActivate(panelId, cb)` でアクティブイベント
3. `context.sidebar.updatePanel(panelId, state)` で状態更新
4. `context.sidebar.removePanel(panelId)` で削除

### 型・props
- `extensionId: string`（拡張ID）
- `panelId: string`（パネルID）
- `isActive: boolean`（アクティブ状態）
- `state: any`（パネル状態）

### 実装例（TSX推奨）
```tsx
function MyPanel({ extensionId, panelId, isActive, state }: any) {
  // ...パネルのUI
}
```

### API例
```typescript
context.sidebar.createPanel({
  id: 'my-panel',
  title: 'My Panel',
  icon: 'Package',
  component: MyPanel,
  order: 50,
});
context.sidebar.onPanelActivate('my-panel', () => {/* ... */});
```

---

## Terminalコマンド拡張

```typescript
context.terminal?.registerCommand({
  name: 'hello',
  description: 'Hello Worldを表示',
  args: [{ name: 'name', type: 'string', required: false }],
  handler: async ({ name }) => `Hello, ${name || 'World'}!`,
});
```

---

## ベストプラクティス

- activate関数で必ずタブ・パネル登録
- クローズ/アクティブイベントでリソース管理
- npmライブラリはpnpm installで追加
- UIはTSX推奨
- props型・API仕様は必ず公式サンプル・types.ts参照

---

## トラブルシューティング

- タブ/パネルが表示されない→activateで登録漏れ・ID重複・props型ミスを確認
- データが保存されない→localStorageやIndexedDBの永続化処理を追加
- npmライブラリが使えない→package.json・pnpm install漏れを確認

---

## 参考・APIリファレンス

- `/extensions/README.md`（最新仕様・サンプル）
- `_shared/types.ts`（型定義）
- サンプル拡張機能（note-tab, todo-panel, chart-extension等）

---

## まとめ

Pyxis拡張機能のTab/Sidebar APIは2025年現在、CLIテンプレート生成・TSX推奨・npmライブラリ完全対応・Terminalコマンド拡張・型安全・イベント駆動設計が標準です。
些細なprops型・イベント・ID管理ミスも許されません。公式サンプル・型定義を必ず参照し、最新仕様で実装してください。
