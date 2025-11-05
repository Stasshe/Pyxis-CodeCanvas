# __EXTENSION_NAME__

__EXTENSION_DESCRIPTION__

---

## 概要

この拡張機能は、Pyxis プラットフォーム上で動作するカスタム機能を提供します。以下の手順に従ってセットアップしてください。

## セットアップ手順

1. **拡張機能ディレクトリへ移動**

   ```bash
   cd extensions/__EXTENSION_ID__
   ```

2. **依存関係のインストール（必要に応じて）**

   ```bash
   pnpm install
   ```

3. **ビルドと起動**

   ```bash
   # ビルド
   node build-extensions.js

   # 開発サーバーの起動
   pnpm run dev
   ```

## ファイル構成

- `index.__FILE_EXTENSION__` - 拡張機能のエントリポイント
- `manifest.json` - メタデータ（ID、名前、バージョンなど）
- `README.md` - このファイル

## 開発に関する注意点

- 必要に応じて `pnpm add <package-name>` を使用してライブラリを追加してください。
- ビルドスクリプト `node build-extensions.js` を実行して、拡張機能を登録してください。

## ライセンス

MIT
