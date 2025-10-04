# Pyxis Runtime - Client-side Module Runtime Architecture Specification  
*(Next.js / 完全クライアントサイド構成)*

---

## 🎯 目的

Pyxis Runtime は、**完全ブラウザ環境で npm モジュール・TypeScript ファイルを安全かつ軽量に実行**するためのランタイムである。  
Next.js アプリ内で動作し、サーバーは一切使用しない。  
主要な目的は以下：

- Node.js 互換の API 環境（`fs`, `path`, `process`, etc.）をブラウザ内に再現  
- New-Architecture に沿って、fsはfileRepository経由でアクセス
- npm install(node_modules/にインストール), builtin modules はすでに完成
- npm / TypeScript コードのオンデマンド実行  
- メモリ消費を最小化し、処理落ちを防ぐ  
- IndexedDB / Pyxis FS を用いたキャッシュ永続化  
- 初回起動時の重さは許容、実行中の安定性を最優先  

---

## 🧱
├── ModuleLoader
│        ├── Transpile Worker (SWC wasm)
│        ├── CJS→ESM Converter
│        ├── Cache Manager
│        ├── GC Worker
│        └── LRU Metadata 
---

## ⚙️ 処理プロセス概要

### 1️⃣ 起動フェーズ
1. Next.js ページロード完了時に `PyxisRuntime.init()` 実行  
2. Builtin modules (`fs`, `path`, `process` など) を `vm-browserify` の global 環境へ注入  
3. IndexedDB ベースの FS が初期化され、キャッシュ領域 `/cache/modules` がマウント  
4. `TranspileWorkerPool`（SWC wasm）をロード（初期化は重いが一度だけ）

---

### 2️⃣ モジュール読み込みフェーズ

#### (A) ESM または JS ファイルのロード
- `require()` / `import()` 呼び出しを ModuleLoader がフック  
- ファイルパス解決（Nodeライクに `resolve()` 実装）  
- ファイル内容を `fs.readFile()` で取得  
- `.ts` / `.tsx` / `.jsx` → TranspileWorker へ送信  

#### (B) CJS ファイルの処理
- ModuleLoader が CJS を検出 (`module.exports` / `require()` 構文)  
- TranspileWorker 内で SWC により **CJS→ESM 変換**  
  - 正確な AST 変換（正規表現ではなく）  
- 変換結果を `/cache/modules/<hash>.js` に保存  
- メモリ上から削除（RAM節約）

---

### 3️⃣ トランスパイルフェーズ（Transpile Worker）
- 各変換は独立した WebWorker インスタンスで実行  
- 完了後、即 `terminate()` してメモリを解放  
- SWC wasm は Worker 内にロードされるため、  
  メインスレッドのヒープに影響しない  
- 出力:
  - `code` (ESM)
  - `sourceMap` (オプション)
  - `meta.json` (依存関係・hash)

---

### 4️⃣ キャッシュフェーズ
- 変換後のファイルを FS に保存:
  - `/cache/modules/{hash}.js`
  - `/cache/meta/{hash}.json`
- メタには以下情報を記録：
  ```json
  {
    "originalPath": "/node_modules/lodash/index.js",
    "hash": "d41d8cd98f...",
    "mtime": 1728300000,
    "deps": ["path", "fs"],
    "size": 12456,
    "lastAccess": 1728301000
  }

実行フェーズ（vm-browserify）
	1.	依存解決済みのコードを文字列でロード
	2.	vm-browserify.runInNewContext(code, sandbox) を実行
	3.	sandbox 内には builtin modules が注入済み
	4.	実行結果を module.exports 経由で返却
	5.	メモリは vm コンテキスト単位で閉じる


  GC フェーズ（バックグラウンド）
	•	GC Worker が定期的に /cache/modules を走査
	•	総容量が上限（例：100MB）を超えた場合：
	•	meta ファイルを lastAccess 昇順にソート
	•	古いものから削除
	•	削除は FS のみ、メインスレッドには影響しない
	•	通知イベント onCacheEvict を発火可能



  VM Sandbox
実行環境（vm-browserify）
グローバル注入済みBuiltinを使用
ModuleLoader
依存解決・変換指示・キャッシュI/O
Nodeのrequire互換を簡易実装
Transpile Worker
TypeScript / CJS→ESM 変換
SWC wasmを内包。変換後terminate
Cache Manager
変換結果の保存・読込・更新
FS API使用、BlobやURLを使用しない
GC Worker
古いキャッシュ削除
LRU戦略・完全非同期
FS Layer
統一的ファイルAPI
IndexedDB-backed（Pyxis独自）
Builtin Layer
Node標準API互換
fs, path, process, buffer, etc.



すべての重い処理（transpile, GC, network fetch）は Worker にオフロード
	•	メインスレッドは UI と vm 実行のみを担当
	•	ランタイム全体の RAM フットプリントを 常時一定（±数MB） に保つ




動作基盤
完全クライアントサイド (Next.js + vm-browserify)
型チェック
Monaco Editor に委譲
変換エンジン
SWC wasm（Worker内）
CJS互換
完全AST変換＋永続キャッシュ
実行環境
vm-browserify + Builtin注入
キャッシュ方式
FSベース永続＋GC Worker
優先設計思想
メモリ安定性 ＞ 起動速度 ＞ 実行速度
