# Runtime storage refactor

この計画のruntime側の構成は実装済み。ここでは現行の責務境界と、まだ確認されていない実機・memory項目を記録する。設計理由は[Storage intent](./STORAGE_INTENT.md)、FS詳細は[Filesystem](../domain/filesystem.md)、移行の全体記録は[OPFS migration](./opfs-migration.md)を参照。

## 現行構成

Node.js runtimeはRuntime Workerで実行し、FS Coreを持つFS Workerへアクセスする。Runtime Workerは正常終了時に再利用poolへ戻り、異常終了またはterminate時は破棄する。idle Workerの上限は1。実行ごとにstdin、shell host、interrupt handlerなどを片付け、module実行状態を初期化する。

| 要求 | 経路 |
|---|---|
| 非同期FS・module読み込み | Runtime Worker → MessagePort → FS Worker |
| 同期FS・requireの同期解決 | Runtime Worker内の同期XHR → Service Worker → FS Worker port |
| shell実行・stdin | Runtime Worker → Service Worker → 所有tabのmain page host |
| module変換 | Runtime Worker → FS Worker endpoint → TranspileManager |

Service WorkerがFS Worker portを失うと、runtime要求時にwindow clientへport再送を依頼し、acknowledgement後に同期処理を再開する。main pageはRuntime Workerのfile I/Oを中継しない。同期XHRで停止するのはRuntime Workerであり、UI threadではない。

## 保存と変換

`RuntimeFsMount`はruntime bridgeの薄いadapterであり、project filesを保持しない。workspace、`node_modules`、Git data、runtime cacheはOPFSにあり、`/tmp`のみFS Workerの揮発領域にある。同期・非同期両方のfilesystem methodは同じFS Coreへ届く。

FS Workerは遅延起動する1 workerのtranspile poolを持つ。要求を直列化し、idle 30秒でworkerを終了する。変換cacheも`~/.cache/pyxis`配下に置き、入力内容・path・transform設定・compiler versionなどから作ったhashで再利用を判定する。npm install時にはarchiveのraw bytesを保存し、runtimeがmoduleを読む時点で必要な変換を行う。

## 旧runtime storageの移行状態

以前の全file preload、projectごとのruntime Map、lightning-fsとの二重保管は現行FS経路から除かれている。legacy IndexedDBからのcopy処理は`src/engine/core/migration/`に残り、migration完了後にlegacy databaseを削除する。移行codeの削除時期は2027年4月頃を目安とする。

## 未確認の検証項目

- Safari実機でDedicated Workerからの同期XHRがService Workerに届くこと。
- SafariでWorker内`SyncAccessHandle`とdirectory handleの挙動を確認すること。
- Service Worker再起動後、port再送とacknowledgementを経て同期FS要求が復帰すること。
- main threadがbusyでも、Service WorkerからFS Workerへの同期要求が完了すること。
- node_modules規模の大量小file tree walk性能を測ること。
- 同期XHR 1往復の時間と、require連続解決時の影響を測ること。
- Safariを含む実機でpage全体400 MBの目標を計測すること。

これらの実測値はまだ記録されていない。実施後は[Development TODO](../../Development/TODO.md)の項目と結果を更新する。
