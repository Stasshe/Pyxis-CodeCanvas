# Storage再設計 INTENT

## 背景
- Node runtimeは同期の`require`と`fs.*Sync`を必要とする。今は実行前に依存を静的解析し、全fileをmemoryへpreloadしている。そのため動的`require`（変数やevalで組み立てたpath）が解決できない
- file本体がIDB(`PyxisProjects.files`)とlightning-fs(`pyxis-fs`)に二重に書き込まれ、`syncManager`が同期している。書き込みは2倍になり、同期ずれも起きうる
- pathが3形式ある（AppPath `/src/a.ts` / FSPath `/projects/<name>/src/a.ts` / GitPath）。形式間の変換が全層に散らばっている
- OPFSのpath lookupはancestorを順に解決する。Node module preloadは兄弟fileを連続して読むため、同じroot-to-parent探索がFS service時間に繰り返し現れる。保持量を増やさずこれを避けるため、直近のdirectory handle chainだけを再利用する
- 制約: Safariに対応する必要がある。WebPreviewのiframeは同一originの`document.write`で、ユーザーHTML内の外部CDN・画像を読み込む

## 判断
- **同期手段 = 同期XHR + Service Worker**。SharedArrayBufferにはCOOP/COEPが必須。COEPは同一originのiframeにも継承され、外部resourceを遮断する。Safariは`credentialless`に対応していないので回避できない。同期XHRはWorker内なら許容され、COEPも要らない
- **runtimeはWorkerで動かす**。同期XHRで止まるのが呼び出したthreadだけになり、UIが固まらない
- **同期要求はSWからFS Workerへ直結する**。SWがFS WorkerのMessagePortを保持し、再起動後はmainからportを再取得する。main busy中もファイルI/Oを待たせないため
- **transpile poolはFS Workerが所有する**。必要時のみ1 Workerを起動して、30秒idle後に破棄する。FS Worker内で順序を保ち、wasmを複数Workerに常駐させない
- **runtimeのfile accessと変換cacheはFS Workerに集約する**。Runtime Workerには実行内module cacheだけを置き、file bytesと変換結果はFS WorkerのOPFS境界で扱う。非同期先読みと同期`require`で同じresolverの成功結果を共有し、所有権を増やさず未解決候補のRPCを抑える
- **module graphは同期性を保つ**。top-level awaitを持つESMとその静的依存だけをasync evaluationにし、依存の完了後にimporterを進める。通常のESMとCommonJSは同期のままにし、`require`からasync ESM graphを実行しない。これにより既存の同期CommonJS契約とNodeのawait順序を両立する
- **Runtime Workerは先行起動して使い回す**。Worker起動は1回25〜32msかかり、短いscriptではmain比で約10倍遅くなった（実測）。待機Worker 1つのメモリと引き換えに起動待ちを消す。正常完了時は実行状態を破棄してWorkerを待機へ戻し、停止・異常終了時はWorkerを破棄して補充する。同時実行で待機Workerがなければ追加し、終了時は待機Workerを最大1つに保つ。sloppy scriptのglobal代入と裸の識別子参照をNodeのWorker realmに合わせるため、program globalは実際のWorker globalへ置く。その値の次runへの残存は許容し、runtimeが設定する一時descriptorはdispose時に復元する。module cache、timer、process listener、stdinなど実行単位の状態は毎回破棄する
- **メモリはpage全体で400MB以内**。PyxisはIDEで、Stassheのprogramとbrowserの他のtabにメモリを残す必要がある。Workerは増やすほど、それぞれに読み込んだcodeやwasmの分だけメモリを食う。だから常駐Workerは増やさず、必要な並列処理は既存FS Worker内でboundedに行う
- **OPFSを唯一のfile置き場にする**。目的は二重管理の根絶。file payloadはraw bytesとして保存・移送し、text decodingは明示した読込境界に限る。isomorphic-gitがworktreeと`.git`を同じFSから直接読むので、`.gitignore`による同期フィルタも要らなくなる
- **`/`から始まるFSを1つ、project = folder（VS Code型）**。Nodeと同じPOSIX path APIを共通実装として使い、normalize・resolve・relative等の字句処理を各サブシステムで再実装しない。絶対pathを正規化する関数と、明示したcwdから相対pathを解決する関数を分け、FSとruntimeではcwdを暗黙にしない
- **path解釈とshell展開は別責務**。path utilityはPOSIX字句処理を担い、`~`・glob・quote・変数展開を行わない。shell parserは構文だけを解析し、shell実行層が各commandの実行直前に一度だけwordを展開してFS APIへ渡す。展開結果を構文として再解析せず、同じ行の先行assignmentや終了statusを後続commandの展開へ反映する。FS traversalはsymlinkを解決するまでraw componentを保ち、`link/..`はtarget traversal後に評価する。これによりNodeの`fs`とterminalのpath意味論を揃える
- **端末上の編集位置・文字境界・表示幅を分離する**。文字列offsetはUTF-16、編集単位はgrapheme、画面位置はterminal cellであり、これらを同じ座標として扱わない。表示幅はxtermのactive Unicode providerと共有し、別の幅定義によるcursor・viewport・実描画のずれを防ぐ
- **fileの識別子 = 絶対path**。OPFSのentryには任意の属性を付けられない。idを別に管理すると二重管理が再発する
- **permission metadataはpayloadから分け、canonical absolute pathで永続化する**。OPFSに任意属性はない一方、`stat`・`access`・rename後もmodeを同じentryへ結び付ける必要がある。通常pathのmodeはIDBを正本にし、`/tmp`だけはmemoryに置く
- **symlinkはFS Worker管理の仮想entryとして表す**。Nodeのfs・module・npmが同じlink semanticsを共有するため、OPFSにないsymlinkをreserved root `.pyxis-fs-links`のpath-keyed recordとして永続化する。recordを正本にし、file payloadはraw bytesのまま保つ。Workerのmetadata Mapはlookup用indexに限り、`/tmp`のlink recordは揮発領域に置く
- **FIFO名はfilesystem namespaceに属し、stream dataは実行時だけ存在する**。通常pathのnamed FIFOはFS Workerのrecordで永続化し、`/tmp`のname・全FIFO bytes・open endpointは揮発させる。process間streamをpersistent file payloadと混ぜず、bounded memory queueとendpoint lifecycleをFS Workerで一元管理する
- **mountのbackingはroot metadataで表す**。`ProjectFile.mount`で`memory`と`devices`を区別し、system resetがmemory mountを空にしてdevice mountを保つ。resetをpathごとの例外規則にせず、FSが返すmount metadataを基準にする
- **配置はLinuxのFHS・XDGに従う**（`HOME=/home/pyxis`、新規workspace `~/<name>`、runtime cache `~/.cache/pyxis`、npm cache `~/.npm`）。`/`直下にuser folderとsystem directoryを混ぜず、shell・Node・npmがHOME基準で期待する配置を使う。既存folderは名前にかかわらず開け、旧projectの移行destinationが既存ならsuffixで避けずに停止する
- **workspaceの外へのアクセスは自由**。terminal・runtimeの挙動を実際のNode・shellに一致させる
- **OPFSに書き込むのはFS Workerだけ**。SyncAccessHandleは排他lockなので所有者を1つに絞り、path単位でoperationをqueueしてopen→operation→closeに保つ。変更eventも1か所から出せる
- **FS Coreは直近の成功pathのdirectory handle chainだけを再利用する**。共通ancestorの探索を省き、保持量を1 chainに抑える。Core再初期化とdirectory削除はchainを無効化し（directory renameはsource削除時）、古いin-flight lookupはchainを更新できない。file handleや内容はcacheせず、OPFSを唯一のpayload保管先に保つ
- **file I/Oはmainから外す**。gitやnpm installは1回の操作でfsを数千回呼ぶ。だからFS Workerと同じ場所で動かし、message往復をなくす。mainはUIと中継だけにする
- **npm installは配布file bytesを保存する**。install時にruntime変換を混ぜず、packageの元の内容を保つ。module formatの判定と必要な変換はNode実行時のpackage条件に基づいて行う
- **npm installは依存解決の待ち時間を隠しつつ、再現性と記憶量を保つ**。依存graphのpackage配置をlockfileで固定すれば、registry metadataの鮮度に左右されず同じ解決結果を再利用できる。manifest変更後はcompatible lock entryを優先し、fresh range resolutionは[npm-pick-manifest](https://github.com/npm/npm-pick-manifest/blob/main/lib/index.js)に沿ってrange内の`latest` dist-tagを優先してから最大satisfying versionへ進む。異なるtransitive versionにはNodeと同じnested placementが要る。展開済みgraph全体のpayloadやbrowserで使えないnative optional packagesはpage全体400 MBの目標を圧迫しうるため、bounded concurrency、tar entry単位の書き込みbackpressure、`os` / `cpu` metadataによるtarget判定で同時保持量と不要payloadを抑える。archive integrityはOPFSへ書く前に確認し、破損bytesを永続化しない。単独FS Worker所有とSyncAccessHandleのopen-operation-closeは維持する
- **metadataはIDBに残す**。OPFSにはindexも任意属性もない。recent folders・root-scoped Quick Open MRU file paths・chat・tab状態・AIレビューのように、検索と属性が必要なものはIDBに置く
- **編集内容の保存先ごとに完了を確認してからtabを閉じ、workspaceを切り替える**。Stassheは非同期保存の待機中にも編集できる。fileのdirty状態とAI提案draftの未保存状態を分け、全保存先の最新内容が確定するまで再確認する。失敗時はbufferと旧workspaceを保ち、UIとlogへ原因を出す
- **AI提案のdraftと適用済みbytesは別に保存する**。提案は適用後にも編集されるため、rollbackの照合対象は実際に書いたbytesで固定する。draftの保存は元messageの識別子も確認し、同じfileへの新しい提案を旧tabから変更しない
- **workspace切替でも未送信promptをroot別に保持する**。Stassheは質問を入力したまま別projectを参照する。ページ内のdraftは再mount時に復帰し、古い送信完了による消去はmount世代と入力revisionで拒む
- **workspace treeはfilesystem metadataのprojectionとして保つ**。Explorerの`FileItem`はpath・name・type・childrenだけを持ち、既存fileの内容更新は構造を変えない。既知のcreate/delete/rename metadataでtreeを更新し、未知subtreeだけを局所walkする。大きなworkspaceの各変更後にroot全体を再走査せず、全entryをtreeに反映する
- **失敗したnamespace変更も実状態を通知する**。OPFSのrecursive removeは部分削除後にrejectし得る。要求の失敗だけを知らせると、Explorerは消えたfileを残し、移動先に保ったコピーを隠す。対象subtreeのmetadata差で実際の削除を通知し、存在するentryを反映する。virtual symlink／FIFO recordは物理parentが残る場合だけ復元するため、消えたfolder配下に孤立recordを作らない
- **Gitの保存完了と後処理失敗を区別する**。merge commitはbranch refを進めた後にmerge metadataを消すため、cleanup失敗を単なるcommit失敗と扱うと再試行で履歴が重複する。HEADに保存済みのmerge parentを照合してcleanupを再試行し、後からstageされた変更は通常の子commitとして保存する。checkout完了後のref保存失敗は旧commitへ復元し、checkout自体の部分失敗とは別に扱う
- **途中失敗した複数entry操作の完全復元は保証しない**。checkoutのwrite失敗やrenameの部分失敗では、既存の回復処理が扱わない不整合を許容する。Stassheが完全復元を要件外と決定したため、全操作前状態の保存・復元を追加しない。単一file保存のbytes保護と失敗通知は維持する
- **HTMLのasset変換はHTML文法上の要素・属性を対象にする**。Stassheのscriptやコメントにも`src=`と同じ文字列が現れる。HTML5 parserをMarkdownと共有し、code文字列とresource属性を区別して変換することで、file payloadから作るpreview／exportに同じ解釈を適用する
- **ZIPには有限のfile payloadを保存する**。FIFO／deviceはprocessとの通信entryで、file readが終了しない場合がある。archive全entryを先に検証してpath付きerrorを返し、保存の無期限待機と、気付かないentry欠落を防ぐ
- **seed内容は`~/demo`に一度だけ置き、新workspaceは空にする**。新しいworkspaceごとにtemplateを複製すると、生成物が各workspaceの永続内容に混ざる。`~/demo`が無い場合だけ起動時に用意し、既にあるfolderの内容を保つ。seedは旧データ移行後、recent folders読込前に行い、移行済みデータとworkspace選択の順序を保つ
- **file検索・folder browsing・recent folder選択は1つのcompact OperationWindowの独立modeにする**。Quick Openはfile検索、Open Folderはpath navigationと明示的な確定、Open RecentはMRU選択に専念させ、browse結果とrecent folderを混ぜない。同じsurfaceを共有しつつ、各操作の対象と選択動作を保つ
- **旧データの移行は時限処理**。ユーザーデータはbrowser内にしかなく、失うと復元できない。移行codeは1か所にまとめ、2027-04を目安に削除する
