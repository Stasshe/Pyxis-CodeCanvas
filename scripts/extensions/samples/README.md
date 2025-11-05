# __EXTENSION_NAME__

__EXTENSION_DESCRIPTION__

---

概要

このディレクトリは、`__EXTENSION_NAME__`（ID: `__EXTENSION_ID__`）拡張機能用のテンプレート README です。
このファイルはテンプレートとして使用され、`create-extension.js` 実行時にサンプルの README をコピーして使用します。
プレースホルダはダブルアンダースコアで囲まれた大文字トークン（例: `__EXTENSION_NAME__`）になっており、実際の値で置換されます。

使い方（開発者向け）

1. 拡張機能ディレクトリへ移動

```bash
cd extensions/__EXTENSION_ID__
```

2. 依存関係を追加 (必要に応じて)

```bash
# ルートプロジェクトに pnpm がある想定
pnpm install
# ローカルで個別に依存を管理したい場合
pnpm add <package-name>
```

3. 開発/ビルド

```bash
# ビルド（プロジェクトルートでの実行が必要な場合があります）
node build-extensions.js

# 起動（プロジェクトに合わせてコマンドを変更）
pm run dev
```

ファイル構成（例）

- `index.__FILE_EXTENSION__` - メインエントリポイント（テンプレート済み）
- `manifest.json` - メタデータ（ID, name, version 等）
- `README.md` - このファイル
- `package.json` - （`pnpm` 使用時に生成されることがある）

コードサンプル（簡単な index ファイルの例）

```js
// index.__FILE_EXTENSION__
// プレースホルダ: __COMPONENT_NAME__ や __EXTENSION_NAME__ を使用してテンプレート注入されます
console.log('This is the __EXTENSION_NAME__ extension (id: __EXTENSION_ID__)');

export function activate(context) {
  // 初期化コード
}

export default {};
```

よくある注入プレースホルダ

- `__EXTENSION_ID__` — 小文字ハイフン形式の ID
- `__EXTENSION_NAME__` — 表示用の名前
- `__EXTENSION_DESCRIPTION__` — 説明文
- `__FILE_EXTENSION__` — `ts` / `tsx` など
- `__COMPONENT_NAME__` — キャメルケース化されたコンポーネント名

必要に応じてこのテンプレートを編集してください。

License: MIT
