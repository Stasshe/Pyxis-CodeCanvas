# ディレクトリ構造案

現状の構成と依存を調べ、移動候補を提案する。これは実施計画ではなく、Stassheの判断前に変更を行わないための案である。`src/engine` の名前は維持する。

## 計測

2026-10-09の観測snapshot。調査中も別セッションがsourceを変更しているため、数値は固定値ではない。`rg --files` の結果を集計した。これはignore対象を除く可視ファイル数で、生成物や依存物を含めた全ディスクファイル数ではない。対象ソースは import 宣言の `from '@/…'` を数え、配置単位間の依存方向を確認した。依存解析は動的ロード、文字列ベースのレジストリ、外部ビルド処理を完全には追跡しない。

| 範囲 | ファイル数 | 内訳・所見 |
|---|---:|---|
| `src/` | 422 | `engine/` 265、`components/` 102、`hooks/` 18、`stores/` 14。残り23は `context/` 4、`types/` 8、`constants/` 3、`styles/` 2と直下ファイル等。 |
| `extensions/` | 78 | `lang-packs/` 40。共有API、レジストリ、各拡張機能を同居させている。 |
| `scripts/` | 64 | `bench/` 28、`i18n/` 16、`extensions/` 14、`build/` 3と直下スクリプト。 |
| `tests/` | 116 | `engine/` 91、`_helpers/` 9、`components/` 6、`stores/` 4、`hooks/` 2、直下4。 |

通常の `rg --files scripts` は `.gitignore` で除外される `scripts/bench/npm-install/results/` を含まない。この結果ディレクトリには追加で153ファイルがあるため、28件のbenchmarkソース・fixtureとは分けて数えた。

`src/engine/` の主な内訳は `cmd/` 124、`runtime/` 54、`core/` 25、`extensions/` 16、`tabs/` 14、`i18n/` 5、`storage/` 5、`user/` 3、`helper/` 3、`in-ex/` 7、その他である。`cmd/` と `runtime/` が合計178ファイルで、engineの大半を占める。

### 依存方向

`from '@/…'` を数えた結果、UIからengineへの依存は多い一方で、逆向きの依存も残る。

| 起点 | engine | components | hooks | stores | context |
|---|---:|---:|---:|---:|---:|
| `components/` | 80 | 27 | 21 | 29 | 98 |
| `hooks/` | 20 | 0 | 0 | 12 | 0 |
| `engine/` | 212 | 10 | 6 | 25 | 2 |

engineからcomponentsへの10 importは8ファイルにあり、すべて `engine/tabs/builtins/` 配下である。`TabType` としてUI表示を登録する構造のため、engine配下の実装が表示コンポーネント、Paneコンテキスト、hooks、storesへ直接依存している。別途、`engine/helper/resize.ts` が `hooks/ui/useResize.ts` を参照する。これは依存グラフ上の逆流であり、配置と責務の境界を曖昧にしている。

## 提案する配置

| 現状 | 提案 | 理由と影響 |
|---|---|---|
| `src/engine/tabs/builtins/` のUI実装 | `src/app/tabs/builtins/` など、UI組立層へ移す。`engine/tabs/` には登録型・純粋なregistryを残す。 | 10件のengine→components依存を境界で解消し、実装と登録を分けられる。移動対象のimport、タブ登録順、循環依存をまとめて直す必要があり、ファイル移動だけでは完了しない。 |
| `src/engine/helper/resize.ts` | `src/hooks/ui/` へ移すか、`useResize` を利用する層に置く。 | engineからhookへの1つの逆依存をなくす。既存importの更新が必要。 |
| `src/engine/extensions/` のUI統合 | extension機構の中核はengineに残し、hooks/storesと結ぶ初期化・コマンド登録はUI組立層に寄せる。 | engineからhooksへの6件、storesへの25件の依存を段階的に減らす。現在は `TabAPI`、`systemModules`、logger等で横断しているため、一括移動すると公開APIと初期化順に影響する。 |
| `src/engine/cmd/global/{gitOperations,npmOperations,unixOperations}` | `src/engine/cmd/global/{git,npm,unix}` と短縮し、コマンド実装は命令名中心に置く。現在の `npmOperations/npmInstall.ts` は `npm/install.ts` とする。 | `gitOperations/` 26、`npmOperations/` 14、`unixOperations/` 38ファイル。親の `cmd/global` で役割が分かるため、leaf名と `npmInstall` の `npm` 重複を減らせる。移動時は各handler、runtime呼び出し、テストimportの一括更新が必要。 |
| `src/engine/commitMsgAI.ts` | `src/engine/ai/commitMessage.ts` などAI機能のまとまりへ移す。 | 実装の1ファイルはengine直下だが `Left/GitPanel.tsx` がAIによるcommit message生成として利用する。配置がAI機能から離れており、ファイル名も略記が強い。移動自体は単純だが import 更新が必要。 |
| `src/engine/in-ex/` | `src/engine/importExport/` など、機能が分かる名前に展開する。 | 7ファイルの内訳はfolder/repo/single-file export、page/PDF export、single-file import、HTML asset処理。略称は検索と初見の理解を妨げる。移動でimportを直す必要がある。 |
| `tests/engine/npm/` | 実装側の短縮後の区分に合わせ `tests/engine/cmd/global/npm/` に置く。 | npm実装はengine/cmd配下だが、テスト12件は独立した `engine/npm` にある。ファイル探索と実装・テストの対応が分かりやすくなる。Vitestのglobは維持できるが、相対パスとfixture参照を更新する。 |
| `tests/components/` | `src/components/` と同じ階層をテスト側に保ち、直下の `markdownMath.test.ts`・`mermaidConfig.test.ts` は対応するTab/MarkdownPreview相当の場所に寄せる。 | 現在component配下テストは6件で、source側102件に対して薄い。共置ではなく既存の集約型テスト配置を保つため、現在の `tests/**/*.test.ts` 探索規則を変えずに済む。全102コンポーネントにテストを作る提案ではない。 |
| `scripts/bench/` | `scripts/bench/` 内でrunner・fixture・結果を機能ごとに保つ。必要なら生成結果を `scripts/bench/**/results/` から管理対象外の出力先へ分離する。 | 現状28ファイルで2領域に分かれており、独立したbenchmark群としては既にまとまっている。rootへbenchmark専用ディレクトリを新設すると、runnerとfixtureの相対パス、設定を広く変えるため、現段階では移動利益が小さい。 |
| `src/types/` | 共通のアプリ型を残し、`*.d.ts` の外部module宣言は利用する機能の近くか専用のvendor型ディレクトリに寄せる。 | 実行時に使う共有型とambient declarationは役割が異なる。後者はimport元を持たずtsconfigのincludeで認識されるため、移す場合はinclude範囲を確認する必要がある。 |
| rootの作業用・運用ファイル | `helper-code.txt` は削除候補。`tree.sh`・`tree-built-out.sh` は `scripts/tools/` へ移し、生成 `tree.txt` を管理対象外の出力先へ置く。`i18n.sh` は `scripts/i18n/` に寄せる。 | `helper-code.txt` は4行の利用断片で参照元がない。`tree.txt` は `pnpm run tree` が生成・上書きするroot直下の調査出力。`tree-built-out.sh` は `out/` を検索するがViteの `build.outDir` は `dist/` なので、現状の出力先が古い。移動時に `package.json` のscriptと出力先を合わせる必要がある。 |
| `FreeAPIGenerativeAI-Model.md`、`SHORT_README.md`、`System-Design/COMMAND-EXECUTION-ARCHITECTURE.md` | 日常運用資料は適切なdocs領域に移し、Root直下のREADMEはREADMEとREADME_enに限定する。 | AIモデル資料は2025年8月時点の価格・無料枠を含み、更新されないと古くなる。SHORT_READMEはREADMEと製品説明が重なる。System-Designの設計書はdocsと別の文書ルートにある。移動先と保守者を決める必要があり、資料内容自体の削除を意味しない。 |

`extensions/` は `extensions/_shared/` が型API、各子ディレクトリが拡張機能、`lang-packs/` が40ファイルの言語パックという役割でまとまっている。`scripts/build/build-extensions.js` は先頭が `_` のdirectoryを走査対象から除外するため、`_shared` の名前はbuild規則に依存する。名称変更はbuild対象の誤認識を招く。root直下の `vite.config.ts`、`vitest.config.ts`、`tsconfig.json`、`package.json` 等はツールが自動探索する設定として妥当な場所にある。

## 変更時の弱点

- `src/engine/` の依存逆流は、表示だけではなくhook/store/contextを使ったアプリ統合にも及ぶ。移動後の依存グラフを先に決めずに分割すると、別の循環や `app/` への責務集中を作る。
- testsの配置変更は機械的な対応に見えるが、Vitest設定、relative import、fixtureのパスが同時に変わる。移動単位ごとに解決する必要がある。
- sourceと同形のテスト配置は、移動先の命名を固めてから一括で合わせる。npmだけ既存階層を維持したまま他のengine領域を短縮すると、テスト配置が二重化する。
- benchmark結果やツリー出力は、再現性のため意図して追跡している可能性がある。出力先変更の前に、現在の生成・比較方法を確認する。
- ファイル数は責務の大きさや変更頻度を表さない。今回の件数だけを根拠に大きな分割やworkspace化は行わない。

## 付録: 未使用候補

以下は削除確定ではなく、静的参照が確認できなかった候補である。削除前に実行時ロード、設定ファイル、外部利用、workspace/build依存を確認する。

### ファイル候補

| 候補 | 根拠 | 注意 |
|---|---|---|
| `helper-code.txt` | 内容は `pushMsgOutPanel` の利用例だけで、コード・設定・READMEから参照されていない。 | 開発メモとして残す意図があるかは静的に判定できない。 |
| `tree.txt` | `tree.sh` と `tree-built-out.sh` が生成する集計結果で、package script `tree` が出力を更新する。 | 生成手順の出力を追跡する運用かもしれないため、削除ではなく出力先変更を候補とする。 |
| `src/engine/extensions/transformImports.ts` | sourceにimport元がなく、export関数も宣言以外のsource/test参照なし。extension loaderはbuild時に処理済みとコメントし、別の同名build処理は `scripts/build/build-extensions.js` にある。 | 動的参照や別セッションのbuild変更がないか確認する。 |
| `src/components/Tab/MarkdownPreview/index.ts`、`src/engine/cmd/app/vim/index.ts` | ASTで解決したimport元がなく、利用箇所は各実装fileを直接参照している。 | 内部barrelを公開入口として使う意図がないか確認する。 |
| `tests/_helpers/localNpmPackage.ts` | test suiteからの参照がなく、`installLocalTestPackage` にも宣言以外のsource/test参照がない。 | local packageのtest helperとして残す意図があるか確認する。 |

TypeScript ASTでimport/export/`import()` を解決し、aliasと相対pathを含め609 moduleを走査した時点では、189 moduleにimport元がなかった（`src/` 16、`extensions/` 31、`scripts/` 35、`tests/` 107）。`tests/**/*.test.ts` に一致するtest fileはrunner entrypointなので、このうち107件を通常の未使用候補としない。extensionsの31件はmanifestやregistryで読むentrypoint、language pack、sample build script等で、静的importがないのが通常である。scriptsの35件はCLI/build entrypointまたは拡張機能templateである。

### package候補

`depcheck --json` の結果と、`src/`・`scripts/`・`tests/`・`extensions/`・主要設定からの文字列検索を照合した。`depcheck`の未使用判定はVite alias、PostCSS設定、型宣言、transitive dependencyで誤判定するため、設定上の利用が確認できるものは除外した。

| package | 分類 | 根拠・確認事項 |
|---|---|---|
| `jschardet` | dependency | import・require・設定参照を確認できず、depcheckも未使用判定。 |
| `readable-stream` | dependency | 直接importを確認できず、depcheckも未使用判定。stream系packageの推移依存として必要かlockfileと利用元を確認する。 |
| `@babel/helper-plugin-utils` | devDependency | repository source/configからの直接参照がない。推移依存用途を確認する。 |
| `@tailwindcss/postcss` | devDependency | 直接参照がない。現行 `postcss.config.js` は `tailwindcss` と `autoprefixer` を指定しており、Tailwind v4用packageを使っていない。 |
| `@types/d3` | devDependency | `d3` 型の直接利用を確認できない。 |
| `@types/react-syntax-highlighter` | devDependency | 対応する実装packageと型参照を確認できない。 |
| `@welldone-software/why-did-you-render` | devDependency | source・起動処理からの参照を確認できない。 |
| `cli-table3` | devDependency | scriptsからの参照を確認できない。 |
| `es-abstract` | devDependency | source・configからの参照を確認できない。推移依存用途を確認する。 |

`autoprefixer` は `postcss.config.js`、`crypto-browserify`・`events`・`os-browserify`・`process`・`vm-browserify` は `vite.config.ts` aliasまたは `src/polyfills.ts`、`buffer` はsource import、`string_decoder` はNode runtimeから利用する。`assert`・`util`・`url`もVite aliasとNode runtimeで利用するため、depcheckの未使用判定では削除しない。TypeScriptはTSツールチェーンに必要。

`depcheck` と `ts-prune` は手動監査用として保持する。2026-10-09の追加監査でも実行し、package参照と未使用export候補の抽出に使った。CI判定には使わない。depcheckはaliasや末尾slash付きpackage importを誤判定し、ts-pruneは動的登録・公開API・test利用を追えないため、結果をsource／config／testの参照と照合してから削除する。

### export候補

`ts-prune --project tsconfig.json` の出力をTypeScript/testソース中の識別子検索で確認した。extension API、manifest経由の `activate` / `deactivate`、barrelの再export、テストから使われる値、`engine/helper/resize.ts` のApp利用hookは候補から除外した。以下はsourceとtestのテキスト検索で宣言以外の利用が見つからなかったexportであり、文字列ベース利用や外部利用を含めて最終確認が必要である。

| ファイル | export候補 |
|---|---|
| `src/stores/loggerStore.ts` | `clearAllLogs` |
| `src/stores/tabContentStore.ts` | `clearDirtyFlag`、`useTabDirtyState`、`useBufferContent` |
| `src/stores/terminalHistoryStorage.ts` | `clearAllTerminalHistory` |
| `src/engine/ai/contextBuilder.ts` | `findCustomInstructionsFromFiles` |
| `src/engine/ai/diffProcessor.ts` | `groupDiffLines`、`calculateWordDiff` |
| `src/engine/ai/patchApplier.ts` | `applyMultiplePatches`、`parseSearchReplaceBlocks`、`validateSearchExists`、`formatPatchBlock`、`createSimplePatch`、`createNewFilePatch` |
| `src/engine/ai/prompts.ts` | `EDIT_PROMPT_TEMPLATE_LEGACY` |
| `src/engine/cmd/terminalOutputManager.ts` | `createTerminalOutputManager` |
| `src/engine/cmd/terminalUI.ts` | `WriteCallback` |
| `src/engine/core/coreLogger.ts` | `coreInfo`、`coreWarn` |
| `src/engine/extensions/extensionsLogger.ts` | `extensionWarn` |
| `src/engine/extensions/transformImports.ts` | `transformImports` |
| `src/engine/in-ex/exportPdf.ts` | `exportPngFromHtml`、`exportPdfFromHtmlCanvas` |
| `src/engine/runtime/nodejs/nodeErrors.ts` | `createSyntaxError` |
| `src/engine/cmd/global/gitOperations/remoteUtils.ts` | `toShortRemoteRef`、`remoteExists`、`getDefaultRemote` |
| `src/engine/storage/chatStorageAdapter.ts` | `deleteChatSpacesForProject`、`getChatSpace` |
| `src/engine/tabs/types.ts` | `hasBufferContent`、`hasJumpToLine` |
| `src/stores/tabState/paneUtils.ts` | `normalizeTabPath` |

`src/engine/runtime/nodejs/runtimeWorkerPool.ts:disposeRuntimeWorkerPool` はsourceでは宣言以外の参照がないが、testのruntime cleanupで利用されるため残す。`src/stores/tabState.ts` の `getContent`・`isDirty`・`removeSaveTimerForPath` は `contentSync` の実装からre-exportされ、store actionsやtestsから参照される。これらはts-pruneの単純解析結果だけでは誤判定する例である。

`src/engine/i18n/index.ts` の `preloadTranslations`・`clearMemoryCache`・`translatePlural` は実装側で直接参照されずbarrelから再exportされる形であり、translatorの利用が局所的に見える。ただしi18nの公開入口を通じた利用を静的に判定できず、dead exportとは確定しないため、削除候補ではなく利用元確認対象とする。

ts-pruneは、extensionsの `activate` / `deactivate` と `_shared` 型、`src/types/index.ts` の型群、FS・shell・unix command・builtin tabのbarrel export、hooksやcomponentsの default export など、外部利用・テスト除外・動的登録で解決される宣言も未使用として出力する。これらを未使用exportとして扱わず、上表はsourceとtestsの識別子検索で宣言以外の参照を確認できなかったものに絞った。ファイル全体の未使用候補は、ゼロimport数だけでは列挙していない。worker/build entrypoint、registry登録、動的import、拡張機能の公開entrypointが同じ条件でゼロimportに見えるためである。

### import元ゼロのfile inventory

上記の609 module scanでは `src/` の16 moduleがimport元ゼロだった。以下を分類し、動的entrypointや型宣言を未使用扱いしない。

| path | 判定 |
|---|---|
| `src/components/Tab/MarkdownPreview/index.ts` | 呼出元のない内部barrel候補。 |
| `src/engine/cmd/app/vim/index.ts` | 呼出元のない内部barrel候補。VimEditor利用箇所は実装fileを直接importしている。 |
| `src/engine/cmd/shell/heredoc.ts`、`pipeline.ts`、`scriptControls.ts` | 別セッションが追加・編集中で参照関係が未確定。dead候補から除外。 |
| `src/engine/extensions/index.ts`、`src/engine/i18n/index.ts` | barrel / public entry候補。公開入口としての意図を確認できないため判定保留。 |
| `src/engine/extensions/transformImports.ts` | sourceにimport元がなく、同名exportも宣言以外のsource/test参照なし。build scriptには別実装があるためfile候補。 |
| `src/engine/runtime/nodejs/modules/urlPort.d.ts`、`src/types/{crypto-browserify,css,path-browserify,stringDecoder,vm-browserify}.d.ts`、`src/vite-env.d.ts` | ambient declaration。tsconfigのinclude対象でimport元がないのが通常。 |
| `src/main.tsx` | Vite application entrypoint。 |

`tests/` の107 moduleにはtest runnerが直接発見する `*.test.ts` entrypoint、Vitest設定から読み込むsetup、helperが含まれる。`*.test.ts` とsetupは設定経由のentrypointとして扱い、helperは個別に参照を確認する。`tests/_helpers/localNpmPackage.ts` はtest suiteからの参照がなく、helper exportにも参照がないことを確認したため、file candidateとして記録する。extensionの31 entrypointとscriptsの35 CLI/build/template fileもregistry、manifest、`package.json`、build処理が直接選択する。

## Claudeレビュー（Stassheの確認待ち）

上の案に同意する。優先度は `engine/tabs/builtins/` のUI分離が最上位（engine→UIの逆流10件の発生源）。以下は案に無い指摘。

| 現状 | 提案 | 理由 |
|---|---|---|
| `components/Left/`・`Right/`・`Bottom/`・`Top/` | 機能単位へ: `components/{explorer,git,search,run,extensions,settings,terminal,ai,menu}`、sidebar・paneの枠は `components/layout/` | 配置位置で命名しているため中身と合わない。`Left/` にGit・Search・Run・Extensions・Settingsが同居し、`Right/` は枠2ファイルだけ。CLAUDE.mdの「Right = Git, search, AI」も既に実態とずれている。panelの配置を変えるたびにfolder名が嘘になる |
| `engine/storage/` | `engine/metadata/` | 中身はIndexedDBのmetadata adapter（AI review・chat・recent）。OPFS移行後は「storage」がfile本体と紛らわしい。`runtime/storage/`（`RuntimeFsMount`）とも同名で、別概念が同じ名前 |
| `runtime/storage/` | `runtime/fs/` | 中身はruntimeからFS Workerへのmount。fsであってstorageではない |
| `engine/core/` 直下の単発file（`pathUtils`・`project`・`projectTree`・`fileBytes`・`fileContent`・`gitignore`） | `core/fs/`（path・bytes・content）、`core/workspace/`（project・projectTree）、gitignoreはgit側 | `core/` が `fs/`・`migration/` と平置きfileの混在で、「core」が何でも置き場になっている |
| `engine/helper/`・`engine/user/`・`engine/workers/`・`src/lib/` | helper: `settingsManager`→`engine/settings/`、`isLikelyTextFile`→`core/fs/`、`resize`→`hooks/`（上の案どおり）。user→`engine/github/`（auth・GitHub user）。`workers/WorkerPool.ts`→`runtime/transpiler/`（Transpile pool専用）。`lib/ReactScan.tsx`→dev専用として整理 | いずれも1〜3fileの汎用名folder。名前から責務が分からない |
| `Development/`・`System-Design/`（root） | `Development/TODO.md`→`docs/plan/`、svg・`System-Design/*`→`docs/arch/` | docs再編（docs/{arch,domain,knowledge,plan}）と同じ基準に揃える |

### 実施時の注意
- 移動は全セッション停止中に1セッションでまとめて行う。並行作業中のrenameは他セッションの差分を壊す。
- 順序: ①`tabs/builtins` UI分離（依存の向きを先に決める）→②`components/` の機能単位化→③engine内の命名整理→④tests配置をsrcに合わせる。①②は依存グラフが変わるので、移動後に逆流0件をrgで確認する。
- `components/` 機能単位化は、各panelの登録元（LeftSidebarのpanel一覧、拡張のsidebar API）と同時に変える。
