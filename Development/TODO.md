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
