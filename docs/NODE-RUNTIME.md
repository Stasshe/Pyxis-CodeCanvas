# Node.js Runtime

Pyxisはブラウザ内でNode.js互換コードを実行する。Providerは待機Runtime Workerを1つ先行起動する。実行はそれを再利用し、正常完了したWorkerは待機へ戻る。待機Workerがない状態で同時実行が来た場合はWorkerを必要に応じて起動し、終了後の待機Workerは最大1つに保つ。terminateやWorker内部の予期しない失敗が起きたWorkerは破棄して補充する。module cache、timer、process listener、stdinなどの実行状態は各実行の終了時に破棄する。Workerのglobal scopeに追加された値は次の実行へ残りうる。

## 実行経路

```mermaid
sequenceDiagram
    participant Caller as shell / npm / RunPanel
    participant Provider as NodeRuntimeProvider
    participant RT as Runtime Worker
    participant SW as Service Worker
    participant FS as FS Worker
    Caller->>Provider: runtimeRegistry.getRuntimeForFile(filePath)
    Caller->>Provider: provider.execute(options)
    Provider->>RT: start(options, fsPort)
    RT->>FS: async fs/transpile via MessagePort
    RT->>SW: sync XHR request
    SW->>FS: sync request via retained MessagePort
    RT-->>Provider: batched output and completion
    Provider-->>Caller: stdout / stderr / exit code
```

`runtimeRegistry`から呼ばれた`NodeRuntimeProvider`がFS Workerのportを取得し、待機Workerを取得して実行を開始する。Runtime Workerはportから`RuntimeFsMount`を作り、必須filesystem依存として各実行の`NodeRuntime`へ渡す。stdout、stderr、console、debugConsoleの出力はWorkerからまとめて送られる。TerminalのCtrl+Cはcatch可能なSIGINTを送り、ハンドラーが処理しない場合やSIGINTが繰り返された場合はWorkerを終了してexit code 130を返す。RunPanelの停止とcomponent unmountはAbortSignalで実行を強制終了し、入れ子のShellExecutorも停止する。

初回起動ではService Workerを登録して更新・activation・controllerを待ち、FS Workerのportを確認する。制御されていない初回ページは一度だけreloadし、次も未制御なら起動エラーを表示する。Service Workerの再起動時は新しいFS portを受け取るまで同期要求を待ち、処理中の旧portは応答が返るまで保持する。再接続には上限時間がある。Service Workerの実装は`src/engine/runtime/bridge/serviceWorker.js`から`setup-build`で`public/sw.js`へbundleされる。

`child_process`経由で起動中のShellExecutorにも中断signalを送り、Runtime Workerの終了時に実行中のshell処理を停止する。

## ファイルとモジュール

FS Workerの`FsCore`がOPFSと揮発性`/tmp`を所有する。Runtime Workerは全fileをpreloadせず、`RuntimeFsMount`を通じてFS Workerに操作を依頼する。

- 非同期file操作とtranspileはRuntime WorkerからFS Workerへ直接MessagePortで送る。
- 同期file操作、動的なrequireのpath解決などは同期XHRでService Workerへ送り、FS Workerのportへ転送する。
- 同期XHRが止めるのはRuntime Workerだけ。UIのmain threadは停止しない。
- Service Workerが再起動してFS Workerのportを失うと、main pageへ新しいportを要求し、受領確認後に処理を再開する。
- `child_process`のshell実行とstdinはmain pageを経由する。

`child_process`の`.sh`とコマンド置換は、親のcwd・環境変数を引き継ぐ子shellで実行します。変更は親に反映せず、shellの最後または明示された終了statusを返します。`.sh`の解決pathは`BASH_SOURCE[0]`で参照できます。対応構文はPOSIX shellの一部です（[Shell System](SHELL-SYSTEM.md)）。

module解決は1つのresolverを使い、非同期の先読みと同期`require`の両方で成功した解決先を実行内に保持する。同期経路は未解決の候補だけをFS Workerへ問い合わせる。通常のCommonJS fileは実行ごとのmodule cacheで一度読み込み、変換済みmoduleの永続cacheはFS Workerが所有する。これらのcacheは用途と寿命が異なり、Runtime Workerに独立したfile Mapは持たない。CommonJSの循環requireはロード途中のpartial exportsを返し、`module.exports`の置換も反映する。CommonJSとESMのnamespace生成も同じ実行内module cacheを使う。`fs`の同期APIも同じbridgeを使う。

解決済みmoduleは`realpath`をcache identityに使う。symlink経由のentryは実targetのfilename・package探索・module metadataを使い、`process.argv[1]`には起動時のpathを保つ。CommonJSの`module.id`はentryで`.`、dependencyではcanonical filenameとなる。`module.path`と`module.paths`はNodeのancestor `node_modules`探索を示し、`module.parent`・`module.children`・`module.loaded`はロード関係を反映する。`module.require()`はそのmoduleのcontextから同じresolverを使う。entry自身をrequireした場合も実行中moduleのexportsを返す。

OPFSにsymlink entryはないため、FS Workerはreserved root `.pyxis-fs-links`内にlink pathごとのrecordを保存する。recordはliteral targetを含む正本でfile payloadはraw bytesのまま保ち、Worker内のMapは小さなlookup indexに限る。`fs`はcallback・sync・promises APIの`symlink`・`readlink`・`lstat`・`realpath`を提供し、`realpath.native` / `realpathSync.native`は対応実装のaliasとなる。callbackとpromiseの両形式も`mkdir`・`rename`・`rm`・`unlink`・`access`で利用できる。通常のpath operationはfinal linkを追い、`lstat`・`readlink`・rename・removeは追わない。intermediate linkは追い、相対targetはlink parentを基準に解決し、target内の`..`はlink traversal後に処理する。`readdir`とtree walkにはlinkが現れるが、walkは辿らない。40回を超えるlink追跡は`ELOOP`となる。`/tmp`のlinkは揮発性。`Stats`と`Dirent`はsymlinkを識別し、`Stats`は`bigint: true`を扱う。`mode`はfile `0644`、directory `0755`、symlink `0777`の固定virtual値で、inode・device fieldとOS permission変更APIは提供しない。directory renameは既存のcopy-then-remove動作でliteral targetを保つため、POSIXのatomic renameではない。

File descriptor対応はpathをkeyにした同期subsetで、`openSync`・`readSync`・`writeSync`・`closeSync`・`fstatSync`を提供する。stdout/stderrのfd 1・2は`writeSync`できる。descriptorはopen時のpathを参照し、rename/unlink後もinode identityを保つOS descriptorではない。完全なasync descriptor APIは提供しない。

module種別はJavaScript parserで判定する。`.mjs` / `.mts`はESM、`.cjs` / `.cts`はCommonJSとして扱い、`.js` / `.ts`は最寄りの`package.json`の`type`に従う。`type`がない場合はsource grammarで判定する。packageの`exports`と`imports`は`import` / `require`などの実行条件とNodeのpath規則で解決する。Function constructorのbodyもparserで解析し、そこにあるimportを同じI/O追跡経路へ渡す。regexでsource構文を推測してmodule種別を決めない。

`node:constants`はfilesystem access、file type、open、copyの定数を公開し、`fs.constants`と共有する。`node:zlib`はgzip、deflate、raw deflate、inflate、raw inflate、gunzip、unzipを同期API・callback API・stream変換で提供する。圧縮処理にはpakoを使い、Brotliとzlib promisesは提供しない。`node:string_decoder`はNode-maintained実装を使う。`node:querystring`はNode準拠のparse/stringify alias、escape/unescape、`maxKeys`、custom URI decode/encode callbackを提供する。`node:net`は`isIP`・`isIPv4`・`isIPv6`だけを提供し、Socket・Serverと通信APIは未対応。`process.arch`は`os.arch()`と同じ値を返す。

Node `fs` and shell streams preserve file bytes. `readFile` returns a Buffer unless an encoding is explicitly requested; an encoding such as `utf8`, `hex`, or `base64` converts only at that call. Stdin, stdout, pipes, and redirection retain bytes; terminal rendering is the decoding boundary.

Runtimeの仮想HOMEは`/home/pyxis`。新規workspaceの配置先は`~/<name>`で、module cacheは`~/.cache/pyxis`、npm tarball cacheは`~/.npm`。npm metadataは必要時にregistryから取得し、cacheしない。tarball URLのSHA-256で名前を決めたarchiveだけを展開成功後にcacheする。`/tmp`はFS Worker内の揮発領域で、Node実行をまたいで共有される。

npm archive展開はfile・directory・symlink entryで先頭のwrapper componentを1つ除き、link targetはliteralのまま保存する。package root外へ解決される書込みは拒否する。packageの`.bin/<name>`は宣言された実行fileへのrelative symlinkで、Terminalと`npx`はcwdから上位へ`node_modules/.bin`を探して実行する。tar hardlinkは未対応。

## 計測の再実行

`scripts/bench/node-runtime/`には、同一fixtureをdemo workspaceへseedするmanifestとbrowser runnerがある。Pyxisをagent-browserで開いた状態で、`import('/scripts/bench/node-runtime/run.mjs').then(m => m.measureRuntimeBenchmarks())`を評価すると、5つのJavaScript/TypeScript・dependencyケースと`npm run bench`を各4回実行する。返る`warmSamples`は各caseの2〜4回目。既定の`benchmark: true`は実行ごとのWorker取得、起動、RPC、解決、parse/analyze、transpile metricsを出力へ追加し、`measureRuntimeBenchmarks({ benchmark: false })`は通常実行のwall timeだけを測る。`acquisitionMs`はpool取得開始からWorker ready確認まで、`preparedWorker`は先行起動slotの借用を示す。`workerStartMs`は`start` message送信からWorker handler到着までで、先行起動時間を含まない。以前のconstruct-to-handler計測とは比較できない。sub-ms clock分解能により小さな負値になる場合がある。fixtureのseedとsetup時間は計測wallに含まれない。UI submitとterminal描画も含まれない。最初の計測sampleではbenchmark helperの初回読込がwall timeに入る。

詳細計測では、FS操作ごとに`calls`、`wallMs`、enqueueから処理開始までの`queueMs`、FS Coreのawait処理時間`coreMs`を記録する。Core時間はOPFS等のawaitを含み、純CPU時間ではない。操作間のqueue/core合計は呼出しごとの値で、RPCが重なるためwall timeに足してはならない。preloadの`preloadAnalyzeMs`・`preloadRpcOutsideAnalyzeMs`・`preloadOtherMs`は各sample内で重複しない区分として`preloadWallMs`に一致する。`preloadRpcActiveMs`はRPC稼働区間のunionなのでanalyzeと重なることがあり、`preloadRpcWhileAnalyzeMs`がその重なりを示す。category mediansは独立して算出され、必ずしも合計してwall medianにはならない。

FS Coreの共有directory-prefix handle chain再利用後、通常warm medianはrequires24で直前の反復35.4 msから18.8 ms、初回比較41.5から22.4 msへ低下した。`diff@9.0.0`は56.7から38.0 ms、初回比較64.2から42.8 msだった。main-thread baselineはrequires24が17.9 ms、diffは38.3 msの単一sample。opt-in計測ではFS RPC/read件数はrequires24で75/26、diffで60/23のまま、FS Core call-summed時間はそれぞれ34.2から15.7 ms、49.7から22.7 msへ低下した。preload analyzerの中央値は約1 msと約18 msで変わらず、directory traversal削減が測定上の差を説明する。全seriesとper-path raw dataは[residual measurement artifact](../scripts/bench/node-runtime/results/runtime-residual.json)にあり、個々のsampleには変動がある。値は開発fixtureの比較であり、browser/device一般の性能保証ではない。

## トランスパイル

FS Workerはtranspile要求を一つずつ処理し、必要になったときだけ専用Workerを起動する。poolは1 Workerに固定され、30秒間未使用なら破棄される。後続要求は新しいWorkerを起動する。NodeのJavaScript ESM変換にはesbuildを使い、TypeScriptは登録済み拡張機能の変換設定を同じpoolで実行する。npm installはpackageが配布したfile bytesをそのまま展開し、runtime向け変換は実行時に行う。永続cacheはfile pathと変換入力のSHA-256 hashで検証する。

## 対応範囲

Runtimeは`fs`、`path`、`readline`、`child_process`などのブラウザ内実装を提供する。`child_process`はPyxisのshell機能に接続される。`net`はIP address helperに限り、native socketは作成しない。`node:http`には`ServerResponse`とHTTP server実装がなく、server-side HTTP APIは提供しない。ネイティブNode.js addon、`worker_threads`、完全なOS process環境は提供しない。

## 未検証項目

Safari実機でのOPFS、同期XHR、Service Worker再起動後のport復旧は未検証。page全体400 MB以内のメモリ予算も未計測。確認項目は[Development/TODO.md](../Development/TODO.md)に記録する。
