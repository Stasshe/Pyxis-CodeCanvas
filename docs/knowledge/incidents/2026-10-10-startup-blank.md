# 起動時の無表示と初回SW reload

Stassheの`localhost:5173`で内容領域が背景色だけになり、別originの`localhost:5174`では点滅も報告された。DevToolsを開くと発生しなくなった。10月10日の`screen-capture`でもChrome本体の内容領域が背景色だけの状態を確認した。起動コード修正後もStassheからリロード時の再発報告があり、実タブの調査を継続した。修正で実際の症状が解消したとは判定していない。

## 実タブで確認したHTML読込前の停止

Chrome `155.0.8059.39`へStassheの許可でCDP接続した。browser側のtarget一覧・navigation historyは応答する一方、page側のDOM・Runtime要求は10秒以内に応答しなかった。targetのURL・titleはPyxisのまま、historyは1 entryで`reload`。SWはactivated、stopped、controlled clientなしだった。

`Page.setWebLifecycleState(active)`だけではDOM要求は応答しなかった。別の`tab` targetにattachすると、保留されていたDOM要求が返り、`documentURL`は空、`baseURL`は`about:blank`、HEAD・BODYは空、QuirksModeだった。その後、新しいPyxis文書が読み込まれ、全起動工程が完了した。Stassheは復帰直前に何も操作していない。これはFS初期化やmigrationを待つ空rootとは異なり、起動HTMLの読込前に止まっていた直接の証拠である。

使用中Chromeのrevision `3ff7ac5a9224be9156d7f8703a06e22890aafd34`の[WebContentsDevToolsAgentHost::AttachSession](https://github.com/chromium/chromium/blob/3ff7ac5a9224be9156d7f8703a06e22890aafd34/content/browser/devtools/web_contents_devtools_agent_host.cc)は、live render frameがなく未commit navigationもない場合、`SetNeedsReload()`→`LoadIfNecessary()`を呼ぶ。今回のtab attachによる復帰はこの経路と整合する。復帰後のNavigation Timingは`back_forward`、`document.wasDiscarded`はfalseだった。Memory Saver、旧DB、SW waitingを原因とは断定できない。

復帰後はstatus約56ms、first contentful paint 116ms、IDE mount約417ms。migrationは既に完了しており1ms程度、demoは既存で2ms程度だった。通常reloadでもstatus約34ms、IDE mount約369msを採取した。しかし別のreload後にはpage要求が再び応答せず、tab再attach時に`about:blank`が返った。Stassheはその間も操作していないと回答した。文書が失われるきっかけは未特定で、診断接続が復帰を起こすため、接続中の成功だけでは解決確認にならない。Chrome設定は変更していない。

続く通常reloadでは、描画を担当したrenderer PID `45743`が消え、browser PID `3950`と他rendererは生存、`screen-capture`でも内容領域が背景色だけに戻った。直前のbrowser trace計測中は同じreloadが成功し、計測終了・stream close後には再発した。traceによるタイミング変更の影響があるため、成功traceのframe detach記録を失敗時の終了理由へ読み替えない。Crashpadに今回の新しいdumpはなく、終了理由はまだ採取できていない。gdbのsignal捕捉はOSのptrace権限で拒否された。

Stassheがsudoでgdbを起動したが、接続時のログがページ送りで停止し、診断scriptに到達する前にChrome本体が一時停止した。案内したコマンドは接続前の`-iex 'set pagination off'`が不足していた。その後StassheがChromeを終了して開き直し、browser PIDは`52749`となってPyxisが表示された。元browserの終了はこの明示操作によるもので、先に起きたrenderer消失の原因へ読み替えない。終了signalの捕捉は未実施。

開き直したChromeでも、DevToolsを開かない通常reloadで時々背景色だけになるとStassheが回答した。Chrome再起動は解決確認にならず、追加の終了理由採取が必要。

接続前にpaginationを無効にしたgdbでbrowser PID `52749`の`kill`・`pidfd_send_signal`を監視した。tab attachによって空`about:blank`から復帰し、renderer PID `63742`が作られたが、続く通常reload・診断detach後に同PIDが消え、画面も背景色だけに戻った。その間、監視したbrowser syscallは記録されなかった。この監視ではzygote・renderer自身・外部processによる終了を捕捉できず、正常終了かsignal終了かは未確定。CDP接続は閉じた。その後Stassheの指示でsudo・gdb・ptrace・kernel logによる調査を中止し、sudo前提のPython手順も破棄した。

## 非sudoでの継続調査

### 実Chromeで採れたもの・採れていないもの

browser targetだけの接続で`Target.setDiscoverTargets`と`SystemInfo.getProcessInfo`を記録する手順へ変更した。page/tabへのattachは復帰を誘発するため、実Chromeには行っていない。しかし新しい接続はWebSocket handshakeが完了せず、03:19の`screen-capture`で実Chromeの「Allow remote debugging?」ダイアログと、その背後の背景色だけの内容領域を確認した。接続を閉じ、ダイアログ・Chrome設定・起動flagは操作していない。実Chromeの`targetCrashed.status/errorCode`と終了時のPID対応は今回も未採取。

`journalctl --user -b -f`では専用Chrome scopeの起動通知だけを採取し、実Chromeの終了理由を示すstderrは得られなかった。Claudeからは以前のChrome stderrはINFOだけ、新しいCrashpad dumpもないと報告された。これは正常終了を確定する証拠ではない。正常終了→旧renderer消失→新navigation未commitという仮説は、終了statusと失敗navigationの記録が得られるまで仮説として扱う。

使用中Chromeではbrowser targetへの`ServiceWorker.enable`は`-32601`で未実装だった。別profileのpage targetでは利用できた。実ChromeのSW状態を採るためにpage attachを追加せず、browser側のtarget通知だけに限定する方針だった。

Stassheから同じ許可ダイアログを繰り返さないよう指摘を受け、この実Chromeへの接続経路は打ち切った。以後の検証はagent-browserの専用profileで行い、実Chromeの設定変更・再許可を前提にしない。

### 旧document終了のコード経路

`RuntimeBridge`、`sync-message`実装、SW全体、`NodeRuntimeProvider`、runtime/transpiler Worker pool、Worker本体、FS endpoint/Core、Terminal初期化・復元を読んだ。下表は成立条件と、HTML読込前の停止を説明できるかを分離したもの。migration等の新document側の工程は、後述の起動経路表を参照。

| 経路 | 成立条件・終了処理 | 残る推論 |
|---|---|---|
| Terminal復元 | sessionはpane・UI・履歴を保存する。Terminal初期化はshell/registry作成と案内表示で、以前のnode REPL・vim・commandを再実行しない | 復元だけで同期stdin/FIFO待ちが始まる経路はない。前documentで実行中だった場合とは区別する |
| runtime prewarm | AppInitializerがTerminal表示とは独立してWorker poolを準備。idle Workerはmodule読込後readyを返す | start前にRuntimeBridge・FS RPCを作らず、prewarmだけでSW同期XHRが始まる経路はない |
| 非同期stdin | `process.stdin`のlistenerがあり入力がない実行。通常のMessagePort待ち | 返答待ちはJS threadを占有しない。normal finish/disposeならlistener・pending stdin・host callを解除する |
| 同期stdin・shell | `fs.readFileSync(0)`や同期child_process。Workerの同期XHR→SW→owner pageへのhost call | owner返答に期限がなく、pageが終了して返信しなければ旧callが残り得る。pending Promiseだけで通常navigationのfetchを待たせるコードはない |
| FIFO同期open/read/write | peer不足、空buffer、書込buffer満杯等。Workerの同期XHR→SW→FS endpoint | intentionalなpeer待ちは無期限。normal finishでownerのFIFOを閉じるが、document終了時は明示disposeをawaitせずbrowserのWorker破棄に依存する |
| SWのFS port取得 | SW停止・更新でportがない場合だけ`getFsPort()`。window clientへ要求し最大30秒 | cached portのpeer消失はmessageerrorになるとは限らず、旧portのrequestは残り得る。新pageは新portを送るが、旧pendingがあればretired portを保持する |
| 同期RPCのtimeout | peer待ち以外は`readMessage(..., {timeout:120000})`。sync-messageは/readへの同期XHRの間に期限を確認 | Pyxisの/read handlerはrequest中のpoll timeoutを読まずoperation完了までawaitする。そのため120秒はXHR自体を強制終了する期限ではない。この別の待機問題と、今回のHTML前停止との因果は未確認 |
| SWの通常navigation | URLが同期RPC prefixやiconでなければfetch handlerから同期的にreturn。HTMLをcache/`respondWith`しない | 旧callのPromise・port待ちをnavigationからawaitしない。大量JSONのparse/stringify等がSW threadを占有する場合の一時遅延は別条件 |
| OPFS read | fileごとのqueue→SyncAccessHandle→同期read→finallyでclose。handle取得後に別Promiseをawaitしない | file sizeによる同期処理時間はあるが、idleでhandleを保持する設計ではない |
| OPFS write | `createWritable`→write→closeでcommit、失敗時abort。Worker終了はbrowserに依存 | 作業中の終了順は検証対象。ただし新documentのFS initはHTML・main読込後であり、それ自体はHTML前の停止位置と一致しない |
| Web Lock | window側で`pyxis-fs-owner`を保持。明示closeはWorker terminateとlock release。document終了はbrowserが所有者を破棄する | 新pageで取得失敗なら`ifAvailable:true`が明示エラーを返す。旧owner残存による停止を起動HTMLの未読込へ直接結び付けない |
| transpile・CPU loop | runtime実行時だけtranspiler Workerを作る。同期JS/wasm処理中はmessageを受けられない。poolのdiscardはWorker terminate | module評価・長い計算は旧Worker終了の候補だが、復元・prewarmではtranspileを開始しない |

appにbeforeunload/pagehideで処理完了を待つhandlerはない。devで注入されるVite clientにはbeforeunloadがあるが、`willUnload = true`だけを実行する。WS切断後の復旧reloadを、このflagで抑止している。Viteのfull-reload・circular import更新失敗・error overlay後の初回更新には別のreload経路があるが、終了時にFS/runtime完了をawaitしない。

明示runtime finishはhost call中断・runtime-cancel・FIFO closeを行うが、windowのnavigationに同じcleanupを追加する処理もない。[使用中revisionのWorkerThread](https://github.com/chromium/chromium/blob/3ff7ac5a9224be9156d7f8703a06e22890aafd34/third_party/blink/renderer/core/workers/worker_thread.cc)は親context破棄でWorker終了を開始し、必要ならV8の実行を強制終了する。[XMLHttpRequest](https://github.com/chromium/chromium/blob/3ff7ac5a9224be9156d7f8703a06e22890aafd34/third_party/blink/renderer/core/xmlhttprequest/xml_http_request.cc)はcontext破棄時にloaderをcancelする。これらは終了処理の存在を示すが、今回のbrowser停止位置や競合の不在を証明しない。

### 別profileでのreload比較

agent-browserの専用profileでChrome本体と同じ`155.0.8059.39`を使用。別のClaude sessionと合わせてbrowserは最大2つ、検証は同一profileで逐次実施した。実Chromeの旧データは使っていない。

まずagent-browserの診断接続を保ったまま、下の8条件を各8回reloadした。UIのbuttonが現れ、HTMLのstartup-statusが消えるまで待って判定した。

| reload前の条件 | 回数 | reload指示からIDE mountまでの最大 |
|---|---:|---:|
| idle | 8 | 384 ms |
| 非同期stdin待ち | 8 | 380 ms |
| 同期stdin待ち（host call到達を確認） | 8 | 392 ms |
| FIFO openのpeer待ち | 8 | 503 ms |
| runtimeの無限CPU loop | 8 | 579 ms |
| READMEの同期readを100,000回実行 | 8 | 552 ms |
| ESMのtranspileを要求 | 8 | 609 ms |
| `/tmp`へ32MB writeを要求 | 8 | 664 ms |

64回ともIDEが起動した。ただしESMはreload前に完了済みの回もある。`/tmp`はmemory filesystemで、OPFS writeの検証ではない。agent-browserはpage・Worker・SWにもattachするため、この成功だけではDevToolsなしの条件を満たさない。

次に専用agent-browser daemonだけを終了し、専用Chromeを残した。page・Worker・SWすべての`attached:false`を確認して、pageへ一時接続してreload timerを設定→detach→timer発火→2秒後にIDE mountを確認した。browser targetのdiscovery/PID採取は継続し、tab targetにはattachしなかった。

- idleを30回、SWを停止してからのreloadを8回。全起動成功。
- 同期stdin host callの返答がまだない状態を8回。全起動成功。
- `/home/pyxis/demo`への64MB OPFS write Promiseが未完了の状態を8回。全起動成功。write commit前の中断はFS仕様どおりで、全bytes保存の成功を意味しない。
- runtimeの無限CPU loop中を8回。全起動成功。
- BottomPanelを非表示に保存して8回。復元後にxterm DOMがないこと、IDE mount成功を確認。runtime prewarm Workerは残るため「Workerなし」の比較ではない。

後半の3条件ではHTML responseStart最大6.4ms、domInteractive最大29.7ms、unloadEventStart/Endの差は0msだった。browser側の記録でrenderer PID集合は変わらず、`targetCrashed`もなかった。root接続・タイミング・headlessとagent-browser既定flagの影響は残るため、実Chromeで起きたrenderer消失を否定する結果ではない。競合する検証scriptを誤って重ねた区間は、この結果から除外した。

採取物は`/tmp/pyxis-reload-scenarios-mounted.jsonl`、`/tmp/pyxis-detached-*.jsonl`、`/tmp/pyxis-browser-watch-1791568955159.jsonl`。実Chromeの終了statusと失敗navigationが採れないまま根本原因を確定することはできず、この継続調査で本番コードの追加修正は行っていない。別profileのChrome・診断接続・journal followは終了済み。

### 描画付きChromeでの追加比較

同じ専用profileをagent-browserのheaded modeで開き、Chrome `155.0.8059.39`のWayland/GPU経路でも比較した。agent-browser daemonを終了してpage・tabへの接続を外し、reload準備時と完了確認時だけpageへ接続する方式は前項と同じ。browser targetだけの通知・PID採取は継続した。Stassheの実Chromeのflagは変更していない。専用Chromeにはagent-browser既定の`disable-hang-monitor`等があり、実Chromeと全条件が一致する検証ではない。

| reload前の条件 | 確認したreload数 | HTML responseStart最大 | domInteractive最大 |
|---|---:|---:|---:|
| idle | 20 | 6.7 ms | 25.3 ms |
| SW停止後 | 12 | 7.8 ms | 26.9 ms |
| 同期stdin待ち、host call到達・返答なし | 8 | 6.7 ms | 22.0 ms |
| demoへの64MB OPFS write Promise未完了 | 8 | 9.6 ms | 24.5 ms |
| runtime CPU loop、stdoutで実行到達確認 | 8 | 5.4 ms | 16.0 ms |

56回すべてIDE mountを確認し、各回でNavigation TimingのnavigationIdが変わった。最後のCPU比較はloop直前にstdoutを128回書き、runtime Workerのbuffer flushがmainへ届いて実行結果は未完了であることを確認した。計測中にrenderer PID集合の交代・`targetCrashed`はなかった。いずれもJavaScript起点の`location.reload()`であり、toolbar操作と同一条件とは扱わない。旧Worker終了・SW停止・OPFS commit前の中断だけで、今回のHTML前停止が必ず起きるという仮説を支持する結果は得られなかった。

Ctrl+Rも専用ウィンドウをPID・addressで指定して試したが、送信コマンドの成功と実際のnavigationは一致しなかった。複数回でnavigationIdが同一のため、その区間はreloadの成功・失敗件数から除外した。途中で見つかったIDE未起動状態は、それ以前の`application.tsx`のdynamic import失敗を明示するUIで、HTML・startup statusが存在した。これを新しいCtrl+Rの失敗や、実Chromeの空about:blankの再現へ読み替えない。

SW実コードをNodeのVMで実行する診断では、FS replyを返さず`/read`をpendingにしてから通常HTMLのfetch handlerを呼んだ。requestのpoll timeoutを1msにしても30ms後に/readはpendingだったが、HTML handlerは同期的にreturnし、`respondWith`しなかった。runtime-cancelで旧readが失敗応答として終了した。poll timeout無視は確認できた一方、VMではChromiumのnavigation・Worker破棄順を検証できない。これを根拠にHTML前停止の修正としてruntime timeoutを変更しない。

採取物は`/tmp/pyxis-detached-idle-1791597709058.jsonl`、`/tmp/pyxis-detached-cold-sw-1791597799409.jsonl`、`/tmp/pyxis-detached-sync-stdin-1791604629226.jsonl`、`/tmp/pyxis-detached-opfs-write-1791604669207.jsonl`、`/tmp/pyxis-detached-cpu-1791604749753.jsonl`、`/tmp/pyxis-browser-watch-1791604370898.jsonl`。原因未確定のため本番コードの追加修正は行っていない。検証用Chrome・agent-browser daemon・browser observer・専用tmux sessionは終了し、StassheのChromeとViteは継続稼働を確認した。

## コードから確定した原因

旧`main.tsx`はFS初期化、移行、demo生成、recent folder、SW接続がすべて終わるまで空のrootを保持した。さらにbridgeは起動前のcontroller snapshotがfalseなら、SWが既にpageをclaimしていてもreloadし、その後は解決しないPromiseを待った。長い移行と初回reloadは、それぞれ無表示と点滅を確実に作れる。Stassheの今回の停止位置は断定しない。

旧`public/sw-register.js`はHTMLから先に登録し、`dataset.pyxisSwControlled`にsnapshotを残した。bridgeが読む頃には`clients.claim()`でcontrollerが変わっていても、snapshotのfalseが優先された。SW登録も2か所、bridge内ではさらにupdateを待っていた。

## 旧経路の成立条件

下表は修正前の読込からReact mountまでを順に調べたもの。「初回」はorigin単位。port・hostnameが違えばIDB・OPFS・SWは別で、旧データを新originへ自然には引き継がない。

| 経路 | 成立条件・終わり方 | DevToolsとの関係 |
|---|---|---|
| Chromeのlive render frameがないtab | PyxisのURL・historyが残っていても、実文書が空の`about:blank`ならHTML・mainとも未実行。初回origin・旧データの有無とは独立。今回の実タブで確認。そこへ至る条件は未特定 | tab targetへのattachはChromium自身が文書の再読込を要求する。診断だけで状態が変わる |
| headのlocal同期script | `base-path-init.js`・`ga-init.js`のfetch待ちはbody parse前に止まる。現在のscript本文は有限の同期処理で、FS・IDB・SW要求を持たない | Viteや通信に依存。今回の空about:blankとは区別する |
| headの同期Pyodide CDN script | network応答待ちでbody parse前に止まる。root自体がまだない。cacheのない初回ほどnetworkに依存 | cache設定・通信時間の差で変わり得る。今回の直接証拠なし |
| mainのstatic import graph | Viteの変換、依存最適化、module fetchが終わるまで`start()`にも到達しない。module loadや評価の例外は`start`のcatch外 | cacheと実行時間に依存。直接証拠なし |
| Web Lock `pyxis-fs-owner` | `ifAvailable: true`なので別tab所有時は待ち続けず、明示エラー。要求自体が応答しない場合だけ無期限になり得る | DevToolsだけでlock所有は変わらない |
| FS Worker load失敗 | Worker constructorの同期例外はcatchできるが、moduleの非同期load・評価エラーをComlinkはinit応答に変換しない。error listenerがなくinitを永久待ちし得る | Vite moduleやcacheのタイミングに依存。新規profileでも成立 |
| OPFS初期化 | storage取得、symlink・FIFO recordの全読込、HOME・cache作成をawait。record量に比例して遅くなる。破損JSON・OPFS拒否は通常reject。browser要求が戻らなければ期限なし | 旧IDBの有無とは独立。DevToolsを開くだけでデータは変わらない |
| migration state open | IDB要求の応答待ち。`onblocked`が未処理なので、blockedなopenに到達した場合は期限なし | 別接続や要求順序が条件。DevToolsを開くだけでは解除しない |
| worktree・Git・cacheコピー | 旧データがあり`complete`でない場合。1 recordずつIDB読込、親作成、copy、byte検証、root全体walkでfile数確認。node_modules・Git object数が多いほど無表示が長い | 実行速度には影響し得るが、データ量は変わらない。移行完了後に再発しない条件を満たす |
| migration metadata | project mappingがある場合だけglobal DBを開き、chat・review・sessionを変換。global DB upgradeのblockedは未処理。件数が多ければ長い | 別tabの旧DB接続がupgradeを止める可能性。今回の接続状態は未採取 |
| migration明示エラー | root衝突、path逸脱、quota不足、bytes・件数不一致、欠損Git inode、対応外旧Git symlink等。旧DBを保持し、catchでエラー表示 | 永久の白画面ではなく、rejectまでの無表示。DevToolsが正しいデータへ直す経路はない |
| migration cleanup | deleteDatabaseのblockedは既にreject。`cleanup`でretryする。browserのdelete要求が応答しなければ期限なし | Web Lockとは独立の旧DB接続が条件 |
| demo生成 | `~/demo`がない場合だけ逐次生成。既存folderならstatだけ。file衝突はreject。書込要求が戻らなければ期限なし | fresh originで成立。既存demoを勝手に再生成しない |
| recent folder準備 | recent DB openのblockedが未処理。statの例外は内部catchしOpen Folder側へ渡すので、通常の「folderなし」は起動を止めない | 別tabのDB接続が条件。全workspaceをwalkする処理ではない |
| SW register・update | origin初回またはscript更新時のnetwork待ち。2か所register＋明示updateに期限がない。拒否はcatchされる | Disable cache、Update on reloadは経路・時間を変え得るが、Stassheの設定は未採取 |
| SW installing・waiting | current SWはinstallでskipWaitingしactivateでclaimするので、通常waitingは短い。installation失敗はredundantでreject、activation待ちは30秒でreject | DevToolsからの停止・更新や別の旧SWでwaitingが続けば、最大30秒の無表示。現行コードだけで永続waitingになるとは断定しない |
| `navigator.serviceWorker.ready` | active登録がdocumentに適合するまでrejectせず待つ。scope不一致等で永久待ちし得る。readyはcontroller確認の代用にもならない | browserのSW操作で条件が変わり得る |
| 初回reload | initial snapshotがfalse、session keyがない場合。途中でclaimされても必ずreload。React mount直前なので、全起動工程を再実行して点滅 | 初回origin、新tab、SW削除後等。snapshotの採取時刻で挙動が変わる |
| reload後の永久Promise | `location.reload()`後に`new Promise(() => {})`。navigationが完了すれば旧documentが消えるが、navigationが中断・失敗すれば空rootを永久保持 | Vite reloadやnavigationとの競合で成立し得る。今回のnavigation結果は未採取 |
| 残ったsession reload key | keyがtrueでsnapshotがfalseだと、現在のcontrollerがあっても通常reload要求のエラーで停止。SW解除後やhard reloadで成立 | Bypass等で未制御になれば該当。keyはorigin＋tab単位で同origin reloadをまたいで残る |
| reload loop | bridgeの自動reloadは同じtabではkeyによって最大1回。繰返しにはkey消去、別tab、外部navigation、Vite full reload等の別条件が必要 | 「点滅」だけからbridge単独の無限reloadとは言えない |
| controller・port接続 | controllerがcaptured activeと一致するまで最大10秒。port確認も10秒だが、旧実装はそのtimerより前の`createRuntimePort()`に期限がなく、Worker停止なら永久待ち | 更新とcontrollerchangeの順序で待ち時間が変わる |
| React mount以後 | 旧起動catchはReactの非同期render例外を捕まえない。rootがunmountすると再び空になり得る | 起動awaitとは別経路。今回のReact例外は未採取 |

`serviceWorker.js`はiconだけをcacheし、HTML・main・Worker moduleはcacheしない。current SWのicon cacheが古いmainを返して白画面を作る経路はない。同期runtime RPCはApp起動後に使うため、その待ちは今回の新document側の起動awaitに含まれない。旧documentの終了との関係は上の継続調査を参照。

`pnpm dev`のsetup-buildはesbuildで`public/sw.js`を生成してからViteを開始する。watch・時刻埋込みはなく、同じ入力ならscript bytesは同じ。ファイル生成だけでSW更新が必ず起こるわけではない。ただし別のdev/buildが稼働中Viteのpublic配下を書き換えると、Viteのfull reloadは起こり得る。依存最適化で追加dependencyが見つかった場合もViteがreloadし得る。これはSWのcontrollerchangeと別のnavigation経路であり、setup-buildが自分を再実行するloopはない。

## 修正

- HTMLのstatusを最初から表示し、application graphを動的importの失敗・timeout対象にした。Pyodide scriptをdeferしてbody parseを止めない。
- FS Workerのerror・messageerrorをinitのrejectへ返し、失敗時はWorkerとWeb Lockを解放する。遅れてlock callbackが戻っても終了済み起動からWorkerを作らない。
- 起動は進捗停止60秒で失敗。migrationはverified countと対象を報告し、総時間が長くても進める。中断後は次工程・旧DB削除を開始しない。既に発行済みのIDB deleteは取消せず、copy検証済みのcleanup工程に限って継続する場合がある。
- blocked DB openをrejectし、遅れた成功接続も閉じる。
- SW登録をbridgeに集約。snapshot・session key・自動reload・永久Promise・無期限ready待ち・重複updateを削除。現在のactive/controllerを確認し、hard refreshの未制御pageはmessageで再claimする。
- SW各工程を画面とconsoleで識別し、port取得も確認と同じ10秒期限に入れる。Reactの未捕捉render例外も画面とconsoleに表示する。

## 検証

DevTools UIを開かずagent-browserで別profileを使用。旧実装のfresh profileでは、登録途中にcontrollerがtrue・snapshotがfalse・root空を観測し、その後のnavigation typeが`reload`になった。旧snapshotによる不要reloadを実ブラウザでも確認できた。

修正後は3 projects、worktree・node_modules 2,400 files、Git objects 300 files、runtime cache 1 record、計約10.4 MBを旧DBに投入。計測用MutationObserverとconsole hookを使用しており、数値には進捗のsessionStorage記録コストを含む。Stassheの実DBをコピーした結果ではない。

| 工程 | 実測 |
|---|---:|
| 初期status表示 | navigationから55 ms |
| application modules | 174 ms |
| FS init | 70 ms |
| migration | 33,191 ms |
| demo生成 | 396 ms |
| recent folder | 21 ms |
| SW register | 28 ms |
| SW activation | 28 ms |
| controller取得 | 18 ms |
| port取得・確認 | 22 ms |
| React tree mount | navigationから34,140 ms |

約5,479回のstatus変化を記録し、最終的に各project 900 filesとGit binary値を確認。旧DBは検証後に削除され、起動開始後の自動reloadは0回。元の白画面の正確な持続時間・Stassheの停止await・DevTools設定との因果は未採取。

回帰検証はSW初回・waiting更新・hard refresh再claim・stale snapshot・sessionStorage拒否・ready未解決・登録／controller／port timeout・late port破棄・retry、Worker読込失敗とlock解放、長時間進捗と中断、legacy保持とretry、blocked openのlate closeを対象にする。

関連17 files / 120 tests pass。変更箇所のBiome、TypeScript、production buildも成功。実ブラウザでFS Worker moduleを遮断すると即座に起動エラー表示になり、390 px幅でも起動statusが見えることを確認した。

production previewの新規originではstatus 24 ms、React mount 423 ms、自動reload 0回。SW scriptのbytesを変えてupdateするとcontrollerが交代し、navigationを増やさずFS portを再接続した。更新後のTerminalで`node -e`からdemo READMEの`readFileSync`が成功した。実タブの再発とHTML読込前の停止は上記のとおり残っており、この検証はその解消を証明しない。

SWの制御移譲は[Service Workers仕様](https://www.w3.org/TR/service-workers/#clients-claim)の`claim`とcontrollerchangeに従う。表示・進捗の仕様は[起動順序](../../arch/system-overview.md#起動順序)、判断の背景は[STARTUP_INTENT](../../plan/STARTUP_INTENT.md)。
