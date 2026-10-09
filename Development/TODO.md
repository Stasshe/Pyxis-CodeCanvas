検討中

tmp/の扱い

- [ ] npmモジュールの使用
- [X] pythonの実行環境？
- [ ] Terminalの候補機能
- [ ] nodeRuntimeの、デバッグ機能

## OPFS移行後のSafari実機確認

- [ ] Dedicated WorkerからのrequestをService Workerが捕捉できる
- [ ] Worker内のSyncAccessHandleとdirectory `FileSystemHandle.move()`が動作する
- [ ] node_modules規模の大量小ファイルでtree walkの速度を計測し、IndexedDB `getAll`との比較を記録する
- [ ] Service Worker停止・再起動後、MessagePort再受け渡しで同期XHRが復帰する
- [ ] main busy中もService WorkerからFS Workerへの同期fsが遅延しない
- [ ] 同期XHR 1回あたりの往復時間を計測し、連続`require`の実用性を確認する
- [ ] 対応ブラウザ実機でpage全体のメモリ使用量を計測し、400 MB以内の予算を検証する

## OPFS移行 検証記録

- [x] `pnpm run format`: 成功
- [x] `pnpm run lint`: 369 filesで成功
- [x] `pnpm exec tsc --noEmit`: 成功
- [x] `pnpm run build`: 成功（30 extensionsをbundle、25 TypeScript checks、Vite Worker・Service Worker bundleを含む）
- [x] OPFS移行時点の基準suite: 53 files / 441 tests、369 passed・72 failed。これは当時の記録で、後続のshell修正前の結果。
- [x] 関連範囲の回帰確認: Runtime・npm・Node built-in 24 files / 162 tests passed（npm tarball cacheの有効archive再利用と不正archive処理を含む）
- [x] Worker isolation test: 1 file / 4 tests passed（Workerの未処理reject・catch済みreject、mock Workerのerror・exit・outputを確認）

## Linux配置・workspace template 検証（2026-10-06）

- [x] HOME `/home/pyxis`、workspace `~/<name>`、runtime cache `~/.cache/pyxis`、npm cache `~/.npm`、memory-backed `/tmp` を確認。新規workspaceごとに`initial_files/` templateをコピーする挙動は当時の記録であり、下記の変更で廃止。
- [x] 全体 `format`、369 filesの`lint`、TypeScript、build（30 extensions、25 TypeScript checks、Vite Worker・Service Worker bundle）が成功。
- [ ] Safari実機・400 MBメモリ予算の検証は未実施。上記「OPFS移行後のSafari実機確認」に残す。

## Workspace seed・OperationWindow 検証（2026-10-06）

- [x] 新workspaceは空で作成する。生成済み`initial_files/`は起動時に`~/demo`がない場合だけ投入し、既存`~/demo`や他の既存folderには書き込まない。legacy migration後、recent foldersの読み込み前にseedする。
- [x] workspace設定の読み込みは`.pyxis/settings.json`がなければdefault値を返し、ファイルを作成しない。明示的な設定更新時のみ書き込む。
- [x] Open Folderとrecent foldersをOperationWindowの拡張可能なview descriptorに統合。folder閲覧・workspace作成・recent選択は同じ導線を使い、ProjectModalを廃止。
- [x] Focused final tests: 10 files / 52 tests passed。
- [x] Global `format` / `lint`: 372 files passed; `tsc --noEmit` passed; build passed (30 extensions, 25 TypeScript checks, Vite Worker and Service Worker bundles).
- [x] Whole test suite: 55 files / 455 tests; 51 files / 383 tests passed, 4 files / 72 tests failed, 0 skipped. Failures are limited to the previously recorded shell env expansion (26), error handling (13), pipeline (11), and subshell (22) suites; JSON results confirm no other failing files.
- [x] Desktop/mobile browser確認: current sessionの結果は下記「Workspace startup verification」を参照。
- [ ] Safari実機と400 MBメモリ予算の検証は上記項目に残す。

## Workspace起動の検証（2026-10-06）

- [x] Folder選択前のactive editor paneは空。file treeの`FileItem`はmetadataのみを持ち、fileを開いた時にfilesystemからcontentを読む。
- [x] 全体の`format` / `lint`（372 files）、`tsc --noEmit`、build（30 extensions、25 TypeScript checks、Vite Worker・Service Worker bundle）が成功。`git diff --check`も成功。
- [x] tabStateの対象回帰確認: 3 files / 11 tests成功。
- [x] 当時の全テスト: 56 files / 460 tests、52 files / 388成功、4 files / 72失敗、skipなし。失敗はenv expansion (26)、error handling (13)、pipeline (11)、subshell (22)。後続UI5全体1,960件で解消を確認。
- [x] agent-browserでdesktop (1280×900) とmobile (390×844)を確認。folder選択、file open/edit/save/reload、Terminal、Node実行、binary-editorを検証。最終buildのextension JSは200、欠落assetは404を確認してbrowser sessionを終了。

## Binary byte保持の監査（2026-10-07）

- [x] `format` / `lint`（377 files）、`tsc --noEmit`、build（30 extensions、25 TypeScript checks）、`git diff --check`が成功。
- [x] binaryの対象回帰確認は35/35成功、extension tab identityは1/1、inline-asset回帰は3/3成功。最終ExtensionTab factory回帰は4 suites / 13 tests成功（TabAPI、openTab、contentSync、fileLoading）。
- [x] 当時の全テスト: 71 files / 519 tests、446成功、73失敗。SVG期待値1件とshell E2E 72件（env expansion 26、error handling 13、pipeline 11、subshell 22）は後続UI5全体1,960件で解消を確認。
- [x] agent-browserでbyte signature付きPNG、拡張子と内容が異なるfile、Markdown/HTMLのlocal asset、0 byteのhex編集、byte単位の保存、キャンセルしたclose/discard dialogでの保持、raw downloadとZIPのhash、runtime stdout/pipelineのbyte、UTF-8 BOM保持、reload後の復元を確認。最終page errorなし。
- [x] TabBar menuのportal/clamping: 実際のrowを右クリックしてPreviewを開き、Markdownを表示。console errorなし。
- [ ] Safari device and 400 MB memory checks remain open above.

## OperationWindowの検証（2026-10-06）

- [x] `format`（373 files、1 fix）、`lint`（373 files）、`tsc --noEmit`、`git diff --check`、build（30 extensions、25 TypeScript checks）が成功。
- [x] 当時の全テスト: 58 files / 469 tests、397成功、shell E2E失敗72件、skipなし。内訳: env expansion (26)、error handling (13)、pipeline (11)、subshell (22)。後続UI5全体1,960件で解消を確認。
- [x] agent-browserでdesktop (1280×900) とmobile (390×844)を確認。picker mode、設定済み/独自shortcut、MRU、exclude、line/column移動、split open、AI context、rename、workspace作成が動作し、console errorなし。browser session終了。
- [ ] Safari device and 400 MB memory checks remain open above.

## Git workerとdiffの検証（2026-10-07）

- [x] Git status matrixの整形はstagedの追加・変更・削除と、index/worktree同時変更に対応。最新の対象回帰は5 suites / 17 tests成功（clean diff更新、未保存diff保持を含む）。
- [x] 全体の`format` / `lint`は380 filesで成功。最初のimport順lint失敗1件を修正し、lintを再実行して成功。`tsc --noEmit`成功。最終buildは30 extensions、25 TypeScript checks、5,116 Vite modulesで成功。
- [x] 当時の最終diff回帰前の全テスト: 74 suites / 526 tests、454成功、72失敗。失敗はshell suite 4つ（env expansion 26、error handling 13、pipeline 11、subshell 22）。対象5 suites / 17 tests成功。後続UI5全体1,960件で失敗解消を確認。
- [x] reload後のagent-browserでdesktop (1280×900) とmobile (390×844)を確認。Git init/status/stage/commit/history、stagedのread-only・unstagedの編集可能なdiff、同一diffの再表示時の内容更新、terminal diff/status/commit、branch/checkout/log、filter保持、mobile panel復元を検証。page errorなし。production bundle smokeも成功。
- [ ] Safari device and 400 MB memory checks remain open above.

## Gitとproject treeの更新性能（2026-10-07）

- [x] 同じwarm agent-browser profileとdemo workspace（25 tracked files、2 commits）を使用。`README` fixtureは`HEAD`との差分を持ち、内容は前後の測定間で不変。stagingの各測定前にindexをresetし、`HEAD`とtracked blob cacheも同じ状態にした。以前は`.git/index`更新でExplorer root walkが1回発生（49 recursive callsで327.9 ms）。構造だけを使うtree更新によりstaging時のwalkは0回になった。
- [x] Git panel mount時、main threadからのGit RPCは25→5回、status callは5→1回、FS Core statは750→150回。最初のGit API callから対応する最後のreplyまで1,674→204.9 ms。同一Chrome Performance artifactでmain `RunTask`は214.57→86.74 ms、FS Workerは488.21→92.28 ms。時間にはDevTools/CDP overheadを含む。`RunTask`合計から除外したのはprofiler-start markerを含むtaskのみ。
- [x] Stage操作時、Git RPCは11→6回、status callは2→1回、FS Core statは581→269回。最初のGit API callから対応する最後のreplyまで855.2→443 ms。変更後のRPC spanにはfilesystem eventの100 ms debounceを含む。main `RunTask`は127.27→76.48 ms、FS Workerは267.93→139.94 ms。Coreの時間は重複し、実時間の合計ではない。
- [x] 同じChrome Performance artifactで、mount後のmain task生値は385.95 ms、その中にDevTools CPU profiler起動の344.74 msが入れ子で含まれた。これは計測器のoverheadでGit処理ではない。mount前のWorker traceには139 msのMajor GC taskがあり、prestage Workerの最大値は22.85 ms。Chrome PerformanceとFS Worker/RPCの記録はtask scratchpadにあり、`git-final-trace-summary.json`に時間の要約がある。いずれも開発用fixtureでの単回warm測定で、一般的なbenchmarkではない。
- [x] 対象回帰は3 suites / 11 tests成功。最終format/lintは381 filesで成功、TypeScriptとbuildも成功（30 extensions、25 TypeScript checks）。全テストは76 files / 537 tests、465成功、72失敗。失敗は既知のshell suiteのみ（environment expansion 26、error handling 13、pipeline 11、subshell 22）。
- [x] 最終agent-browser確認: stage/unstage、commit後のstaged entry消去とhistory 3件への更新、terminalからのbranch作成/checkout、2 fileの作成/rename/削除がExplorerに反映され`.git`は表示維持、reload後もAll-branches filterを保持、status/branch/remotes/available branches/logを各1回呼び出し、discard後に`README`を完全復元、Git diffを開く。page errorなし。専用`git-perf` browser sessionを終了。
- [ ] Large `node_modules` trees, Safari behavior, and the 400 MB page-memory budget remain unmeasured; see OPFS migration checks above.

## Node runtimeの遅延基準値（2026-10-08）

- [x] Worker再利用前のmain (`e0e30d0`) と現行版を、fixture bytesを揃え別々のVite originで測定。fixture投入後に`NodeRuntimeProvider.execute` / `npm.run`の完了を待つwall timerを使用し、UI submitとterminal描画は除外。main基準値はcold 1回・warm 3回、再利用前の現行版は各case 4回で、最後の3回をwarm sampleとした。全sampleは[baseline.json](../scripts/bench/node-runtime/results/baseline.json)と[post-change.json](../scripts/bench/node-runtime/results/post-change.json)。
- [x] Pre-reuse normal-mode warm wall medians (ms), main → current: small JS 3.0 → 39.5; 24 CommonJS requires 17.9 → 73.2; TypeScript 9.8 → 39.2; local `node_modules` package 4.5 → 40.1; `npm run bench` 3.7 → 39.2. Current `diff@9.0.0` warm median was 110.6 ms versus one 38.3 ms main sample. The pre-reuse current runs used one dedicated Runtime Worker each (about 25–32 ms at worker message-handler entry); the main-thread baseline had no Runtime Worker startup. These development-fixture results showed higher wall time than the old main-thread path for each case.
- [x] Opt-in instrumented mode (`benchmark: true`) had a supplemental warm median of 78.0 ms for 24 requires. Its first sample recorded 0 sync XHRs (baseline 48), 75 FS RPCs (baseline 151), and 49 resolutions (baseline 49). For `diff@9.0.0`, the first post sample was 108.4 ms and the later warm median 111.2 ms; it recorded 0 sync XHRs (baseline 30), 60 FS RPCs (baseline 95 total, including 65 async), and 61 resolutions (baseline 61). Stage/RPC/read durations overlap and can exceed wall time. Instrumentation is opt-in and adds a dynamic helper import on the first page-reload sample; worker startup timing begins before that helper import. The original first-page response was clipped, so its cold requires24 and npm values are unavailable. A later fresh-page repeat captured first-worker samples, but browser/OPFS caches persisted, including the TypeScript transform cache; those values do not replace compiler-cold measurements.
- [x] Cold TypeScript timings are not directly comparable: main was 277.4 ms with its legacy extension and Babel/esbuild work activated before the timer; current's first post sample was 216.7 ms and included 52.2 ms esbuild initialization and 97.8 ms transform time. The initial normal-mode runner series produced a 54.4 ms warm median; the later cache-busted runner response retained only samples 2–4, whose median was 39.2 ms. An alternating normal/instrumented check produced a 41.4 ms normal median. The earlier 54.4 ms result was not reproduced, and its cause was not measured. The main cold run's esbuild initialization was not separated from the total.
- [x] `node bench-small.js`, `node bench-requires.js`, `node bench-ts.ts`, `node bench-node-modules.js`, `npm run bench`, and `node bench-diff.js` all passed in the current agent-browser Terminal. On main, all except the TypeScript command passed; its baseline Welcome-Project did not have the TypeScript runtime extension installed. The direct main timing separately activated its legacy transpiler registration.
- [x] Reusable fixtures and runner are in `scripts/bench/node-runtime/`; [Node.js Runtime](../docs/domain/node-runtime.md) documents the browser invocation. The runner seeds fixtures before timing and returns all four samples plus `warmSamples` (samples 2–4); use `{ benchmark: false }` for normal execution wall time.
- [x] After Worker reuse, normal-mode warm medians (ms) from samples 2–4 were: small JS 2.9, 24 CommonJS requires 36.8, TypeScript 4.7, local `node_modules` package 5.3, `npm run bench` 4.1, and real `diff@9.0.0` 62.9. Against the pre-reuse normal warm medians of 39.5, 73.2, 39.2, 40.1, 39.2, and 110.6 respectively, all six cases were faster. Against main, small JS / TS / npm are near or faster, node_modules is 0.8 ms slower, while 24 requires is 36.8 vs 17.9 ms and diff is 62.9 vs one 38.3 ms sample. Each measured execution borrowed a prepared Worker; opt-in metrics reported `preparedWorker: true`, approximately 0 ms acquisition, and approximately 0 ms worker start. Requires used 75 FS RPCs / 26 reads with 99.1 ms read spans, 124.8 ms resolver spans, and 1.0 / 1.3 ms parse/analyze spans. Diff used 60 FS RPCs / 23 reads with 177.5 ms read spans, 117.5 ms resolver spans, and 15.3 / 16.2 ms parse/analyze spans. RPC and read spans overlap. Exact normal and instrumented samples, including the first series with unusually high and unexplained startup samples, are in [runtime-reuse.json](../scripts/bench/node-runtime/results/runtime-reuse.json). Browser OPFS and transpile caches persisted across runs, so the TypeScript samples do not represent compiler-cold time. Instrumentation aggregates overlapping RPC, resolver, parse, and analyzer spans; their totals can exceed wall time.
- [x] In the agent-browser Terminal after reuse, all six fixtures passed: `node bench-small.js`, `node bench-requires.js`, `node bench-ts.ts`, `node bench-node-modules.js`, `npm run bench`, and `node bench-diff.js`. A state fixture printed `1, 1` on its first run and `2, 2` on its second, showing that a module loads once per run while a value written to Worker `self` persists. Process event listeners and a paused stdin listener did not leak into the next run; an unref'ed timeout was cleared when its execution ended. Ctrl+C terminated an infinite-loop run, and a following `node bench-small.js` completed. Three concurrent `NodeRuntimeProvider.execute` calls returned exit code 0; a subsequent call reported a prepared Worker. The browser console had no errors.
- [x] Pre-reuse global validation after the runtime changes: Biome format (382 files, no changes), lint (382 files), TypeScript check, build (30 extensions and 25 transformed TypeScript files), and 78 test files / 584 tests. 512 passed; 72 existing failures remain in the four shell suites (environment expansion 26, error handling 13, pipeline 11, subshell 22).
- [x] Isolated the 24-requires and `diff@9.0.0` residual against main (`e0e30d0`), then reduced repeated directory traversal by reusing FS Core's shared directory-handle prefix. Normal warm medians before→after were 35.4→18.8 ms for requires and 56.7→38.0 ms for diff in the repeat comparison; the initial comparison was 41.5→22.4 and 64.2→42.8 ms. Main was 17.9 ms for requires and one 38.3 ms diff sample. Opt-in FS Core call-summed time fell 34.2→15.7 ms and 49.7→22.7 ms with unchanged RPC/read counts (75/26 and 60/23); analyzer medians remained about 1 ms and 18 ms. All category and per-path timings, including variable samples, are in [runtime-residual.json](../scripts/bench/node-runtime/results/runtime-residual.json). The browser exercised all six commands and confirmed create/read, directory rename, remove/recreate, file rename, and cleanup with no page errors. No test/build ran during timing.
- [x] Final global format/lint passed on 383 files. The whole suite ran before the last exit-listener fix: 80 files / 597 tests (525 passed; 72 known shell-suite failures: environment expansion 26, error handling 13, pipeline 11, subshell 22). After the fix, the affected `nodeRuntime` scope passed 30 tests, and TypeScript check and build passed; the whole suite was not rerun after that fix.
- [x] Final validation after directory-handle prefix reuse: Biome format (383 files, no changes), lint (383 files), TypeScript check, and build passed (30 extensions, 25 transformed TypeScript files). Full suite: 80 files / 604 tests; 532 passed, 72 known shell-suite failures (environment expansion 26, error handling 13, pipeline 11, subshell 22), 0 pending. `git diff --check` passed.

## Session restore across workspace switches (2026-10-08)

- [x] Tab restoration is scoped to the loaded root and session generation. Older asynchronous restore work cannot update the active session or publish its completion; same-root reopen starts a fresh generation.
- [x] Focused session/restore coverage: 2 files / 11 tests passed. Final Biome format and lint passed (383 files), TypeScript check and build passed (30 extensions, 25 TypeScript checks). Whole suite: 81 files / 612 tests; 540 passed and 72 known shell-suite failures (environment expansion 26, error handling 13, pipeline 11, subshell 22).
- [x] agent-browser desktop (1280×900) and mobile (390×844): switched between the demo README and `src` index repeatedly, expanded/collapsed Explorer folders, closed/reopened README, and reloaded each viewport. Restored content matched the selected workspace, `isContentRestored` became true, restore flags cleared, and there were no page errors. Browser session closed.
- [x] Generated command-extension template now uses absolute workspace APIs; Biome and a generated-sample TypeScript check passed.
- [ ] Large `node_modules` trees, Safari behavior, and the 400 MB page-memory budget remain unmeasured; see OPFS migration checks above.

## Shell scriptのpath解決とchild shell実行（2026-10-08）

- [x] workspace root (`src/run-test.sh`)とscript directory (`./run-test.sh`)の両方から`.sh`を解決できるよう修正。実際に3秒待つscriptがstatus 0で終了し、親Terminalのcwdは変わらない。command substitutionも親cwdを変えない。現在のshell仕様は[Shell](../docs/domain/shell.md)を参照。
- [x] browser実行の前後でtracked fixtureと`/home/pyxis/demo/src/run-test.sh`を比較。両方749 bytes、SHA-256は`35ee400e2f022f8fa4cfbd01e0535d6b203941d178586dfb209abe3a317b3530`。browserの証跡と表示viewportの抜粋は一時scratch file `script-path-browser.json`。
- [x] 最終suite: 86 files / 657 tests、597成功、60失敗、pendingなし。失敗は既知のshell領域のみ: environment expansion (22)、error handling (8)、pipeline (10)、subshell (20)。72件失敗の基準から12件を修正し、新たな失敗はない。対象control testは7/7、fixture path testは3/3成功。
- [x] 最終Biome formatは390 files、lintは390 filesで成功し、TypeScript checkとproduction buildも成功。詳細は一時scratchの`script-shell-full-tests.json`と`script-shell-build.log`。
- [x] Shell process substitution / FIFO lifecycle: process substitution 2 files / 9 tests pass（44 skipped、`shell-fifo-process-substitution.log/json`）、startup lifecycle 1 file / 9 tests pass（`shell-fifo-lifecycle-tests.log`）。当初の未対応6件も解消。

## Markdown previewの検証（2026-10-08）

- [x] dev/productionでのUMD/AMD衝突を解消。Mermaidの`fastdom`と`fastdom-promised`によるAMD登録がMonacoのglobal loaderに届く可能性があったため、Viteのdev dependency optimizerとproduction buildでfree `define`を`undefined`に置換。production previewでMarkdown preview由来のAMD登録とpage errorがないことを確認。
- [x] desktop (1280×900) とmobile (390×844)のbrowserで、相対/絶対OPFS PNG、外部image、ドル/角括弧/両方の数式、inline codeとbacktick/tilde/長いfence、dagre/ELK/Gantt描画とzoom/reset、正規化した相対Markdown link、HTML iframe/image tab、GFM/raw details、reload復元、productionでのcode highlight/clipboard copyを確認。Markdown previewの未解決問題なし。作業用browser sessionとproduction preview serverを終了し、Stassheの既存dev server (5173)は稼働継続。
- [x] Markdown回帰: 数式preprocessing 6/6 tests成功。全体検証ではread-only Biome format/lintが394 filesで成功、TypeScript checkとbuildも成功（30 extensions、25 TypeScript checks）。Vitest全体は89 files / 679 tests、619成功、60失敗、pendingなし。失敗は記録済みshell suiteのみ: environment expansion (22)、error handling (8)、pipeline (10)、subshell (20)。
- [x] 当時の全体suiteでは既知shell失敗が60件だった。後続のshell修正で解消済み。Markdownの回帰失敗はない。

## npm install performance (2026-10-08)

- [x] Added an install benchmark under `scripts/bench/npm-install/` with small (`is-odd`), Express, React, and large development dependency fixtures. One cold and one warm wall sample per fixture; cold clears OPFS `~/.npm`, warm reuses it. Browser timing excludes fixture setup and Terminal rendering; native timing wraps `npm install --ignore-scripts --no-audit --no-fund` and includes process startup. Native runs used Node 24.18.0 / npm 11.16.0 with a separate cache. Pyxis ran in Headless Chrome 154 on Linux x86_64.

| Fixture | Pyxis installer-call before cold/warm (ms) | Pyxis installer-call after cold/warm (ms) | Native npm cold/warm (ms) |
|---|---:|---:|---:|
| small | 510 / 88 | 405 / 23 | 446 / 183 |
| Express | failed / failed | 4,256 / 499 | 1,030 / 396 |
| React | 920 / 704 | 728 / 103 | 899 / 337 |
| large dev dependencies | 10,735 / 6,540 | 4,315 / 503 | 5,545 / 1,089 |

- [x] The before Express fixture failed at `wrappy@1` because no tarball URL was resolved, so it has no valid speed ratio. The normal post-change run succeeded. These are single samples, not medians. The native timer includes npm process startup while the Pyxis timer starts at the install call; browser and native times are directional comparisons, not identical timing boundaries.
- [x] Main cause for the large fixture: Pyxis before platform filtering extracted 713,491,259 package bytes, including foreign OS/CPU optional packages; after filtering it extracted 38,865,804 bytes. Native Linux npm installed 79,975,837 bytes. The payload sets differ, so the large-install time comparison is not equivalent work and does not establish a 400 MB memory result. Instrumented profiles show large cold registry requests 70 → 69, tarball downloads 69 → 16, package file writes 647 → 455, and SyncAccessHandle opens/closes 788 → 572; warm registry requests fell 70 → 0. The lock replay and no-op samples produced no registry requests. Detailed samples are in [baseline](../scripts/bench/npm-install/results/browser-baseline-nostore.json), [post-change](../scripts/bench/npm-install/results/browser-post-normal.json), [native](../scripts/bench/npm-install/results/native-baseline.json), and the paired [profile artifacts](../scripts/bench/npm-install/results/).
- [x] Profile values diagnose stages but are not wall-time comparisons: Express cold was 1,320 ms instrumented versus 4,256 ms in normal mode. Phase spans overlap, and `install.gunzipTar` includes awaited entry writes; do not add phase durations or interpret that phase as decompression alone.
- [x] npm regressions in the initial implementation run: 12 files / 110 tests passed, covering registry caching, package-lock v3 replay and updates, nested versions, optional platform packages, SRI, and failures. Browser Terminal after a fresh post-build recheck installed `cowsay` (41 packages); `node node_modules/cowsay/cli.js Hello` printed the cow. A subsequent install was up to date.
- [x] Final checks: read-only Biome format and `pnpm run lint` passed on 394 source files; TypeScript `--noEmit` passed; Biome passed on the 7 benchmark source files; the npm suite passed 12 files / 115 tests. Vitest: 89 files / 684 tests; 624 passed and 60 remain in the known shell suites (environment expansion 22, error handling 8, pipeline 10, subshell 20). Build passed. Post-build app Terminal installed `cowsay` (41 packages); `cowsay Hello Pyxis` printed the cow. The `npm-bench` browser was closed and its Vite server on 5174 stopped; only the pre-existing 5173 listener remains. Safari behavior and the page-wide 400 MB memory target remain unmeasured; see OPFS migration checks above.
- [x] In the post-build app Terminal, installing Express added 68 packages and a repeat install reported up to date in 0.0s.
- [x] Historical Express smoke trace: an early run stopped at missing `node:zlib`; later runtime changes let Express advance past `node:zlib`, `node:querystring`, and `node:net`. The current Express limitation is recorded in [Node runtime compatibility](#node-runtime-compatibility-2026-10-09).
- [x] Repeated cold comparison: seven trials per fixture, each clearing OPFS `~/.npm` and using a new project root. Medians and interquartile ranges (p25–p75, ms), before → six-job implementation:

  | Fixture | Pyxis installer-call before | Pyxis installer-call after | Native npm before → after |
  |---|---:|---:|---:|
  | small | 122 [117–156] | 110 [109–148] | 328 [312–342] → 315 [311–337] |
  | Express | 1,667 [1,614–2,016] | 1,118 [1,066–1,177] | 1,007 [982–1,138] → 838 [816–876] |
  | React | 547 [511–614] | 482 [460–542] | 958 [932–1,010] → 874 [857–951] |
  | large dev dependencies | 1,798 [1,711–2,246] | 1,270 [1,176–1,542] | 5,561 [5,226–6,266] → 5,448 [5,315–5,768] |

- [x] The samples were run sequentially, not randomized. In the initial four-job cohort, Express was 1,667 ms in Pyxis versus 1,007 ms native (1.66×); the combined four-job cohort was 1,393 versus 828 ms (1.68×), so network/run-order drift prevents attributing its 16% Pyxis wall-time change to code. With six jobs, Express was 1,118 versus 838 ms (1.33×); the package-job span fell 903→642 ms while per-request tarball-header latency stayed stable, supporting increased overlap as the improvement. Tarball-header union fell 763→516 ms and registry-header span stayed near 428→418 ms. These phase spans overlap and are diagnostic, not additive wall time. A serial tar extraction experiment was slower, so extraction remains concurrent. The six-job run resolved the same 68 package path/version pairs as the four-job run. Large fixture payload was 38,865,804 bytes in Pyxis versus 79,975,837 bytes in native npm because browser/x64 platform filtering changes the optional-package set; this is not equivalent work. Safari behavior and the page-wide 400 MB memory target remain unmeasured.
- [x] Reproduction: start `PYXIS_BENCH_VITE_CACHE_DIR=<scratchpad-vite-cache> pnpm exec vite --config scripts/bench/npm-install/vite.config.mjs`, then open `http://pyxis.localhost:5174/scripts/bench/npm-install/bench.html` in agent-browser session `npm-bench`. The browser eval pattern is `agent-browser --session npm-bench eval "import('/scripts/bench/npm-install/browser.mjs?<unique-query>').then(m=>m.runColdTrials({trialCount:7,profile:false,sourceLabel:'<before-or-after-label>'})).then(value=>window.__result=value).catch(error=>window.__error=error.stack||String(error));'started'"`; use `profile:true` for profile samples. Run native trials with `node scripts/bench/npm-install/run-native.mjs --workspace <scratchpad-workspace> --output scripts/bench/npm-install/results/<artifact>.json --source-label <before-or-after-label> --trials 7`. The isolated server uses port 5174 and no production build. Raw trials are in [browser before](../scripts/bench/npm-install/results/browser-before-express-cold-normal.json), [browser after](../scripts/bench/npm-install/results/browser-after-six-jobs-normal.json), and the matching [native before](../scripts/bench/npm-install/results/native-before-express-cold.json) and [native after](../scripts/bench/npm-install/results/native-after-six-jobs.json) artifacts. Native install includes npm process startup; browser timing starts at the install call.
- [x] Benchmark browser cleanup must target only its named session. A `close --all` command closed an unrelated Runtime session; no app server was stopped, and no claim is made that the other session was restored.

## Terminal npm install end-to-end (2026-10-09)

- [x] This measures Enter-to-visible-prompt time in the Pyxis Terminal, separate from the installer-call-only medians above. The stable-prompt value waits for two animation frames with unchanged terminal text. Each trial removed OPFS `~/.npm` and the fixture `node_modules`, restored the exact manifest and lockfile, and cleared the browser HTTP response cache through CDP. Seven trials ran for the 2- and 43-package canonical cases; five for Express, React, and large development dependencies. First-trial outliers remain included in the reported quartiles.

| Fixture | Pyxis Enter→visible prompt, median [p25–p75] ms | Pyxis stable prompt median ms | Native interactive PTY, median [p25–p75] ms |
|---|---:|---:|---:|
| `is-odd` (2 packages, no lockfile) | 87.9 [87.0–104.3] | 121.2 | 406.0 [398.1–409.9] |
| `cowsay` + `is-odd` (43 packages, lock replay) | 472.5 [471.4–514.8] | 506.0 | 445.5 [443.9–448.9] |
| Express (68 packages) | 788.2 [704.5–845.2] | 821.3 | 893.0 [807.4–1,045.6] |
| React (3 packages) | 377.0 [372.6–420.5] | 410.4 | 903.6 [876.7–984.6] |
| Large dev dependencies (16 Pyxis / 19 native packages) | 841.4 [822.0–857.7] | 873.9 | 4,957.4 [4,844.5–5,102.2] |

- [x] Pyxis install summaries count dependency placements: the 43-package case reports `added 43 packages, checked 44 packages`, with the project root included in `checked`. This count is not a vulnerability audit; Pyxis has no audit scanner.
- [x] Matched earlier canonical cold cohorts: the 2-package Pyxis case was 115.7 [113.3–116.2] ms visible (148.1 ms stable), versus 87.9 [87.0–104.3] ms (121.2 ms stable) after; native PTY medians were 415.4 and 406.0 ms. The 43-package Pyxis case was 618.0 [563.6–888.1] ms visible (651.8 ms stable), versus 472.5 [471.4–514.8] ms (506.0 ms stable) after; native PTY medians were 443.8 and 445.5 ms. Cohorts were sequential, not randomized; these timings alone do not establish causality. The pre-projection profile recorded a workspace walk queued after npm completion: the worker walk took 164.6 ms and delayed the prompt ([trial 2](../scripts/bench/npm-install/results/terminal-e2e-43-after-profile-trial02.json)). The final tree-projection profile records no main or worker workspace walk and a 2 ms main-thread Git span ([trial 1](../scripts/bench/npm-install/results/terminal-e2e-43-final-profile-tree-zero-walk-trial01.json)); its profiled 825 ms total is diagnostic and differs from the 472.5 ms normal-run median.
- [x] Matched baseline artifacts: [2-package Pyxis](../scripts/bench/npm-install/results/terminal-e2e-2-canonical-cold.json), [2-package native](../scripts/bench/npm-install/results/native-terminal-2-canonical-pty-cold.json), [43-package Pyxis](../scripts/bench/npm-install/results/terminal-e2e-43-canonical-cold.json), and [43-package native](../scripts/bench/npm-install/results/native-terminal-43-canonical-pty-cold.json).
- [x] Native interactive npm runs use npm's default audit and lifecycle behavior; Pyxis does not run an audit scanner or package lifecycle scripts. Browser trials reuse the same open page and clear cached HTTP responses, so these are end-to-end directional comparisons, not equivalent network work. Large install contents also differ (16 versus 19 placed packages). The page-wide 400 MB memory budget and Safari behavior remain unmeasured.
- [x] Async CDP profiles observed HTTP/2 (`h2`) for all 133 Express requests (65 metadata, 68 tarballs). Of the connection records, 131 reused one identified connection; two same-content-type tarball requests had no connection ID or encoded byte count, so the capture does not establish their connection. Clearing the browser HTTP response cache does not close its warm connection; these profiles do not measure fresh TLS setup or a 15-socket ceiling. Metadata responses reported `br`; tarballs were gzip archives, with 743,913 compressed bytes and 2,335,974 extracted package bytes across 601 writes. [Profile 1](../scripts/bench/npm-install/results/terminal-e2e-express-final-profile-cdp-async-trial01.json) had 355.5 ms registry-client union and 937.1 ms worker time; [profile 2](../scripts/bench/npm-install/results/terminal-e2e-express-final-profile-cdp-async-trial02.json) had 186.5 ms and 857.9 ms. Their registry-client service totals were 3,520.4 and 1,594.3 ms; the first response's metadata body took 167.5 ms versus 45 ms in the second, contributing to that spread. Six package jobs took 559.2/650.9 ms and package-write union 379.7/387.5 ms. Compared with the faster six-request profile (360.8 ms registry-client union and 1,745 ms service), the faster 15-request profile had a 186.5 ms union and 1,594.3 ms service, consistent with added overlap; the slower 15-request sample shows substantial request-latency variation. These results do not establish a precise wall-time gain. The profiled 43-package tree-projection run took 825 ms (registry 179.6 ms, tarballs 308.9 ms) despite no workspace walk; use the normal-run medians for user-visible comparisons. Profile spans overlap and are diagnostic, not additive.
- [x] Reproduction: start `PYXIS_BENCH_VITE_CACHE_DIR=<scratchpad-vite-cache> pnpm exec vite --config scripts/bench/npm-install/vite.config.mjs`, then open the original app at `http://pyxis.localhost:5174/` in a named agent-browser session and select the OPFS project root (for example, `/home/pyxis/npm-terminal-final`). Run `node scripts/bench/npm-install/terminal-browser-cohort.mjs <session> <opfs-project-root> scripts/bench/npm-install/terminal-fixture-<case>.json scripts/bench/npm-install/results/terminal-e2e-<case>-final-cold.json <trials> off off`. Use case/trial pairs `2/7`, `43/7`, `medium-express/5`, `medium-react/5`, and `large-dev/5`. Run native trials with `uv run --no-project scripts/bench/npm-install/native-terminal-pty.py --workspace <scratchpad-workspace> --fixture scripts/bench/npm-install/terminal-fixture-<case>.json --output scripts/bench/npm-install/results/native-terminal-<case>-final-pty-cold.json --trials <trials>`. Browser trials run with network and profile capture disabled. Results: [Pyxis 2](../scripts/bench/npm-install/results/terminal-e2e-2-final-cold.json), [Pyxis 43](../scripts/bench/npm-install/results/terminal-e2e-43-final-cold.json), [Pyxis Express](../scripts/bench/npm-install/results/terminal-e2e-express-final-cold.json), [Pyxis React](../scripts/bench/npm-install/results/terminal-e2e-react-final-cold.json), [Pyxis large](../scripts/bench/npm-install/results/terminal-e2e-large-final-cold.json), [native 2](../scripts/bench/npm-install/results/native-terminal-2-after-pty-cold.json), [native 43](../scripts/bench/npm-install/results/native-terminal-43-after-pty-cold.json), [native Express](../scripts/bench/npm-install/results/native-terminal-express-final-pty-cold.json), [native React](../scripts/bench/npm-install/results/native-terminal-react-after-pty-cold.json), [native large](../scripts/bench/npm-install/results/native-terminal-large-after-pty-cold.json).
- [x] Final verification after the tree/concurrency changes: Biome format and lint passed on 404 source files; Biome passed on all 12 benchmark `.mjs` files after formatting two; `tsc --noEmit` and production build passed (30 extensions, 25 transformed extension TypeScript files, 5,132 Vite modules). Vitest ran 96 files / 747 tests: 687 passed and the same 60 known shell failures remained (environment expansion 22, error handling 8, pipeline 10, subshell 20), confirmed by exact full-name/file comparison with no new or resolved failures. `git diff --check` passed.
- [x] Final app smoke: Explorer folder create/rename/delete and the cowsay CLI passed. The active install indicator appeared as one truncated row; wrapping was observed for input and summary text only. The owned benchmark browser was closed and port 5174 stopped; `ss` showed only the pre-existing 5173 listener. Safari behavior and the page-wide 400 MB memory target remain unmeasured.

## Node runtime compatibility (2026-10-09)

- [x] agent-browser Terminal installed 13 manifest roots (96 packages total) in 6.8 seconds. Individual commands returned exit status 0: TypeScript 6.0.3 compiled a TypeScript fixture and ran the emitted file; fs-extra 11.4.1 exercised callback, bigint stat, symlink, access, and rename APIs; require-directory 2.1.1 traversed a handler directory; EJS 7.0.1 compiled and rendered a template; rimraf 6.1.3 removed a directory.
- [x] Stassheの決定: native実行ファイルを配るpackage（TypeScript 7 `tsgo`、Biome CLI等）は非対応。browserは実行ファイルを起動できず、package別にWASM版へ差し替える分岐は持たない。TypeScript 7.0.2 は `@typescript/typescript-browser-x64` を解決できず `tsc --version` が exit 1。TypeScript 6.0.3 は動作する。
- [x] Browser runtime compatibility harnessは11/11操作成功。Express 5.2.1はmemory transport経由でHTTP 201、`Set-Cookie`、JSON `{ok:true,body:{value:7}}`を返した。Koa 2.16.4はHTTP 202、`x-runtime4: koa`、JSON `{ok:true}`を返した。`http.createServer`とnative socketは未対応。
- [x] その他の成功操作: lodash 4.18.1のclone/collection、chalk 6.0.1のstyle export、commander 15.0.0のoption parse、yargs 17.7.2のflag/positional parse、dotenv 18.0.6の既存環境変数を保つfile load、uuid 14.0.2のv4/v5/v7、date-fns 4.4.0のformat、zod 4.6.5のvalidation、Axios 1.20.0のbrowser fetch adapter。Axiosは公式browser entryからdata URLへ接続。
- [x] Koa 3.2.1は`node:async_hooks`を常時読み込むため未対応。AxiosのNode adapterは未対応の`node:tls`を必要とする。検証済みのKoa 2とAxios browser entryには影響しない。
- [x] Runtime4最終scopeは48 files / 398 tests: 397成功、失敗0、todo 1（nested `util.inspect.custom` hook）。
- [x] Tar hardlink entry、`http.createServer`、native socketは未対応。Safari実機とpage全体の400 MB memory予算は未計測。
- [x] Runtime5: `util.inspect`、`format`、`formatWithOptions`は`node-inspect-extracted` 3.3.3を使用し、nested `util.inspect.custom`を含むNode由来のinspection semanticsを提供する。Map/Set、BigInt、`%o`/`%O`もNode由来のformatterで扱う。Browser runtimeからPromise内部状態、Map/Set iterator、Weak collectionの内容は観測できないため対象外。
- [x] Runtime5: `fs.exists` callbackは存在しないpathに`false`を返す。以前は`stat`の戻り値を無視して常に`true`を返していた。
- [x] Runtime5: `npm install alias@npm:target@range`はscoped targetを含めtargetを解決し、manifestに`npm:<resolved-target>@^<resolved-version>`、resolver requestに正確な解決versionを渡す。dependency graph側のalias配置にCLI操作を接続した。
- [x] Runtime/SW/npm review disposition: 実装反映 H1–H5・H8–H9・H13–H14・M1–M6・M9・M12・M14–M15・L1–L2。H7はstdin/stdout/stderrをstream化しreadable inputとwrite callbackを接続。H8は複数install、unknown option拒否、uninstall複数target、live output、`--`以降のmain args、pre/main/post lifecycle、`start`/`test` shortcutと`server.js` fallbackを実装。H10は同期status、live output、abort、exec/execFileのmaxBufferを修正。M8はunzip wrapper自動判定とinflate data errorのError code/errnoを実装。H12はnextTick FIFOとMessageChannel immediateへ変更。
- [ ] Review boundaries: H5のkey generationは未提供。legacy `createCipher`/`createDecipher`はupstreamのstubが`createCredentials`を要求し、password由来の方式でもあるため公開しない。H6のchmod/utimes/watch・FileHandle/opendir/cp・fd inode identityは未対応。file modeは永続metadataに保存せず、`stat` / `access`は固定modeを返す。正しいchmodにはOPFS file metadataの永続化とrename/delete/accessへの伝播が要る。H10のspawn failureとshell exit 127の区別、H12のhost Promiseより先行するNode nextTick優先度、M7のhttp Agentは未対応。H7のTTY resize eventも未実装。M10のpid/memoryUsage/kill/umask/binding/release/titleは未対応。L1のprototype instrumentationは開発benchmark時だけ有効で、production buildには含まれない。
- [x] Review decisions: H11はWorker global/prototype変更の次回runへの残存を許容し、旧runtimeの型付きbridge rejectionのみ無視。M10は`process.platform`/`os.platform()`=`browser`を維持し`chdir`・`emitWarning`を実装。M13のPyxis `@/` resolver alias、L3の`.node` resolve後の明示的load errorは公開済み挙動として維持。M11はpath/posix・util/types・readline/promisesを追加し、既知の未対応builtinを`ERR_UNKNOWN_BUILTIN_MODULE`で拒否。
- [x] Function境界: module origin基準で`Function`内の`import()`を解決するためper-module Function shimを維持する。このためglobal `Function`のidentityやmutationが全dependency moduleへ伝播するとは限らない。
- [ ] `util.isDeepStrictEqual`はassert port由来の差が残る。Node v24.18.0 oracleでは別々のPromiseはfalse、異なるError `cause`もfalse、Invalid Date同士はtrue。既存比較器の小さな一般修正で済むか確認する。
- [x] Runtime3時点の検証記録: Biome format/lintは403 files、TypeScript、production build（30 extensions、25 transformed extension TypeScript files）が成功。Vitestは95 files / 739 testsで679成功、60失敗、pending 0。既存shell suiteの失敗（environment expansion 22、error handling 8、pipeline 10、subshell 20）との完全一致を確認。証跡は一時ファイル`runtime3-full-tests.json`と`runtime3-evidence.json`。

## 公開契約・残課題の監査（2026-10-09）

- [x] Runtime/npm検証: 54 files / 497 testsを対象に検証。53-file runは490/491成功（npm banner newline fixture失敗）、修正後の影響する3 files / 48 tests成功、残り52 filesも成功済み。FIFO fixture修正後に該当1 file / 6 tests成功。修正後の全scope再実行はしていない。Biomeは139 filesでerrors/warnings 0、既存literal-key info 6。TSC snapshotはruntime/npm 0 errors、他領域11 errors（unix.ts 2、tail.ts 3、outputHandler.ts 4、scriptRunner.ts 2）。
- [x] 全体初回snapshotは181 files / 1,374 testsで1,352成功・22失敗。後続のfocused修正で6件（bufferBoundaries 1、childProcess 1、nodeBuiltin 2、runtimeBytes 2）と3件のFIFO test fixture不整合を解消。残る13件は既知shell/Git failures。最終production build成功: 30 extensions、25 transformed extension TypeScript files、Vite/Service Worker bundle。production Runtime Workerにbenchmark instrumentation markerは含まれない。
- [x] Browser harness: RuntimeRegistryのWorker検証10/10成功（util inspect/format、AES/random、alias require、decimal、fs.exists、Express 5.2.1 HTTP 201、Koa 2.16.4 HTTP 202）。npm command handlerは108 packagesのmulti-installとmanifest replay、pre/main/post＋quoted args（exit 0）、script failure（exit 7）を確認。別枠でreact-dom 19.2.8＋自動追加React 19.3.0のinstallとruntime APIを確認。これはhandler/harness検証でTerminalからの手入力ではなく、HTTPはmemory transportでありnative server/socketの検証ではない。

## Runtime 6 package compatibility

- [x] Real-package browser smoke checks: dotenv 18.0.6, chalk 6.0.1, commander 15.0.0, TypeScript 6.0.3, Prettier 3.9.9, uvu 0.5.6, and sql.js 1.14.2 passed their targeted behavior checks. uvu's success and failure suites returned exit 0 and 1. sql.js used a 658,410-byte WASM asset and completed initialization plus CREATE/INSERT/SELECT.
- [x] Known compatibility limits: inquirer 14.2.3 requires unsupported `async_hooks`; ts-node 10.9.2 register actually fails while eagerly loading unsupported `repl`. `_preloadModules` and raw-TypeScript compile hooks are further source-audit gaps, not observed runtime failures. TypeScript 7.0.2 package has no JavaScript compiler and requires native execution.
- [x] Rollup WASM 4.64.3 installed and passed direct ESM generation (39 bytes), `bundle.write` to `dist/rollup-api.js`, `npm run rollup-build` to `dist/rollup.js`, and `npm run node` (exit 0; all outputs contain or print 42).
- [x] Build-tool/package再確認: Vite buildとESLint CLIは未対応`node:worker_threads`で失敗。Vitest元test scriptは未対応`tls`によるStartup Errorでexit 1、runner summaryなし。Webpack最小development compile callbackは未対応`vm`で失敗しartifactなし。Runtime 8時点のPino 10.4は未対応`diagnostics_channel` APIで失敗していたが、Runtime 9で実装。詳細stackは`runtime8-package-repro-results.json`。
- [x] Whole-project ESLint was not run under the 2 GiB available-memory guard. Run only one heavy test, build, or browser task at a time; no additional profiles or benchmark outputs were created.
- [x] Latest scoped Biome: runtime/npm 138 files, 0 errors, 6 infos. Latest full source/test snapshot: 705 files, 26 errors, 2 warnings, 6 infos; remaining issues are mostly external UI/test formatting.
- [x] Removed obsolete `ModuleExecution` lexical masks for `define`/`window`. The actual-global regression tests and explicit `process` import in `shell/environment.ts` were present before the 06:35:48 full Vitest run; runtime/npm files passed.
- [x] Browser Dedicated Workerでactual-global cleanupを確認。直接の`NodeRuntime` / `createGlobals` / `dispose`呼出しで、正常終了・例外終了後のruntime所有descriptor復元、program globalとprototype変更の残存、host globalの維持を確認した。`runtimeWorker` dispatchは未検証。証跡: `runtime8-worker-globals.json`。
- [x] Final browser smoke: canonical `npm run` printed 42 and exited 0 (104 ms). ESLint universal API detected `no-undef`/`no-unused-vars`; `verifyAndFix` applied a semicolon fix and exited 0 (1,538 ms).
- [x] After the readline baseline/factory cleanup, focused validation passed 4 files / 22 tests at 06:43:15.
- [x] Historical checks: `pnpm exec tsc --noEmit` and `pnpm run build` passed with 30 extensions, 23 nonbundled TypeScript checks, Vite and Service Worker bundles. The earlier 203-file / 1,646-test snapshot predated readline/factory cleanup; current whole-suite status is recorded in the latest verification section below.

## Runtime 7 crypto

- [x] `crypto.scrypt`/`scryptSync` added through `@noble/hashes` 2.4.0 with Node option aliases/defaults, typed-view/ArrayBuffer/SharedArrayBuffer inputs, and maxmem validation before allocation. After the final callback-order fix, `cryptoModule` passed 17 focused tests at 06:58:34; whole-project `pnpm exec tsc --noEmit` passed. Biome checked 138 files with 0 errors and 6 infos; `git diff --check` passed.
- [x] Browser-verified installed `scrypt-kdf` 4.0.0: 96-byte key, `{ logN: 4, r: 1, p: 1 }`, correct password verified true and wrong password false; command exited 0. Evidence: `runtime7-scrypt-results.json`. An interrupted first navigation was retried successfully in 3.956 s; cause was not established.
- [x] Final checks: `pnpm exec tsc --noEmit` passed; `pnpm run build` passed (30 extensions, 23 nonbundled transpiled checks, Vite and Service Worker bundles; 1.89 s). Runtime 7 crypto passed 17 focused tests at 06:58:34 and browser smoke. Latest full Vitest snapshot was 206 files / 1,672 tests with 1,671 passing; its sole external failure is `ReferenceError: alert is not defined` in `tests/hooks/ai/useChatSpace.test.ts:271`, through `applyChatEdit.ts:181`.

## Runtime 8 Node/npm互換修正

- [x] Browser Dedicated Workerで直接の`NodeRuntime` / `createGlobals` / `dispose`呼出しを使い、正常終了・意図的な例外終了のcleanupを確認。runtime所有descriptorは復元され、program globalとprototype変更は残り、host globalは維持された。`runtimeWorker` dispatchは対象外。証跡: `runtime8-worker-globals.json`。
- [x] ESM実行時はshebangを先にsanitizeし、その後executor内でstrict directiveを加える。同期・非同期loaderはraw cached sourceを渡し、`executionCode` helperを削除した。native npm 11.16 oracleで`latest`なしのexact version installも確認。証跡: `runtime8-npm-oracle.json`。
- [x] ESM top-level await判定はobject/class methodのparameter・bodyをnested scopeとして扱い、computed keyはouter scopeとして評価する。computed-key ESM end-to-end regressionを追加。
- [x] 07:18:52のnpm/packageResolution・commonJsWrapper・moduleCode focused suiteは3 files / 18 tests成功。
- [x] `process.exitCode`は初期`undefined`。number/string integerをvalidateし、getterはsigned 32-bit。`undefined`/`null` reset、不正値は以前のstatusを保ち`ERR_INVALID_ARG_TYPE`/`ERR_OUT_OF_RANGE`。`beforeExit`/`exit`にはraw値、最終statusには8-bit値を使う。
- [x] 自然終了の2-phase idle drainはrejection通知までlistenerを保つ。browserでuncaught rejection exit 1、caught exit 0、guest `unhandledRejection` listener付きexit 0、未awaited `worker_threads` import exit 1を確認。synthetic error/catchを加えない。
- [x] 07:46:23のfocused suiteは2 files / 24 tests成功。`process.exitCode`の12 testsとruntimeWorkerの12 testsを含む。guest consoleは既存Node-derived formatterでError stack、`%s`/`%d`、circular、BigIntを表示し、logger JSONを維持する。証跡: `vitestAfterExitCodeFix`。
- [x] Native Node 24 oracleで`util.stripVTControlCharacters`のCSI・OSC・C1・DCS・Unicode・type codeを照合。公開元は既存`node-inspect-extracted`で依存追加なし。
- [x] 最終full Vitestは07:47:21開始、140.40 s、209 files / 1,745 tests: 1,738 pass・7 fail。runtime/npmは40 files / 370 casesすべてpass。失敗はshell pipelineの`cat -v` binary表示1、textUtilitiesのhelp timeout 1、unixFileOperationsのfind/stat/gzip/unzip/help 5。証跡: `runtime8-full-tests.json`。
- [x] 外部`cat`/`find`/`tree`修正後の最終static checks: Biome source format 495 files pass、`tsc --noEmit` pass、`pnpm run lint` 495 filesで外部`unixOperations/stat.ts`のimport order error 1件。runtime/npm Biome source+tests scopeは134 files、0 errors・既存info 6件。`git diff --check` pass。以前のformat/type errorは修正前snapshot。
- [x] 最終production build pass: 30 extensions、23 nonbundled TypeScript transpiles、5,013 Vite modules、Runtime WorkerとService Worker bundle、2.02 s。
- [x] AST/ESM判定修正後、ESLint 10.12.0の元の`npm run lint`をbrowserで再実行。CommonJS/ESM誤判定を通過した後、`eslint/lib/eslint/eslint.js`の未対応`node:worker_threads`でexit 2。stackは`runtime8-package-repro-results.json`に保存。
- [ ] 確認済みの未対応APIは`tls`、`worker_threads`、`vm`、`async_hooks` / AsyncLocalStorage。
- [x] 自分のbrowser runtime6-checkを終了。既存の5173を変更していない。

## Runtime 9 Node module compatibility

- [x] `diagnostics_channel` / `node:diagnostics_channel` aliasにper-runtime generic channelsとsync / promise / callback tracingを追加。`bindStore`は渡されたstoreの`run`へ委譲し、subscriber exceptionはruntime tracked nextTickでthrowする。generic channelはNode coreを自動instrumentしない。Unit testsはdiagnosticsChannel 17件 + diagnosticsRuntime 1件 = 18/18 pass（browser focused suiteではない）。`async_hooks`とAsyncLocalStorageは未対応。
- [x] 実Worker確認: 先行subscriberのthrow後も後続subscriberとpublish後処理を実行。guest handlerのbrowser例はexit 0、handlerなしの例はexit 1。実statusはhandlerと`process.exitCode`に従う。Schedulerはhandled nextTick throw後も残りのcallbacks/countsを保持し、continuationをrethrowより先にqueueする。
- [x] diagnosticsChannel 17 + diagnosticsRuntime 1 + runtimeWorker 16 = 34 focused tests pass。Native Worker oracleはhandled tick exception、unhandled exception、`process.exit`によるstopを検証。
- [x] Workerのdiagnostics publishは2 throwing subscribersでもFIRST/SECONDを順に実行し、catchありでは通常nextTickを含めexit 0。catchなしでは後続subscriber後にfatal exit 1となり通常tickは走らない。nextTick内の`process.exit(7)`後も後続tickは走らない。
- [x] `stream-browserify`を`readable-stream` 4.8 unified coreへ置換し、`stream/promises`の`finished` / `pipeline`、AbortSignal、cleanup、async iterables、`end: false`を実装。streamPromises 9件 + streamModule 2件 = 11/11 unit tests pass。streamPromises suiteでnamespace identityも検証。
- [x] `node:stream/web` / `stream/web`にnative WHATWG readable/writable/transform、BYOB、text、compression APIsを公開。17 native constructors、runtimeごとのmutable exportsとnative constructor identityを維持する。Unit tests 8/8、production build（30 extensions、23 nonbundled TypeScript、Vite 1.98秒）、compiled Worker 6 entriesすべてpass。get-streamのtext/bytes Buffer payloadとMaxBufferError、BYOB、TextEncoder/Decoder、gzip roundtrip、CJSのgzip→get-stream Buffer await→Unicodeを確認。証跡: `runtime9ProductionWebStreams`。browserはdev page/provider/OPFSのままcompiled Worker URLだけ差し替え、production UI全体の試験ではない。圧縮形式はbrowser依存。
- [x] ESMのgeneric pending-evaluation waitで未完了barrel readを防ぐ。await grouping restorationとcache v5はmethod precedenceと複雑なHTTP callbackのTLA metadataを保持する。
- [x] `events.on(source, event, options)` async iteratorを追加。queue order、EventEmitter / EventTarget、AbortSignal cause/code、error identity、close/return/throw時のlistener cleanup、high/lowWaterMarkとpause/resumeを扱い、callable EventEmitter facadeはupstream own static descriptorを保持しconstructorを変更しない。
- [x] `events.on` native parityはeventsIterator 11件 + eventsModule 2件がpass。Workerのdefault/named `events` import regressionは13/13 tests pass。
- [x] Await loader focused tests: esmTransformer 19 + esmEvaluation 22 + runtimeWorker 13 = 54/54 pass。
- [x] Installed package retest: Winston 3.19 JSON console exit 0。get-stream 9.0.1のNode APIは`events.on`; `(await getStreamAsBuffer(...)).toString('utf8')`でexit 0。HTTP native API smokeは5173で200、HTML 2,739 bytes、exit 0。stream/promises alias、pipeline、stdout Writable、AbortSignalによる両streamのdestroy、`finished` cleanup `[0, 0, 0, 0]`、FS/zlib pipelineがexit 0。
- [x] node-fetch 3.3.2を既存cohortへ追加（6 packages、1.2秒、lockfile 3.3.2 / manifest `^3.3.2`、既存依存維持）。実HTTP GET `127.0.0.1:5173`でdefault fetch、Headers/Request/Response、status/header/JSONを確認しexit 0。compiled Worker証跡: `runtime9-package-repro-results.json`の`runtime9NodeFetch`。
- [x] Axios 1.20.0を既存cohortへ追加（26 packages、既存依存維持）。実ESM entryは`index.js`→`lib/axios.js`→`lib/adapters/http.js`から`https-proxy-agent`をeager loadし、`tls`未対応でGET前にexit 1。Node 24 native CJS require / ESM importではGET 200・2,739 bytes・AxiosHeadersを確認。証跡: `runtime9-package-repro-results.json`の`runtime9Axios` / `runtime9AxiosSource`、native oracle `runtime9-axios-native-oracle/`（scratchpad内）。
- [x] Compiled Runtime Worker smoke: 通常module/package確認7/7に加え、`runtimeWorker-mITxmtWO.js`でexception/rejection handler内の`process.exit(7)`とexit listener markers、後続nextTick停止、実Errorのfatal exit 1、Worker再利用を確認。get-stream fluent buffer awaitとWinston JSONもexit 0。dev page/provider/OPFSでWorker URLだけproduction assetへ差し替えた検証で、production UI全体の確認ではない。証跡: `runtime9-package-repro-results.json`の`runtime9ProductionExitBoundary`。browser終了済み。
- [x] Pino 10.4の残るblockerは未対応`worker_threads`。
- [x] Latest static/build checks: `tsc --noEmit` pass、Biome format/check 502 files pass、`git diff --check` pass。Production build pass: 30 extensions、23 nonbundled TypeScript transpiles、Vite 1.98 s (`runtimeWorker-CYuFC-pl`)。
- [x] guest exception/rejection listener内の`process.exit`を通常の終了signalとして扱い、終了statusへ反映する。実際のErrorは引き続きfatal。Worker boundary focused tests 23/23 pass、buildは`runtimeWorker-mITxmtWO.js`でpass（2.01秒）。compiled Workerでもexit code/markers、fatal Error、Worker再利用を確認。
- [x] Latest Runtime 9 full Vitest (`runtime9-web-final-tests.json`): 223 files / 1,911 testsすべてpass。runtime/npmは59 files / 593 testsすべてpass。以前のsnapshotにあった担当外POSIX alpha glob 2件のfailureは他担当の修正後に解消。
- [x] Node `Readable.fromWeb()` / `Readable.toWeb()`でWHATWG Readableとの変換に対応。Writable/Duplex変換と`stream/promises.finished()`のWHATWG interopは未対応。

- [x] `depcheck`と`ts-prune`は手動監査用として保持。UI6で実行し、alias／動的登録／公開API／test参照の誤判定をsource照合して除外する用途を確認。保持理由は[構成計画](../docs/plan/directory-structure.md#package候補)へ記録。CIやpackage scriptへ新たな自動判定は加えない。
- [ ] Shell/NPMが共有するruntime APIにopaque型付き境界を定め、root-scoped operationの排他性を保ちながらextension/i18nの公開contractも整理する。
- [x] GitHub REST pushはremote commit DAGと100件超のhistoryを再構築する。`pushHistory.test.ts`の5件（うち1件は101 commits）で検証済み。中央最終suite待ち。
- [x] metadata adapterのread/modify/write競合は新たなcross-tab lock設計を要しない。`FsClient`は初期化前に`pyxis-fs-owner` Web Lockを排他的に取得し、同時利用タブを拒否する。
- [x] Chat space作成は11件目でも既存10件を保持する。`useChatSpace.test.ts`で保持を検証済み。
- [x] 2026-10-09 04:13:13 JSTの対象suite: 36 files / 125 tests成功。Biomeはsrc 433 filesで成功、production buildは30 extensions・25 TypeScript checksで成功、`git diff --check`も成功。
- [x] 2026-10-09 04:09:00 JSTの一時ログ`/tmp/pyxis-docs-tests.txt`: Vitest全体135 files / 1,029 cases（1,017成功、11失敗、1 todo）。新規relative-fixture失敗1件は修正後に成功。残るshell失敗10件はprocess substitution/FIFO 6件（pipeline 2、subshell 3、FIFO 1）、nounset 1、awk 1、special path 2。
- [x] 旧`tsc --noEmit`のshell関連3診断（`commandDispatch:154`の`projectName`不足、`executor:631`のbinary content type、`outputHandler:66`の`fd`未対応）は次の検証では再現しなかった。
- [x] useChatSpaceのbrowser確認: 遅延したAの読込はBへ反映されず、A→B→A中の保留renameは新generationを上書きしない。Aだけが保存されBは不変。検証用recordの削除、component unmount、差し替えたstorage methodの復元を確認し、browserを終了。
- [x] SharedSidebarのcontractと順序を合わせ、未使用`initialState`とobsoleteな`skipDotGit`型を削除。
- [x] 並行中の別担当による当時の全体checkでは、Biome src 436 filesにVim/renderformatとunicodeTerminal importsのエラー2件、`tsc --noEmit`に4件（VimEditorの`cellWidth`不足、unicodeTerminalのproperty/accessor不一致と`super` field）があった。これは実装途中の記録であり、最新統合Vitestの結果は下記Shell・Terminal・Vim修正節を参照。
- [x] README/docsの修正点はClaude向けscratchpad `code-fix-handoff.md`へ引き継ぎ済み。本項目ではdocsを変更していない。

## Shell・Terminal・Vim修正（2026-10-09）

- [x] FIFO実装前の全体snapshotは145 files / 1,091 tests、1,078成功・12失敗・1 todo。担当focused suiteは420 tests中414成功。既知の担当6件はprocess substitution 5件と`mkfifo`/FIFO 1件。追加の他範囲6件はextension binary assets 1、extension lifecycle 2、tab session 1、Git push history 2。todoは別領域のnested `util.inspect.custom`。
- [x] FIFO実装前の後続focused suiteは43 files / 426 tests、419成功・7失敗（FS依存6、並行変更中のdirty pull preservation 1）。Git除外後は37 files / 406 tests、400成功・FS依存失敗6。担当範囲Biomeは79 filesで成功。
- [x] FS Workerのnamed FIFO、anonymous pipe、`/dev/fd`、`/dev/null`、mount metadata/resetを実装。`fifo-focused-tests-4.log`: 10 files / 127 tests全pass（scoped cancellation、仮想device列挙、runtime TTYを含む）。
- [x] `shell-sonnet-terminal-final.log`: Terminal 13 files / 75 tests pass。Production browserでtheme変更後も同一xtermと未保存bufferを維持。最終bundleでは保存後のreadback `保全😀 before-theme after-theme`を確認。`vim-sonnet-final-tests.log`: Vim 7 files / 82 tests pass。
- [x] 後続Terminal runの12 files / 68 tests、66 pass・2 failは中間結果。最新Terminal focused run `shell-sonnet-terminal-final.log`は13 files / 75 tests全pass。
- [x] 最新のargv lifecycle regression suiteは2 files / 44 tests全pass（`shell-sonnet-argv-final-3.log`）。xargs wait interruption/job cleanup、SIGINT処理と遅着console outputを確認。
- [x] Shell process substitutionのstartup/redirection readiness、正常終了時drain、endpoint cleanupを統合。process substitution 2 files / 9 tests pass（44 skipped）、FIFO startup lifecycle 1 file / 9 tests pass。後続lifecycle regression suiteは5 files / 78 tests全pass（`shell-sonnet-lifecycle-final.log`）。以前の期待成功6件も解消済み。
- [x] FIFO実装前のProduction browserで変数・算術展開の`7:5`とexit 1、`head`/`tail`のpipeline、実キーイベントのCtrl+W、Tab補完・history、VimのA/`!`・undo・visual・`:wq`保存（`cat`で`alpha! beta`を確認）を検証。Vim終了後のscrollbackも保持。clipboard権限拒否時はgraceful errorを表示。
- [x] 最終production browserでwc file operand、描画backlog、Vim中のglobal Ctrl+R割込みを再確認し、修正を検証。`wc -c clear2.out`は7とprompt、`sort review.txt`は`alpha! beta`とpromptを表示。60文字入力はEnter後300 msでpromptへ戻り、`wc`で450 byteを維持した。Home/End、Tabの`cat`/`cd`/`chmod`/`chown`/`clear`/`cp`候補、history、Ctrl+Wを確認。
- [x] Vim実操作で`A`・`!`・Escape・`u`・Ctrl+R後に`alpha!!`とNORMALを確認し、Quick Openが割り込まないこと、`:q!`後にTerminalへ戻ることを確認。raw `node.stdin`は`Z`をechoなしで`RAW "Z"`として受け取り、canonical stdinは`hello`をlocal echoして`LINE "hello\n"`を受け取った。`sleep 10`へのCtrl+C後は`$?`が130。Unicode `あ😀`で左移動・Backspace後は`😀`。390 pxで左sidebarと右panelを隠し、下部Terminalを表示した状態でTerminal/Vim resize、scrollback復帰、clipboard denial errorを確認。page errorなし。
- [x] 最新production browserで`:s/a/b `・`:wq!`後の`wc -c`が3、`cat -E`が`b $`となり、置換末尾spaceの保存を確認。process substitutionの入出力/drain/`wait`、named FIFO、cooked `cat`のCtrl+D EOF、Ctrl+C後status 130と次command status 0、`exit 7`後の`cd`/`pwd`/後続commandを検証。page errorなし。fixture 3件とFIFOを削除し、browser/previewを終了、5173を維持。
- [x] FIFO実装前の最終アプリproduction bundleは`pnpm exec vite build`成功（2.04 s）。同時点の`pnpm run build`は外部`extensions/todo-panel/index.tsx:48-49`の型error 2件で前処理停止。過去のbuildは30 extensions、25 TypeScript transforms、4,977 modulesで成功。
- [x] 修正後の全体TypeScript checkで担当範囲errorは0。外部errorは5件（todo-panel 2、Git push 1、core fs 1、migration lightning 1）。
- [x] FIFO実装前にmobile browserの390 pxで左sidebarと右panelを隠し、下部Terminalを表示した状態のTerminal/Vim resizeを確認。Terminal resize unit testsも通過。
- [x] browserと自分のpreviewは終了済み（previewはCtrl+C、tmux sessionを終了）。Stassheの5173は稼働を維持。
- [x] Shell2修正: Vimのgrapheme単位のINSERT/search/word motionと混在LF/CRLF・単独CR保持、shellのIFS空/混在時`$@`・array `@`境界、sortのC locale相当byte順・精密decimal・`-nu`同値時の先頭行保持・各入力のLF/空行recordを実装し、未使用`splitOnIFS`を削除。
- [x] Node binary pipelineのmain global衝突を決定的に再現し、テスト専用Worker隔離とoverlap回帰を追加（production変更なし）。focused suite 10 tests pass。Production TerminalでVim挿入・検索・保存後のbyte readback、shell `$@`/sort/空行を確認。390×844で横overflowなし、page errorなし。
- [x] Shell3のTTY・script確認: redirect付き`runCompound`/`runRange`はstdinを強制的にTTY扱いしない。function位置引数の復元、改行なし最終行を扱う`while read`（`one`/`two`/`done`）、`wait` status 1、interactive `EXIT` trapは`exit 7`のstatusを受けて`exit:7`を表示し、新しいshellのpromptへ復帰することを確認。focused TTY 3 files / 65 tests全pass。stat/unzip/whileの追加suite 2 files / 41 tests全pass。
- [x] Production browserでUnicode pasteを1度だけ挿入、multiline paste拒否、選択copyのCtrl+CがSIGINTを送らないこと、clipboard read拒否error、raw bracketed pasteのmarkerとCR、6000行出力後のprompt、UTF-8分割入力とcat/wc byte・文字数、Vim複数file拒否・unsupported prefixのEscまでのblock・`:s` match数・visual/yank/paste/save、find prune、unzip readbackを確認。page errorなし。clipboard OS readback自体は未確認。2 fixture scriptを削除し、browser/preview/tmuxを終了。
- [x] Scope Biome 213 files、global Biome src 498 files、production build（30 extensions / 23 TypeScript checks、2.06秒）、diff check成功。buildは最新の外部AI type error発生前のsnapshot。最終`tsc --noEmit`はexit 2で担当error 0、唯一の外部診断は`src/components/AI/AIReview/AIReviewTab.tsx:272`のTS18047（`aiEntry`がnullの可能性）。以前の外部diagnosticsChannel型errorは解消。全体Vitestは214 files / 1,815 tests、212 files / 1,813 pass・2 files / 2 fail（134.08秒）。担当Shell・Terminal・Vimは全pass。残る2件は担当外: `tests/engine/helper/settingsManager.test.ts:56`のeditor font期待19・実際14、`tests/engine/runtime/eventsIterator.test.ts:63`のnative error listener期待1・実際2。以前のdiagnosticsChannel/useChatSpace失敗は再現なし。詳細ログはshell3最終snapshotを参照。専用browser・preview・guest fixtureは終了済み。
- [x] Shell4境界監査: brace `{-02..02}`は`-02 -01 000 001 002`。算術の`set -u`は未設定変数でerror、`&&`/`||`/`?:`は短絡。EXIT trapはfunction・false条件・subshellでは発火せず、実際の`exit 4`で1回実行。
- [x] Production browserで長いASCII/CJK/絵文字（ZWJ・VS16・結合文字を含む）出力を検証。Homeで124列から42列へresize、End・Enter後に広げても出力とpromptを保持。Vimは`ciwX`/`viwd`をEscまで遮断し内容`abc def`を保持、空`:s` patternと`:split`を拒否し、`:wq`後のreadback `abc def`を確認。page errorなし。dev HMR時の途中結果は採用せず、production確認のみ記録。
- [x] Shell4 checks: source Biome 500 files、scoped Biome 12 files、最終Vim Biome 4 files、build（30 extensions、23 TS transpiles、1.94秒）、global diff check成功。最後に確認したtsc snapshotは担当error 0で外部`AIReviewTab.tsx:272`のnullable診断のみ。全体Vitest `shell4-vitest-final.log`は220 files / 1,871 tests全pass（135.46秒）。途中で失敗したTerminal 40列表示のmessage prefix assertionは表示prefixと保存後不変内容の確認へ修正済み。preview・browser・fixture・`/tmp` Vim fileを終了・削除し、作業processは残っていない。
- [x] Shell5: globの`?`/classはUnicode code point単位、`[[:alpha:]]`はUnicode letter、結果はUTF-8 byte順。反復`/`を保持し、末尾`/`はdirectory symlinkを含むdirectoryだけに一致。実fixtureでdangling symlink除外、unmatched classのliteral保持も確認。
- [x] Shell5: browserでTerminalの幅（界・😀・👩‍💻・✈️は2 cell、éは1 cell）、live 25行とscrollback 5,200行（5,000行trim後）の出力・prompt・入力保持を確認。wheel scrollでviewport 93→90→93。VimのNORMAL/VISUAL count guard、register/macro prefix guard、`:split`拒否と`:wq`後の3行readbackを確認。page errorなし。
- [x] Shell5全体Vitest `shell5-vitest-after-wheel.log`: 222 files / 1,907 tests全pass（135.16秒）。TypeScript checkとbuild成功（30 extensions、23 TypeScript checks、2.02秒）。source Biome 503 filesとdiff check成功。shell・Vim・wheelの動作をbrowser確認。
- [x] `node -e` / `node --eval`はeval用source transportとsynthetic `[eval]` moduleで実行する。旧ENOENTはshellが常に`args[0]`をscript pathとして扱い、`-e`をpathにしたため。CommonJS/sloppy mode、`process.argv` / `execArgv`、`execPath`、`__filename` / `__dirname`、cwd基準のmodule解決をfocused runtime/provider suitesで確認。実Terminalでmarker、status 0、prompt復帰を確認。
- [x] `yoctocolors`の有効な`export * as default from`をLezerが誤ったrecovery treeにした問題を修正。reserved namespace aliasのparser normalizationはsource offsetを維持し、module dependency抽出とruntime loadを検証した（focused 68/68）。
- [x] Runtime 10で判明したexeca blocker `events.setMaxListeners` / `getMaxListeners`をRuntime 11で実装（focused events tests 8/8）。`addAbortListener`はRuntime 11の再試行で見つけて実装（focused events tests 13/13）。
- [x] execa 10.1.0をsource / compiled Runtime Workerで確認。同期・非同期のsuccess/failure、exit status 0/9/7、日本語UTF-8 stdin往復を検証した。
- [ ] fs-extra 11.4.1は`ensureDir`・`outputJson` / `readJson`・`pathExists`・`move` / 移動後read・`remove`がpass。`copy`は未対応`fs.chmod`で停止。mode metadataとchmod familyの一般契約を決めてから再確認する。

### Runtime 11

- [x] `events.setMaxListeners` / `getMaxListeners`はEventEmitter互換targetとEventTargetの上限値を扱う。`addAbortListener`はnative one-shot registration、disposable解除、pre-aborted microtask callbackに対応。Focused events suite 13/13 pass。EventTarget warning diagnosticsと`stopImmediatePropagation()`への耐性は未対応。
- [x] Source Workerとcompiled Runtime Worker `runtimeWorker-CdXGNqI4`でeval metadata / `[eval]` file不在、events (8 assertions)、execa (5)、fast-glob (8)、get-stream/fetch-blob stream APIsを確認。fs-extraはcopy以外のassertions成功、`copy`のみ`fs.chmod`不足で失敗。compiled runは同一origin documentとcompiled Workerの検証で、production UI全体ではない。
- [x] 初回の並行全体Vitest `runtime11-full-tests.json`: 230 files / 1,995 tests、1,991成功・4失敗。child byte 1件はsnapshotで失敗したが、後続focused suiteは10/10成功（mixed-version影響の可能性、原因未確定）。残る3件は担当外FS sidecar/link 2件とVimEditor境界1件。全passのsnapshotとして扱わない。
- [x] Final static/build checks: `tsc --noEmit` pass、source/locales Biome 571 files pass（190 ms）、`git diff --check` pass。Buildは30 extensions / 23 TypeScript transforms、Vite 2.03秒、compiled asset `runtimeWorker-CdXGNqI4`。

### Runtime 10 検証

- [x] Runtime/npm + nodeBuiltin: 62 files / 619 tests pass。TypeScript error 0、runtime Biome 123 files pass。Buildは30 extensions・23 TypeScript transforms、Vite 1.90秒で成功（`runtimeWorker-nn4t2Ovi.js`）。
- [x] Full Vitest snapshot `runtime10-final-tests.json`: 228 files / 1,960 tests、1,959 pass・1 fail。失敗は並行中の別領域変更に起因する`tests/engine/core/gitignore.test.ts` malformed charclass。後続の同suite 18/18 passは確認したが、full snapshotを全passとは扱わない。
- [x] Global Biome src/locales 568 files pass。Runtime + tests scope 123 files pass。`git diff --check` pass。
- [x] Terminal `node -e`は実UIでmarker、status 0、prompt復帰を確認。execa/fetch-blob/get-streamの実package smokeはexecaが未対応`events.setMaxListeners`で停止し、fetch-blob/get-streamは成功。
- [x] Compiled Worker package smokeは`runtimeWorker-nn4t2Ovi.js`と`runtime10-package-repro-results.json`の`compiledRuntimeWorker`で確認。eval metadataとsynthetic `[eval]` file不在、Readable Web adapters、get-stream/fetch-blob、namespace re-exportを検証した。

## Code reviewから残す項目（2026-10-09）

- [ ] Private repositoryの認証付きclone/fetch用transportを用意する。公開CORS proxyは匿名アクセス専用で、認証要求は拒否する。
- [ ] 壊れたsymlink recordはFS初期化時に安全に失敗するが、recordの修復・回復UIがない。fail-safe動作を保った回復方法を決める。
- [ ] directoryと`/tmp`境界をまたぐrenameのcopy/delete経路には完全atomic性がない。ブラウザAPIで保証できる契約を決める。persistent regular fileはnative moveへ変更済み。UI6でsource部分削除後のsidecar／通知整合性を修正し、保持したdestinationと残ったsourceを実状態へ一致させた。
- [x] readdir/rmのsymlink探索は線形のまま測定。先行Chrome1,000 links／20 directoriesのreaddir19.6 msに加え、UI6最終実装で3,000 links／30 directoriesを全件照合。列挙合計104.2 ms（1 folder 1.8〜19.5 ms）、再帰削除473.7 ms、fixture不在を確認。並行Vitest中の単回参考値で、一般性能保証や比較benchmarkではない。この規模ではindexを追加しない。大規模workloadで必要になれば再計測する。
- [ ] WebPreviewはunsandboxed same-origin iframeへHTMLを書き込む。意図するsecurity boundaryを決める。
- [ ] Git checkout途中のwrite失敗後、source tree／index／target-only file／既存untrackedの整合した復元を行う。UI7のprobeでHEAD／indexが旧commitのまま、worktreeにtarget bytesと新設untrackedが残ることを確認。旧commitのforce checkoutでも戻らない。checkout完了後のref保存失敗はUI7で復元済みだが、この経路と区別する（scratchpad/ui7-core-residuals.md）。

## 最終レビュー検証（2026-10-09）

- [x] 担当scope: 88 files / 454 tests、454成功・失敗0・pending 0。Lifecycle 14/14、binary asset loading 5/5、migration 28件を含む。この担当scope記録とは別に、最新全体Vitestは下記snapshotを参照。
- [x] Migrationのmetadataはread-free initializationとsmall key/pointer indexへ移行。28 testsでreal IndexedDB `getAll` guard、source snapshot、latest-chat dedupe、duplicate-session/current-session precedence、retry、target conflict、strict-history timestampを検証し、全件成功。
- [x] 中間Global Biome 480 files pass。中間TypeScript結果では担当error 0、外部diagnostics 5件だった（`final-review-tsc-4.log`）。最新のglobal statusは下記UI・storageレビュー再開節。
- [x] Production browserで公開bundle 2件を実ロード・activateしcomponent renderと10 SVG/helper結果を確認。空workspace fixtureではTODOなし。registrationはstub化し、storage未変更。fixture・sessionをcleanupしbrowser終了。
- [x] READMEの本文見出し・locale表示を20言語（繁体字中国語を含む）へ、CLAUDE.mdのi18n表記を18+から20へ更新。`SUPPORTED_LOCALES`と20 locale directoriesに一致。

## UI・storageレビュー再開（2026-10-09）

- [x] 前回全体Vitest `shell-sonnet-final-full-tests.log`: 203 files／1,646 tests、202 files／1,644 pass。これは後続suiteにより置き換え。
- [x] 追加監査前の全体snapshot: 206 files／1,672 tests、205 files／1,671 pass。唯一の失敗は`tests/hooks/ai/useChatSpace.test.ts:271`のpre-apply content testで、`applyChatEdit.ts:181`経由の`ReferenceError: alert is not defined`。修正後の最新結果は下記「編集・保存の追加監査」。
- [x] Latest global checks: Biome 494 files pass（`shell-sonnet-final-biome-6.log`）。最終`tsc --noEmit`は全体0 diagnostics（`shell-sonnet-final-tsc-5.log`）。
- [x] Latest `pnpm run build`: 30 extensions、23 tsc transpiles、5,012 modules、2.09 s（`shell-sonnet-typeahead-build.log`）。
- [x] Ctrl+C後のtypeahead queue fixを含むTerminal 15 files / 103 tests全pass（`shell-sonnet-typeahead-tests-2.log`）。
- [x] Ctrl+C直後のtypeaheadをproduction browserで確認。割込み後の入力と後続Ctrl+Cで先行queueを破棄する動作をbatched keypressで検証。page errorなし。`keyboardtype`での文字欠落はxterm `onData`前に発生し、実keypressで修正後のアプリ入力保持を確認。
- [x] Biome format（sourceと今回のtests、500 files）・check（source、485 files）、全体`tsc --noEmit`、`git diff --check`成功。`pnpm run build`成功: 30 extensions、23 tsc transpiles、5,006 Vite modules。
- [x] persistent file renameはnative OPFS moveで既存destinationを置換する。失敗時にsource／既存destinationを保持、mtime保持、変更event 1件、symlink置換失敗の復元を回帰検証。move非対応時はsource pathの`ENOTSUP`。READMEのbrowser互換性とfilesystem docsに反映。
- [x] 拡張importは既存JavaScript parserでstatic／side-effect／re-export／literal dynamic importを解決。nested moduleはimport元基準。コメント・文字列を変更せず、Blob URLを無効化まで保持する。失敗した有効化はdisabledを永続化し、onlyOne peerやpackage rollbackの復元失敗を記録する。
- [x] Git更新をAppのFS通知へ集約し、per-tab listenerと未使用GitContextを削除。DnD／Markdown rendererの内部型castを整理。検索はroot／query／options／tree変更で要求とcacheを破棄し、古い成功・失敗が新workspaceへ入らない。
- [x] AI要求とfile contextをroot／space／世代へ結び付け、A→B→A、初回space作成、遅延file読込、並行要求を検証。新rootの読込待ちでも旧contextをpromptへ含めない。i18nのcache read/write失敗、辞書型検証、AI翻訳keyを修正し、Gemini応答のdebug dumpを削除。AI／i18n docs更新済み。
- [x] agent-browser: 通常Appのfolder開閉、Quick Open、editor入力・Ctrl+S保存後のFS readback、Markdown見出し・数式、Git非repositoryエラー表示、Binary Editor無効化・再有効化、AI Ask／Edit切替を確認。production desktop 1280 px／mobile 390 pxを目視し、mobile page widthは390 px、page errorなし。Gemini実通信・認証付きGit通信・通常UIの保存失敗／復元失敗の注入は今回未実行。
- [x] native FS browser proofは同directory置換、cross-directory move、symlink、mtime、eventを確認し、fixtureをfinallyで削除。Viteのqueried module URLと裸URLは別singletonなので、proofはAppが読み込んだ正確なclient URLを再利用する。
- [x] 自分のbrowser／5174 preview／tmux sessionは終了。Stassheの5173を維持。Git書込み操作なし。private transport、corrupt link回復、WebPreview境界、directory renameの契約判断は上記TODOに残す。

## 編集・保存の追加監査（2026-10-09）

- [x] 保存待ち中の同file・別file編集を全dirty状態が解消するまでflush。新workspaceの準備とsession保存の後にもflushし、失敗時は旧root・タブ・bufferを残す。保存errorはUIとOutputへ出す。
- [x] Monacoの遅延model更新による入力巻き戻しを防止。診断更新用の同内容`setValue` timerとdiffの二重保存timerを除去し、undo・IME中のmodel reset経路を減らした。編集可能なdiffのsession内容も即時同期する。
- [x] renameは旧pathの保存timer・待機中saveを無効化し、新pathでdirty内容を保存する。削除eventでは100 msのUI batching前に保存を無効化し、dirty・未保存draftのタブを残す。削除直前のautosaveによるfile再作成を回帰検証。
- [x] AI draftはclose・workspace切替前に最新内容の保存を確認。元messageを保存区間内で照合し、旧提案から新entryを更新・削除しない。適用済みbytesは編集可能な提案と分けてrollback照合する。未使用のAI review helperを除去。
- [x] rename/importの既存destination拒否をFSの排他mutation内で行う。symlink・FIFO・directory sidecarの復元を改善し、source削除失敗後はcopy済みdestinationを保持する。復元失敗のcauseもWorker境界からUIへ伝える。
- [x] 追加focused検証: UI／モデル／workspace 36件、FS／import 95件、削除race・hook 28件、AI保存16件、後続context／IME 27件、チャット操作／入力保持22件成功。全体最初の206 files／1,672 testsのAI cleanup失敗は修正済み。後続208 files／1,709 testsのfixture順序比較失敗もrecord ID比較へ修正。
- [x] 最新全体 `ui-data-final-full-tests.log`: 208 files／1,715 tests、1,712成功・3失敗。担当のUI／storage／FS／Git／AIは成功。3失敗は別担当が変更中の `naturalProcessExit.test.ts`（guest exitCodeのundefined・257・-1）。runtime向け記録はscratchpad `runtime-ui-validation-handoff.md`。
- [x] 最終build成功（30 extensions、23 TS transpiles、5,012 modules、2.03 s）。担当scopeのBiome 309 files成功。先行global Biome 555 files／TypeScriptは成功したが、その後の並行変更を含む最新global checkはruntime `processExit.ts` format 1件、TypeScriptはshell `cat.ts` 2件・`find.ts` 3件。全体成功とは扱わない。
- [x] production browser: file編集・Ctrl+S・undo/redo・再読込、Quick Open、Markdown見出し、rename／clean delete、Git非repository表示、30 extension manifests、AI Edit mode。page errorなし、390 pxで横overflowなし。browser／previewは終了。
- [x] AIのactive file表示はタブmetadataを購読し、添付contextはrename・保存・削除へ追従する。古い初期読込と更新読込をrevisionで拒否し、再読込中も未確定の選択状態を保持。未使用のcontext読込helper／testを除去。production browserで保存後の`CURRENT_FILE_VERSION=two`、rename後の新path、削除後の添付除去、新規metadata-only fileの選択と実bytesをprompt表示で確認。ヘッダーの重なりを修正し、prompt buttonのmouse操作も成功。
- [x] 未送信のAI入力は送信成功時だけ消去。Ask／Edit切替とworkspaceのA→B→Aでroot別のmemory draftを復帰し、古い送信完了の消去をmount世代・revisionで拒否する。チャットの読込・rename・削除失敗をUI／Outputへ表示し、rename失敗時は編集を維持。production browserでmode切替・root別draft復帰、synthetic IME／229の送信抑止、キー未設定の送信でdraft保持・API requestなしを確認。native alert本文の目視は未確認。page errorなし、browser／5174 preview／tmux終了。5173維持・Git書込みなし。
- [x] 旧runtime自然終了3 failuresはUI2の全体1,788件で成功。旧shell TypeScript 5 diagnostics／runtime format 1件も後続の全体TypeScript・Biome検査で解消。
- [x] 専用5175の実UIで保存・復元失敗を注入。Ctrl+S失敗時のdirty編集・旧保存bytes・画面error・Output記録、復元失敗時の編集器未mount・復旧後の保存bytes復帰を確認。注入解除、fixture削除、専用browser・server終了。
- [ ] OSの実IME入力は未確認。model reset・dirty保存失敗・遅延処理はunit回帰で検証。Gemini実通信、認証付きGit、Safari実機、page全体400 MBの計測は既存TODOへ。

## UI2再監査・統合検証（2026-10-09）

- [x] review-ui 21項目／review-core 30項目を現行コードと回帰へ再照合。契約判断を要するprivate transport、壊れたlink回復、directory／tmp rename、WebPreview境界は既存TODOを維持。
- [x] Git statusのuntracked filenameをformatterのindentで区別し、`(notes).txt`・`git add later.txt`・headerと同名のfileを保持。空commit messageを保持し、使われていない旧log形式の分岐を削除。Git handlerの失敗・不正引数はstderr／exit 1へ伝え、dispatch回帰とproduction Terminalの`git status; printf ... "$?"`でstatus 1を確認。
- [x] 復元失敗をpath・reason付きでOutputへ通知し、編集器の未mountと`needsContentRestore`保持を回帰で検証。DnD、FileTree memo、scroll-lockの内部型を整理し、重複したeditor判定を削除。READMEとeditor／Git docsの古い契約も現行実装へ合わせた。
- [x] i18nは明示的な空fallbackをloaded／loading双方で保持し、辞書のown propertyだけを辿る。未使用`translatePlural`を削除。TODO scannerは`.git`／`node_modules`を再帰前にpruneし、regular fileのみ読む。FIFO／device／link・世代キャンセル・binaryの回帰を追加し、extension型とdocsを合わせた。
- [x] Productionの390 px／二pane表示でMarkdown export controlsの欠けを確認し、headerをwrap。最終bundleの実画面でPDF／PNG両buttonがpane内へ収まることを確認。folder picker、workspace作成、編集・保存・reload復元、Quick Open、Markdown preview、Git panel、30 extension entries・disable／enable、AI Ask／Edit draft保持を確認。page errorなし。
- [x] 専用dev originでwrite／read failureをAppの実FS singletonへ注入。保存失敗時はdirty buffer・旧disk bytes・UI alert・Output記録を保持し、解除後のCtrl+Sで保存。復元失敗時は空editorを開かず、解除後に保存bytesを復元。実OS permission／quota failureの再現とは区別する。fixture削除・注入解除済み。
- [x] 最終static snapshot: `tsc --noEmit`は0 diagnostics、Biome check／formatはsrc・localesの556 files成功、`git diff --check`成功。最終build成功（30 extensions、23 nonbundled TS transpiles、Vite 2.21 s）。旧diagnostics_channel callback failureは最終全体runで解消。
- [x] 最終全体Vitest `ui2-final-tests.json`: 213 files／1,803 tests、212 files／1,802成功・1失敗・pending 0。唯一の失敗は別担当の`tests/engine/cmd/shell/input.test.ts:116`でredirected while-readのterminal activate回数がexpected 1／actual 3。並行変更後の単独再検証は同file 25 testsすべて成功（08:10:43開始）。全体snapshotを全件成功へ書き換えない。
- [x] 自分のagent-browser・5174 preview・5175 dev・tmuxは終了。Stassheの5173を維持。Git書込み操作なし。各担当報告とbrowser screenshotはtask scratchpadの`ui2-*.md`／`ui2-*.png`に記録。
- [x] UI5でExtensions panelの管理UI文言を全20言語へ追加。操作・件数・確認・エラー・ZIP import・ARIAを翻訳keyへ統一し、sourceの参照key・全辞書のkey・補間parameterを回帰で検査。


## UI3実用シナリオ監査（2026-10-09）

- [x] `/tmp` symlinkを同一FS Core再初期化でも保持。GitHub URLを全体一致で検査し、dotted repo名を保持。divergent pullのincoming 100 filesとtwo-parent mergeの回帰追加。
- [x] Terminal Gitの正本cwdをUnixCommands.pwd()から取得。workspace外init/cloneと最寄りrepository探索、nested add/diff/reset/showのpathspecを修正。実Terminalでbranch divergence・commit・merge・clean status、main HEADとtwo parentsを確認。`pull --rebase`は通信前の明示エラー／exit1で、既存の未対応契約を維持。
- [x] Settingsのroot別read/merge/writeを直列化。実UIのfontSize17／tabSize4／wordWrap trueを連続変更し、settings.jsonとreload後のUI値を確認。
- [x] AI ReviewのJSONを含むtab IDでCSS selectorが壊れて全画面が落ちる経路を除去。root paneのmousemove targetとseparatorを含む幅計算を修正。pane間の実mouse DnD、root divider移動、file内容保持を確認。
- [x] AI Review適用後のchat状態を保存済みsnapshot通知で同期。既存fileの適用・巻き戻し、新規fileの適用・削除、後から手編集したfileの巻き戻し拒否を実操作で確認。外部更新をMonacoが同内容で再通知した時にdirtyを立てないよう修正し、開いたfileのChat Revertも成功。実store回帰33件成功。
- [x] Extension install失敗後も保存済みdisabled packageを一覧へ反映。language pack無効化eventにmanifestを含め、onlyOne置換を明示。日本語install/enable、手動disable→英語、html.lang・locale保存・reloadを確認。TODO Scanner install/disable/enableも確認。
- [x] 40,000行／2,560,000 bytesのfileを開き末尾編集・保存（保存後2,560,001 bytes）。1,200 filesの最後のfileをQuick Openで開いた。保存後の全file数とlarge fileの末尾bytesを再確認。390 px／二root paneでAI Reviewのtitle/path/actionsをwrapし、全操作buttonがviewport内へ収まることを確認。
- [x] 最終static: TypeScript0 diagnostics、Biome check/format src・locales561 files成功、diff check成功。最終buildは30 extensions／23 TS transpiles、Vite2.42 s。最終全体snapshot ui3-final-tests-2.jsonは222 files／1,907 tests、1,906 pass・1 fail・pending0。失敗は別担当runtime/webStreams.test.ts:243（単独追試も8件中7成功・同じ1件失敗）。先行snapshotのruntime listener3件とshell fnmatch1件は後続全体で成功。
- [x] 自分のbrowser ui3-practical・5175 preview・tmux ui3-dev終了。fixtureのOPFS workspace2個／AI review metadata／chatを削除、固定検証bundle60 MBも削除。Stassheの5173と他sessionのbrowserを維持。host Git書込みなし。
- [ ] 実GitHub pushはStassheの明示指示で実行禁止。公開repoのclone/pullとmock内のpush DAG回帰のみ。実push検証にはStassheの判断が必要。公開clone/pullは先行実UIで成功したが、最終再確認はCORS proxy経由のFailed to fetchで失敗。通信が戻った後の再確認を残す。
- [x] UI4でTerminal promptのbranch取得元もlive cwdの最寄りrepositoryへ統一。実Terminalでnested cwdのfeature-ui4表示、repository外の`/tmp`ではbranch非表示、別repositoryではmain表示を確認。初期workspace固定のGitCommands refを削除し、focused回帰20件成功。
- [x] UI4でMonaco終了errorを根本修正。CDPで`TextModel got disposed before DiffEditorWidget model got reset`と旧runtime 0.55.1のWordHighlighter由来`Canceled`を特定。modelを切り離してから親が破棄し、editor.disposeはwrapperだけが担当する。loaderのCDN版はinstalled packageのversionへ揃える（今回0.56.0）。固定production bundleの実Apply・tab終了・390pxでのChat Revertでwindow error／unhandledrejectionなし、Terminal readbackで適用後・巻き戻し後のbytesを確認。
- [x] UI4で幅640px以下はExplorer・editor・AIを同じflex比率で縦に配置。390×844／390×600で両sidebarとTerminalを開き、scrollWidth390、editor操作・保存を確認。desktopではfixtureの保存幅240／240へ復帰。横resizeはmobileで隠し、下部panelはeditor領域の40%以下へ縮む。README・editor domainを更新。

## UI4追加監査・検証（2026-10-09）

- [x] directory指定のGit diffが配下fileを漏らす不具合を修正。staged・worktree・commit比較、root `.`、nested cwd `.`、trailing slash、sibling prefixを回帰で確認。Git／Terminal focused 25件成功。
- [x] file読込待ちのpane splitが、競合して追加されたpane treeを上書きする不具合を修正。await後にworkspace/session・leafを再確認して最新treeからIDを採番。deferred read回帰を含む10件成功。
- [x] desktop dragのinline width／heightがmobile CSSを上書きする経路を修正。CSS custom propertyだけを更新。固定bundleでleft300px・Bottom265pxへresize後に390×600へ切替し、両sidebar342px・Bottom72.8px・editor47px・横overflowなしを確認。
- [x] extension／i18nのinstall・enable・disable・言語pack置換・locale path・html.lang、FS／OPFS／FIFOの保存契約を再監査。追加の再現可能な不具合はなかった。不要なTerminal workspace固定GitCommands refを削除。
- [x] UI4 snapshot: build 30 extensions／23 TS checks、1.98秒。tsc exit0、Biome format src＋tests 744 files成功、Biome check src＋tests exit0（既存hook warnings2・literal-key infos6は変更せず）、diff check成功。全体Vitest225 files／1,925 tests、224 files／1,924 pass・1 file／1 fail（135.6秒）。前回webStreams失敗は今回再現なし。
- [x] UI4時点で残っていた`lineRenderer.test.ts`の背景出力保持失敗はShell6で修正。production Terminalの155列→42列resize後、長い入力の再描画後も最新出力がvisibleであることを確認。Terminal focused suite 3 files / 22 tests pass。

## Shell6 実端末監査・最終検証（2026-10-09）

- [x] Vim word motionはUnicode code point走査へ統一し、astral letter `𐐀abc`を1つのkeywordとして`w`/`e`/`x`を確認。検索・置換はJavaScript regex Unicode mode。zero-width searchは`😀x`、`abc`、空行、`z`で10件を列挙し、`:%s/(?=.)/_/g`は6置換。保存後readback、`u`/Ctrl+Rも成功。旧`node -e` ENOENTは別担当の後続検証で解消済み。
- [x] Unix実端末: `grep -f`空pattern fileはstatus 1、`grep -ov alpha`はstdout空・status 0、`wc`のcount列は共通桁幅、`tail -n -2`は`beta`/`gamma`。file-backed Nodeで生成したbytes `[255,10,254,10]`に対し`head -n1 | wc -c`と`tail -n1 | wc -c`はいずれも2。
- [x] Production Terminal 390px（42×11）: Ctrl+←で`foo/bar`の`bar`先頭へ移動して`foo/Xbar`、Home後Ctrl+→で`one`の末尾へ移動して`oneX  two`を確認。background `seq 25`出力とCSI `1G`後、長いUnicode入力（960 UTF-16 code units）を155列から42列へresizeしHome/→で再描画しても最新出力を表示。155列へ戻してEnter後も全960 code unitsを保持。page errorなし。
- [x] 全体Vitest snapshot `227 files / 1,951 tests`: 223 files / 1,947 pass、4 files / 4 fail（140.17秒）。その後のfocused追試で4 filesの失敗を個別に再確認し、3 filesはpass。担当外の`moduleCode.test.ts`はsourceが09:18:08に更新された後、09:23:10の再追試で15/15 pass。全体snapshotはこの後に再実行していないため、全体passとは扱わない。
- [x] 最終`tsc --noEmit` exit 0、production build exit 0（Vite 2.03秒）、Biome src 508 files / 190 ms exit 0、`git diff --check` exit 0。Terminal focused suite 3 files / 22 tests pass。確認した最大の担当sourceはVimEditor 781行、ClientTerminal 778行。
- [x] 検証後のcleanup: guest `/tmp/shell6-*` 7 files削除後にfresh prompt、`shell6-review` agent-browserをclose、`shell6-preview` tmux sessionを終了。5173と他sessionは維持。

## UI5追加監査・統合検証（2026-10-09）

- [x] `openTab`がfile読込開始時のroot／session世代を保持し、旧sessionの完了による新paneへの追加・同IDタブの内容上書き・activateを防ぐ。新規tabと既存tab refreshのdeferred回帰を追加。関連3 files／48 tests成功。未使用のCodeEditor callback／Bottom寸法propsを削除。
- [x] `.gitignore`のwhole-component `**/`を0階層以上へ修正。`a/**/b`の直下・深いpath、nested scopeとsibling除外を検証。不正な文字classは非matchとして検索を継続。Settingsはroot Aの遅延read中にもroot Bを保存できる回帰を追加。core focused4 files／37 tests成功。
- [x] Extensions管理UIの操作・確認・error・ZIP import・ARIA・検索・件数を全20言語へ統一。pack件数はmanifest groupの実member数から翻訳し、未使用の英語description生成を削除。AI変更一覧の日本語固定titleも既存keyへ変更。provider failureが送信元chatへ保存される回帰を追加。最後の翻訳／helper追試は2 files／3 tests成功。
- [x] 全体Vitest `ui5-final-tests.json`: 228 files／1,960 testsすべて成功・pending0（09:21:46開始、138.96秒）。旧UI4のlineRenderer失敗とShell6／runtimeの中間失敗もこのsnapshotでは成功。その後のpack件数・翻訳label修正は上記focused追試と最終buildで確認。古い失敗snapshotの記録は保持。
- [x] `tsc --noEmit` exit0。全体Biome src／tests 750 filesのcheck／format exit0（既存hook warnings2・literal-key infos6あり）。最終担当14 filesのBiome checkとdiff checkも成功。最終buildは30 extensions／23 TS checks、1.94秒、固定bundle `index-DzVU1M8f.js`。
- [x] agent-browserでworkspace作成／folder切替・再開、file編集・Ctrl+SとTerminal bytes readback、Quick Open、Markdown二pane preview、guest Git init／32 files stage／commit／clean status、Binary Editor disable／enable、日本語packと管理文言を確認。30 filesのsynthetic AI提案を1件適用してbytes0→1、Chat Revertで1→0、残29件一覧と390×600の入力を確認。主要操作中のwindow error／unhandledrejection0。実Gemini通信とGitHub pushは実行していない。
- [x] READMEとeditor／filesystem／extensions／i18n domainを現行契約へ更新。実Terminalで翻訳cache削除は`pyxis i18n clear`を確認し、docsの古いcommand表記を修正。
- [x] 専用workspace・fixture chat・AI Review・Quick Open履歴・tab session・recent folderを削除し、全項目の不在を確認。自分のui5 browser／5176 server／tmuxを終了し、固定bundle・専用profileを削除。5173と他sessionは維持。host Git書込み・実GitHub pushなし。
- [x] Shell helpのusageを`pyxis i18n clear [locale namespace]`へ修正し、既存test expectationも更新。内部`i18n-clear` handler actionはdispatch正規化との契約上維持。focused 4/4、Biome 3 files pass。
- [ ] Private Git transport／壊れたlink回復／directory rename契約／WebPreview境界／opaque API／実IME・Safari・大規模memory計測は既存TODOを維持。

## Shell6 統合suite再追試（2026-10-09）

- [x] Rootfull1（09:25:14、138.29秒）は228 files / 1,961 tests全pass。該当4 source/testのhashはbefore/after不変で、外部5 filesは実行中に変更されていた。
- [x] Node runtime調査では、旧`execArgv` assertionが消えていたことと、test helperのstart型・post・Worker executeからsource/`execArgv`が渡っていなかったことを確認。runtime agentのassertionのみ復元し、`[]`と`['-e', source]`の差を再現した。
- [x] Rootfull2（09:32:40、141.65秒）は228 files / 1,968 tests、225 files / 1,965 pass、3 fail。1 failは復元した`execArgv` assertionで、残る2 failは実行中に編集中の外部runtime領域: childProcessModuleのalready-aborted時`onAbort`初期化順序とqueued finish、eventsIteratorのdescriptor identity。該当source/testsはfull run中にも更新されていた。
- [x] 修正後のruntime helper focused suiteは12/12 pass。Rootfull1/2の差から全失敗の根因やflakeを断定せず、全体suiteの完了とも扱わない。
- [x] Production browser: numeric Vimの`lll jjx`で`abcd`／`x`／`wxy`を保存し、EOFでの`G$ekkx`も保存を確認。`node --eval`の実`process.execArgv`にflagとsourceが一致すること、`head -v` stdin header、grepの不正context `1foo`拒否、`wc -cm`出力`1 2`、`pyxis i18n clear`、implicit stdinの`grep -l`/`-L`/`-lc`を確認。2 fixture不存在、page errorなし。browserとdev server停止済み。
- [x] 最新focused scopeは78 files / 843 tests全pass（09:52:25、25.99秒）。全体TypeScript exit 0、Biome 755 files exit 0（既存warnings 2・infos 6）、`git diff --check`成功。
- [x] Rootfull3 fixed-input regular順（09:56:21、139.02秒）は231 files / 2,007 tests全pass。固定inputのSHAは実行後も不変。
- [x] 同じfixed inputのRootfull4 shuffle（seed 1009、09:58:53、149.86秒）は231 files / 2,007 tests、230 files / 2,006 pass・1 file / 1 test fail。`nodeRuntime.test`の`cancels execution timers and drops output callbacks on disposal`が10,051 msでtimeout。全input SHAはshuffle後も不変。前回4 caseはregular/shuffle双方でpass。
- [x] 原因は`nodeRuntime` format-precedence testのfixture共有。MJS実行でfixtureがruntimeをdisposeした後、同じdisposed runtimeでinvalid CJSを実行し、二度目のdisposeが早期returnしてguest `setTimeout`を残していた。host timer identity assertionはSIGINT testではなくこの先行testの汚染を特定した。2回目を同じMemoryFSのfresh fixtureに分け、毎test後にhost timer復元をassertする修正はseed 1009 focused 53/53 pass。production runtime変更なし。
- [x] `nodeRuntime.test`から4 casesを`moduleFormat.test`へ抽出し、`nodeRuntime.test`789行・`moduleFormat.test`85行。case欠落なし。seed 1009 focused 53/53 pass。
- [x] Production browser: Vim `lll jjx`保存後readback `abcd`／`x`／`wxy`、implicit stdin `grep -l`のfilename出力、`tail -v` stdin header、`wc -cm`の`1 2`を確認。`node --eval`から`child_process.spawn('cat')`へ`stdin 日本語`を渡し、EOF後のJSON stdoutとstatus 0を確認。page errorなし、fixture不在、専用browser／dev server停止。
- [x] 最終static: `tsc --incremental false` exit 0、Biome src/tests＋new tests 755 files exit 0（既存warnings 2・infos 6）、`git diff --check` exit 0。production build exit 0（30 extensions、23 TS checks、Vite 1.95秒、`index-x63qAMBy`）。
- [ ] Rootfresh fixed-input whole-suite run 5は実行中（live/copy全input SHA一致、実行中もfixed）。結果後に同一inputのseed 1009 shuffleを実行する。全体検証完了とはまだ扱わない。

## UI6追加監査・統合検証（2026-10-09）

- [x] directory renameのsource削除失敗後、rollbackしたsource／保持したdestinationの実metadataを通知。部分削除・削除前失敗でProjectTreeとFS walkの一致を回帰追加。成功時のrename eventは1件を維持。
- [x] recursive rmの部分失敗後、physical parentが残るsymlink／FIFOだけを復元。通知ありの単独rmは対象subtree metadataの差から実際に消えた最上位pathを通知し、survivorを誤削除しない。fresh FsCore再初期化とProjectTree一致を検証。最終handles／links50 tests成功。
- [x] WebPreviewのload世代で旧pathのcontent／error／title完了を拒否。読込中を含むlocal dependency、workspace外asset、祖先rename／delete、directory root配下変更を追跡。無関係fileは再読込しない。最終WebPreview3 tests、関連先行6 suites61 tests成功。
- [x] AI prompt履歴を既存ChatSpaceMessageの必要fieldへ型付けし、source／提案file内容をsummaryへ漏らさない回帰追加。未使用prepareAITextWriteとnavigator.userLanguage fallbackを削除。navigator.languageのfr-FR→fr pack選択を検証。AI／extensions focused5 files29 tests成功。
- [x] TypeScript exit0、全体Biome check／format755 files exit0（既存warnings2／infos6）、最終担当12 filesのBiomeとdiff check成功。最終buildは30 extensions／23 TS checks、Vite1.96秒、index-Ckt3cwPU.js。
- [x] agent-browserの最終bundleでExplorer→WebPreview、実Terminalの参照CSS保存で色変更、無関係file作成でDOM維持を確認。window error／unhandledrejection0、390×600で横overflowなし。3,000 symlinkの実FS測定と削除後不在確認は上記残課題欄へ記録。
- [x] README／filesystem／markdown-preview／STORAGE_INTENT／directory-structure／review-ledgerを更新。fixture、自分のbrowser／5176／ui6-dev tmux、固定bundle／専用profileを削除。5173と他sessionを維持。host Git書込み・実GitHub pushなし。
- [x] 全体Vitest初回は09:44:35開始、ESM evaluation22 tests完了後にrunner／forkがIPC接続を保持したまま待機。8分超で自身のrunnerへSIGINT、exit130。原因未確定で成功snapshotとは扱わない。専用tmuxでの再実行は09:53:27開始・148.17秒、231 files／2,014 tests、227 files／2,008 pass・4 files／6 fail・pending0（ui6-final-tests-retry.json）。失敗は外部runtime11作業中のchild stdin 3件とstring_decoder 3件で、該当source/testsも並行更新中だった。ui6-runtime-validation-handoff.mdへ記録。自分のtmux終了済み。
