# OPFS移行計画

判断理由は `STORAGE_INTENT.md`。一括で移行する。

## 目標構成

```mermaid
graph LR
  subgraph Main
    UI[UI and xterm and Editor]
    Cmd[Shell and Unix Parse]
    Client[FS Client]
  end
  subgraph FSWorker[FS Worker]
    FSCore[FS Core]
    Git[isomorphic-git]
    Npm[npm install]
    Search[Search]
  end
  RT[Runtime Worker]
  TP[Transpile Worker Pool]
  SW[Service Worker]
  UI --> Client
  Cmd --> Client
  Client -->|comlink| FSCore
  Git --> FSCore
  Npm --> FSCore
  Search --> FSCore
  FSCore --> OPFS[OPFS root]
  FSCore -->|change events| Client
  Client --> Meta[IDB metadata]
  RT -->|sync XHR| SW
  SW -->|MessagePort fs and transpile| FSCore
  SW -->|shell and stdin only| Client
  Client --> TP
```

file I/Oに関わる処理はmainに置かない。mainはUI・軽い処理（shellやunixコマンドのparse）・Worker間の中継だけを担う。

| 実行場所 | 担当 |
|---|---|
| main | React UI、xterm、エディタ、shell・unixコマンドのparse、FS Client、同期RPCの中継 |
| FS Worker | OPFSの唯一の所有者。git・npm installの書き込み・検索もここで動かす（大量のfs呼び出しにmessageの往復を挟まないため） |
| Runtime Worker | Node runtime。同期XHRで止まるので、FS Workerとは必ず別にする（同じWorkerだと自分自身を待ってdeadlockする） |
| Transpile Worker Pool | 既存のWorkerPool。1 Workerに固定し、使われなければ破棄する（メモリ予算を参照） |
| Service Worker | 同期XHRを捕まえてmainへ中継する |

- SyncAccessHandleは「開く→操作→閉じる」で使い、開きっぱなしにしない
- FS Client: API・変更eventの購読口・metadataへのアクセスを提供する。現行の`fileRepository`を置き換える
- API: Node fs風のpath基準（readFile / writeFile / readdir / stat / mkdir / rm / rename）。runtimeの`fsModule`とunixコマンドは同じIFを使う
- 拡張機能はmainで読み込む（現状維持）

## Pathモデル

- 絶対path1形式。AppPath / FSPath(`/projects/<name>`) / GitPathとその変換（`pathUtils`の大半）を廃止
- workspace root = 開いたfolder。`projectStore`は「project ID・名前」ではなく「root path」を持つ
- file tree = root配下だけ。terminal・runtimeは`/`全体にアクセスできる
- 予約path: `/tmp`（MemoryMount、揮発）、`/cache`（runtime cache。OPFS上のdirectoryにする）

## Storage配置

| 対象 | 移行後 |
|---|---|
| file本体・`.git`・node_modules | OPFS |
| projects store | recent folders（key = root path） |
| `pyxis-global`の tab_state / chat_spaces / ai_reviews | keyをprojectIdからroot pathに変更 |
| `ProjectFile`のAIレビュー関連field | ai_reviewsへ統合し、file entryから外す |
| `PyxisProjects.runtimeCache` | OPFSの`/cache` |
| `pyxis-fs`(lightning-fs) | 削除 |
| `PyxisAuth`、translations / keybindings / user_preferences / extensions | 変更なし |

`ProjectFile`はpath・種別・size・mtimeを持つだけの純粋なFS entryにする。`id` / `projectId` / `parentPath`は廃止。

## Git

- isomorphic-gitはFS Worker内で動かし、fsはFS Coreを直接使う
- `gitFileSystem.ts` / `syncManager.ts` / lightning-fsへの依存を削除。`.gitignore`による同期フィルタも不要
- `gitOperations/*`（push・TreeBuilder等）のpath変換箇所を書き直す

## UI

- project選択をOpen Folder + recent一覧に置き換える。project作成 = mkdir + open
- WebPreviewTab: `getProjects()`・`/projects/<name>`接頭辞の除去・`projectId`によるevent絞り込みをやめ、絶対pathで扱う
- Markdownの`LocalImage`: `projectName` / `projectId`を渡す代わりに絶対pathを渡す

## Extensions

- context APIの`fileRepository`をpath APIに置き換える。対象: react-preview / todo-panel / _shared / sample-command / python-runtime / binary-editor
- `docs/HOW-TO-CREATE-EXTENSION.md`・`EXTENSION-SYSTEM.md`を更新

## 旧データ移行（時限・2027-04目安で削除）

- 起動時に1回だけ実行。完了flagをIDBに保存する
- 旧project `<name>`は`/<name>`へコピー。worktreeはPyxisProjects.filesから、**`.git`はlightning-fs `pyxis-fs`の`/projects/<name>/.git`から**（gitの履歴はlightning-fsにしかない）
- chat・tab・ai_reviewsのkeyをprojectIdから`/<name>`に書き換える
- 予約名（`tmp` / `cache`）と衝突するprojectにはsuffixを付けて移す
- 旧DBの削除は、コピー後にfile数と内容の検証が通ってから。移行中は同一originのquotaを一時的に約2倍使う
- 失敗したらUIとlogに表示し、旧DBは残す
- 移行codeは1つのfolderにまとめ、本体から参照する箇所は1つだけにする

## Runtime

### 実行モデル
- `node`を1回実行するたびにRuntime Workerを1つ作り、終了したら破棄する。グローバル変数とモジュールのキャッシュは実行ごとに新しくなる。待機用Workerの事前起動はしない（メモリ予算のため）
- 呼び出し元（shellの`node`コマンド・`npmHandler`・`RunPanel`）は従来通り`runtimeRegistry` → `NodeRuntimeProvider`を使う。ProviderがWorkerを管理する
- Ctrl+C: `process.on('SIGINT')`に処理が登録されていればそれを呼ぶ。登録がない場合や同期XHRで止まっている場合は`worker.terminate()`し、exit code 130で終わる
- stdout / stderr / console・debugConsoleは`postMessage`でまとめて流す
- python-runtime拡張のRuntimeProviderはmainのまま（範囲外）

### fsの経路
- 非同期（`fs.promises`等）: Runtime WorkerとFS Workerを`MessageChannel`で直接つなぎ、mainを通さない
- 同期fs: 同期XHR → SW → FS Worker。mainを経由しない（main busy時にRuntimeが止まらないため）。`sync-message`を使う
  - SWはFS Workerへの`MessagePort`を保持する。mainが起動時にportを渡し、SWが再起動で失ったらmainへ再送を要求する
  - mainを経由するのはshell（`execSync`）とstdinだけ
- 複数tabは非対応（単一tab前提）。2つ目のtabはWeb Locksの取得に失敗したらエラー表示して止める
- どちらもFS Workerだけが実際に書き込むので、内容の食い違いは起きない
- SW未制御（Shift+reloadなど）を起動時に検出し、通常reloadを促すエラーを表示する

### 同期RPCで扱う操作
- fsの`*Sync`、`require`のパス解決
- transpile（esbuild-wasmは`transformSync`が使えない。拡張機能が提供するTypeScriptのtranspilerも同じ経路）
- `child_process.execSync` / `spawnSync`（mainのshellを呼ぶ）
- stdinの同期読み込み（`fs.readFileSync(0)`、`fs.readSync(0)`。terminalの入力行を待つ）
- 静的に分かる依存は従来通りasyncで先読みし、同期RPCは先読みで拾えなかったものだけに使う。1回のcallごとに数msの往復がかかるため、回数を抑える

### SW
- 必須にする。初回訪問時は1回reloadする。devでも有効にする（現在の`sw-register.js`はlocalhostでSWを解除している）
- `sync-message`を取り込むため、`public/sw.js`をバンドル対象に変える（`setup-build`でesbuildにかける）

### 保留
- `http.createServer`: SWで仮想的なserverとして実現できる可能性がある。今回は実装しない

## メモリ予算

page全体（main + 全Worker）を**400MB以内**に抑える（現状は約300MB）。ユーザーのprogram自身が使うメモリは予算に含めない。並列化で速度を買う設計にはしない。

- 減る: 実行のたびに行っていた全fileのpreload（node_modulesを含む）、ProjectMountのfile Map、lightning-fs
- 増える: FS Workerの常駐分、実行中のRuntime Worker
- Transpile Worker Pool: 現在は最大4 Worker（`WorkerPool.ts:146`）で、各Workerがesbuild-wasm（wasm本体14MB）を個別に読み込んでいる。**1 Workerに固定し、一定時間使われなければ破棄する**
- Runtime Worker: 実行中の分だけ存在させ、事前起動はしない
- 計測: `performance.measureUserAgentSpecificMemory()`はcross-origin isolationが必須なので使えない。Chromeのタスクマネージャー（Workerごとの内訳が見られる）とDevToolsのMemoryタブで、移行の前後を比較する
- ユーザーのprogramがメモリを使い切るのは許容する（browserのAPIで制限する手段もない）。Ctrl+Cでterminateすれば解放される

## 先行検証（Safari実機）

- dedicated WorkerからのrequestをSWが捕捉できるか（Runtime方式の前提）
- Worker内でのSyncAccessHandle、directoryの`FileSystemHandle.move()`対応
- 小さいfileが大量にある場合（node_modules）、tree walkの速度がIDBの`getAll`と比べてどうか
- SWが停止→再起動した後、`MessagePort`の再受け渡しを経て同期XHRが復帰するか
- main busy時にも同期fsが遅延しないか（SW → FS Worker直結の確認）
- 同期XHR 1回あたりの往復時間（`require`の連続解決で許容できるか）

## 影響範囲（2026-10-03時点）

- `fileRepository`を使っているfile: 73（unixOperations 12、shell 4、tabState 3、in-ex 3など）
- lightning-fs / `gitFileSystem`を参照しているfile: 26
- `projectId` / `currentProjectId`を参照しているfile: 113

## 作業順

1. 先行検証
2. FS Worker + FS Client + path API
3. git adapterと、lightning-fs系の削除
4. 利用箇所（cmd・runtime・tabs・components・extensions）の書き換え
5. Open Folder UIとprojectStoreの置き換え
6. 旧データ移行
7. Runtime Worker化と同期RPC
8. README・docs/（TWO-LAYER-ARCHITECTURE、CORE-ENGINE、DATA-FLOW、NODE-RUNTIME等）・CLAUDE.mdを更新
