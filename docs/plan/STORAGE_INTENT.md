# Storage再設計 INTENT

## 背景
- Node runtimeは同期の`require`と`fs.*Sync`を必要とする。今は実行前に依存を静的解析し、全fileをmemoryへpreloadしている。そのため動的`require`（変数やevalで組み立てたpath）が解決できない
- file本体がIDB(`PyxisProjects.files`)とlightning-fs(`pyxis-fs`)に二重に書き込まれ、`syncManager`が同期している。書き込みは2倍になり、同期ずれも起きうる
- pathが3形式ある（AppPath `/src/a.ts` / FSPath `/projects/<name>/src/a.ts` / GitPath）。形式間の変換が全層に散らばっている
- 制約: Safariに対応する必要がある。WebPreviewのiframeは同一originの`document.write`で、ユーザーHTML内の外部CDN・画像を読み込む

## 判断
- **同期手段 = 同期XHR + Service Worker**。SharedArrayBufferにはCOOP/COEPが必須。COEPは同一originのiframeにも継承され、外部resourceを遮断する。Safariは`credentialless`に対応していないので回避できない。同期XHRはWorker内なら許容され、COEPも要らない
- **runtimeはWorkerで動かす**。同期XHRで止まるのが呼び出したthreadだけになり、UIが固まらない
- **同期要求はSWからFS Workerへ直結する**。SWがFS WorkerのMessagePortを保持し、再起動後はmainからportを再取得する。main busy中もファイルI/Oを待たせないため
- **transpile poolはFS Workerが所有する**。必要時のみ1 Workerを起動して、30秒idle後に破棄する。FS Worker内で順序を保ち、wasmを複数Workerに常駐させない
- **`node`の実行1回 = Worker 1つ**。無限ループでも`terminate()`で確実に止められる。グローバル状態も実行ごとに新しくなり、Nodeのprocessと同じ意味を持つ
- **メモリはpage全体で400MB以内**。PyxisはIDEで、ユーザーのprogramとbrowserの他のtabにメモリを残す必要がある。Workerは増やすほど、それぞれに読み込んだcodeやwasmの分だけメモリを食う。だから並列化で速度を買わず、常駐するWorkerを最小にする
- **OPFSを唯一のfile置き場にする**。目的は二重管理の根絶。isomorphic-gitがworktreeと`.git`を同じFSから直接読むので、`.gitignore`による同期フィルタも要らなくなる
- **`/`から始まるFSを1つ、project = folder（VS Code型）**。Nodeと同じPOSIX path APIを共通実装として使い、normalize・resolve・relative等の字句処理を各サブシステムで再実装しない。絶対pathを正規化する関数と、明示したcwdから相対pathを解決する関数を分け、FSとruntimeではcwdを暗黙にしない
- **path解釈とshell展開は別責務**。FS/runtimeのpath APIはPOSIXの字句処理だけを担い、`~`・glob・quote・変数展開を行わない。shell parserがコマンド入力を一度だけ展開してから、解決済みpathをFS APIへ渡す。これによりNodeの`fs`とterminalで同じpath文字列を別の意味に解釈しない
- **fileの識別子 = 絶対path**。OPFSのentryには任意の属性を付けられない。idを別に管理すると二重管理が再発する
- **配置はLinuxのFHS・XDGに従う**（`HOME=/home/pyxis`、新規workspace `~/<name>`、runtime cache `~/.cache/pyxis`、npm cache `~/.npm`）。`/`直下にuser folderとsystem directoryを混ぜず、shell・Node・npmがHOME基準で期待する配置を使う。既存folderは名前にかかわらず開け、旧projectの移行destinationが既存ならsuffixで避けずに停止する
- **workspaceの外へのアクセスは自由**。terminal・runtimeの挙動を実際のNode・shellに一致させる
- **OPFSに書き込むのはFS Workerだけ**。SyncAccessHandleは排他lockなので所有者を1つに絞る。変更eventも1か所から出せる
- **file I/Oはmainから外す**。gitやnpm installは1回の操作でfsを数千回呼ぶ。だからFS Workerと同じ場所で動かし、message往復をなくす。mainはUIと中継だけにする
- **metadataはIDBに残す**。OPFSにはindexも任意属性もない。recent folders・root-scoped Quick Open MRU file paths・chat・tab状態・AIレビューのように、検索と属性が必要なものはIDBに置く
- **seed内容は`~/demo`に一度だけ置き、新workspaceは空にする**。新しいworkspaceごとにtemplateを複製すると、生成物が各workspaceの永続内容に混ざる。`~/demo`が無い場合だけ起動時に用意し、既にあるfolderの内容を保つ。seedは旧データ移行後、recent folders読込前に行い、移行済みデータとworkspace選択の順序を保つ
- **file検索・folder browsing・recent folder選択は1つのcompact OperationWindowの独立modeにする**。Quick Openはfile検索、Open Folderはpath navigationと明示的な確定、Open RecentはMRU選択に専念させ、browse結果とrecent folderを混ぜない。同じsurfaceを共有しつつ、各操作の対象と選択動作を保つ
- **旧データの移行は時限処理**。ユーザーデータはbrowser内にしかなく、失うと復元できない。移行codeは1か所にまとめ、2027-04を目安に削除する
