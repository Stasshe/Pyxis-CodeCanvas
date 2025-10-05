# swc_async_require_plugin

SWC用 Rust製 AST変換プラグイン (wasm対応)

- import/export/require/dynamic import を async require形式に変換
- wasm-packでビルドし、JS/wasmから呼び出し可能

## ビルド方法

```sh
cd swc_async_require_plugin
wasm-pack build --release --target web
```

## 使い方 (JS側)

```js
import init, { process_plugin } from './pkg/swc_async_require_plugin.js';
await init();
const out = process_plugin(js_ast_json);
```

CI note: the workflow will copy the artifact into `src/engine/runtime/pkg/` when running JS integration tests, so tests can import `./pkg/swc_async_require_plugin.js` from the worker directory.

## 実装方針
- ASTノードごとに変換（VisitMut）
- import/export/require/dynamic importをawait __require__等に置換
- テストもRustで用意

## ローカルビルドと CI

ローカルでの開発とテスト手順:

```bash
cd swc_async_require_plugin
# テスト
cargo test

# wasm をターゲットにビルド
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --out-dir pkg --target web target/wasm32-unknown-unknown/release/swc_async_require_plugin.wasm
```

GitHub Actions ワークフロー `.github/workflows/rust-wasm.yml` を追加済みです。CIは `cargo test` を実行し、wasm-bindgenで生成した `pkg/` をアーティファクト `swc-async-require-plugin-pkg` としてアップロードします。

ワークフロー実行後、Artifacts からダウンロードし `pkg/` をワーカーやビルドに取り込んでください。

