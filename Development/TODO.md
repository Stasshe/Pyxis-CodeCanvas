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
- [ ] `pnpm run test --maxWorkers=2`: 53 files / 441 tests、369 passed・72 failed。4 shell E2E suiteの失敗はHEADにもある未対応機能で、parser / runner変更に起因しないと確認済み: env expansion 26（`unset`・高度なparameter展開）、error handling 13（`set`・`trap`・group・`$?`）、pipeline 11（`tr`・`xargs`・`tee`・`sleep`・group・heredoc、head/tailのstdin非対応）、subshell 22（`()`, `$((...))`, process substitution、command substitution）。
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

## Workspace startup verification (2026-10-06)

- [x] Folder選択前のactive editor paneは空。file treeの`FileItem`はmetadataのみを持ち、fileを開いた時にfilesystemからcontentを読む。
- [x] Global `format` / `lint` (372 files)、`tsc --noEmit`、build (30 extensions、25 TypeScript checks、Vite Worker・Service Worker bundle) 成功。`git diff --check`も成功。
- [x] Focused tabState regression: 3 files / 11 tests passed。
- [ ] Whole suite: 56 files / 460 tests、52 files / 388 passed、4 files / 72 failed、0 skipped。失敗は既記録のenv expansion (26)、error handling (13)、pipeline (11)、subshell (22) suiteのみ。
- [x] Browser verification: agent-browserでdesktop (1280×900) とmobile (390×844) を確認。folder選択、file open/edit/save/reload、Terminal、Node実行、binary-editorを検証。final buildのextension JSは200、欠落assetは404を確認し、browser sessionを終了。

## Binary byte preservation audit (2026-10-07)

- [x] `format` / `lint` (377 files), `tsc --noEmit`, build (30 extensions, 25 TypeScript checks), and `git diff --check` passed.
- [x] Focused binary regressions: 35/35 passed; extension tab identity 1/1 and inline-asset regressions 3/3 passed. Final ExtensionTab factory regression: 4 suites / 13 tests passed (TabAPI, openTab, contentSync, fileLoading).
- [ ] Full suite: 71 files / 519 tests; 446 passed, 73 failed. One obsolete SVG expectation was fixed in focused coverage; the remaining 72 failures are the known shell E2E suites (env expansion 26, error handling 13, pipeline 11, subshell 22).
- [x] Browser verified byte-signature PNGs, misleading extensions, Markdown/HTML local assets, zero-byte hex editing, exact-byte save, canceled close/discard dialog preservation, raw download and ZIP hashes, runtime stdout/pipeline bytes, UTF-8 BOM preservation, and reload restoration. Final page errors: none.
- [x] TabBar menu portal/clamping: actual row right-click opened Preview and rendered Markdown; no console errors.
- [ ] Safari device and 400 MB memory checks remain open above.

## OperationWindow verification (2026-10-06)

- [x] `format` (373 files, 1 fix), `lint` (373 files), `tsc --noEmit`, `git diff --check`, and build (30 extensions, 25 TypeScript checks) passed.
- [ ] Whole suite: 58 files / 469 tests; 397 passed, 72 known shell E2E failures, 0 skipped. Failures: env expansion (26), error handling (13), pipeline (11), subshell (22).
- [x] agent-browser desktop (1280×900) and mobile (390×844): picker modes, configured/custom shortcuts, MRU, excludes, line/column jump, split open, AI context, rename, and workspace creation verified; no console errors. Browser sessions closed.
- [ ] Safari device and 400 MB memory checks remain open above.

## Git worker and diff verification (2026-10-07)

- [x] Git status matrix formatting covers staged additions, modifications, deletions, and simultaneous index/worktree changes. Latest focused regression: 5 suites / 17 tests passed, including clean diff refresh and unsaved diff preservation.
- [x] Full `format` and `lint` passed for 380 files; one initial import-order lint failure was fixed and the full lint rerun passed. `tsc --noEmit` passed. Final build passed with 30 extensions, 25 TypeScript checks, and 5,116 Vite modules.
- [ ] Full suite before the final diff regressions: 74 suites / 526 tests, 454 passed and 72 failed. The four known shell suites account for all failures: env expansion 26, error handling 13, pipeline 11, and subshell 22. Final focused coverage passed 5 suites / 17 tests.
- [x] Browser desktop (1280×900) and mobile (390×844), after reload: Git init/status/stage/commit/history, staged read-only and unstaged editable diffs, repeated opening of the same diff with refreshed clean content, terminal diff/status/commit, branch/checkout/log, filtering persistence, and mobile panel restoration. No page errors. Production bundle smoke also passed.
- [ ] Safari device and 400 MB memory checks remain open above.

## Git and project tree refresh performance (2026-10-07)

- [x] Same warm agent-browser profile and demo workspace (25 tracked files, 2 commits). The `README` fixture was modified versus `HEAD`, and its contents stayed unchanged between pre/post runs. The index was reset between staging runs, with the same `HEAD` and warmed tracked blob. Previously, the `.git/index` update caused one Explorer root walk: 327.9 ms across 49 recursive calls. Structural-only tree refresh reduced this to zero walks for staging.
- [x] Git-panel mount: main-thread outbound Git RPC calls 25 → 5, status calls 5 → 1, and FS Core stats 750 → 150. First Git API call to last matched reply took 1,674 → 204.9 ms. From the same Chrome Performance artifact, main `RunTask` duration was 214.57 → 86.74 ms and FS Worker duration was 488.21 → 92.28 ms. These durations include DevTools/CDP overhead; only tasks containing the profiler-start marker were excluded from `RunTask` totals.
- [x] Stage operation: Git RPC calls 11 → 6, status calls 2 → 1, and FS Core stats 581 → 269. First Git API call to last matched reply took 855.2 → 443 ms; the after RPC span includes the 100 ms filesystem-event debounce. Main `RunTask` duration was 127.27 → 76.48 ms and FS Worker duration was 267.93 → 139.94 ms. Core durations overlap and are not wall-clock totals.
- [x] In the same Chrome Performance artifact, the raw post-mount main task was 385.95 ms and contained a nested 344.74 ms DevTools CPU-profiler startup session. This is instrumentation overhead, not Git work. The pre-mount Worker trace had a 139 ms Major GC task; the prestage Worker maximum was 22.85 ms. Chrome Performance and FS Worker/RPC captures are in the task scratchpad; `git-final-trace-summary.json` contains the timing summary. These are single warm development-fixture measurements, not general benchmarks.
- [x] Focused regressions: 3 suites / 11 tests passed. Final format and lint passed for 381 files; TypeScript and build passed (30 extensions, 25 TypeScript checks). Full suite: 76 files / 537 tests, 465 passed and 72 failed; all failures are the known shell suites (environment expansion 26, error handling 13, pipeline 11, subshell 22).
- [x] Final agent-browser checks: stage/unstage, commit cleared staged entries and updated history to 3 entries, terminal branch creation/checkout, two-file create/rename/delete reflected in Explorer while `.git` stayed visible, All-branches filter persistence after reload, one call each for status/branch/remotes/available branches/log, exact `README` restoration after discard, and Git diff opening. No page errors; the owned `git-perf` browser session was closed.
- [ ] Large `node_modules` trees, Safari behavior, and the 400 MB page-memory budget remain unmeasured; see OPFS migration checks above.
