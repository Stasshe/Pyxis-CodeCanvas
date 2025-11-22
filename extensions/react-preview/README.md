# react-preview



---

## 概要

この拡張機能は Pyxis プラットフォーム上で動作するカスタム機能を提供します。

## Template choices (作成時の選択)

- Extension ID: `react-preview`
- Name: `react-preview`
- Description: ``
- Author: `Pyxis Team`
- Extension type: `ui`
- Component type: `tab`
- Uses React: `yes`
- File extension: `tsx`
- Component name: `ReactPreview`
- Tags: `(none)`
- PNPM support created: `yes`
- Created at: `2025-11-22T04:52:11.928Z`

## セットアップ手順
> npmライブラリを使う場合で、Reactのみの場合は不要。依存がない場合も不要。

1. 拡張機能ディレクトリへ移動

```bash
cd extensions/react-preview
```

2. 依存関係のインストール

```bash
pnpm install
```

3. ビルドと登録

```bash
# 拡張機能のビルド
pnpm run setup-build

# 開発サーバー（必要に応じて）
# pnpm run setup-buildが自動実行されます
pnpm run dev
```

## よく使う開発フロー / Tips

- 小さなUIの追加や調整は `index.tsx` を編集します。
- 複数ファイルも対応しています。
- 外部ライブラリは `PNPM` を使って追加できます（テンプレートで `PNPM` を有効にした場合、`package.json` が作成されます）。
- UI 拡張（Reactを使う場合）は `ReactPreview` をエクスポートする形式で作ると既存の登録方法と整合しやすいです。

## ファイル構成（生成される典型例）

- `manifest.json` — 拡張のメタデータ
- `index.tsx` — エントリポイント（UI拡張なら React コンポーネントなど）
- `README.md` — このファイル
- `package.json` — （pnpm を有効にした場合に生成）

## 開発に関する注意点

- 依存関係を変更したら `pnpm install` を再実行してください。
- IndexedDBに保存するため、ホットリロードは影響しません。ExtensionPanelの、Updateボタンを押して手動更新してください。

## トラブルシュート

- 既存と衝突する ID を使うとエラーになります。ID は小文字英数字とハイフンのみにしてください。

## ライセンス

MIT
