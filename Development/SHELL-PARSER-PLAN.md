## Shell parser & Stream Shell — Implementation plan

作成日: 2025-11-05

目的: `shell-quote` を採用した本格的なシェルパーサーを実装し、既存の StreamShell（ストリームベースProcess実行基盤）と統合して、パイプ、リダイレクト、サブシェル、コマンド置換、変数展開、glob、バックグラウンド実行、シグナル伝搬（Ctrl+C）など、実際のUnixシェルに極めて近い動作をブラウザ内/テスト環境で再現できるようにする。

要件（ハイレベル）
- できるだけPOSIXシェル相当の機能を実装（chmod 等のOS権限操作は除外）
- 入出力は全てストリーム（Node スタイル）で扱う（backpressure を意識）
- パイプ (`|`)・リダイレクト (`>`, `>>`, `<`) は Shell が一元管理
- サブシェル `(...)`、コマンド置換 `` `cmd` `` と `$(cmd)`、変数展開 `$VAR` をサポート
- ワイルドカード / glob 展開（例: `*.js`）をサポート
- バックグラウンド実行（`&`）をサポート、プロセス管理を行う
- シグナル（SIGINT/Ctrl+C）をプロセスへ配信し、ハンドラが受けて適切に終了できる
- File IO は SSOT（`fileRepository`）経由で実施。lightning-fs を直接操作しない（既存方針遵守）
- 拡張コマンドは既存の `terminalCommandRegistry` / `commandRegistry` と連携
- Jest で確実にテスト可能（IndexedDB をモック/注入してテスト安定化）

選定ライブラリ
- parser: shell-quote (https://www.npmjs.com/package/shell-quote)
  - 理由: shell の quoting/expansion ルールを扱う実績あるパッケージ。トークン化と簡易 AST を提供する。
  - 代替: bash-parser / sh-parser は大きすぎるか複雑。まずは shell-quote でトークンと expansions を扱い、必要なら次フェーズでより強力なパーサへ置換。
- glob: fast-glob（必要時）

高レベル設計（コンポーネント）
- Parser 層（shell-quote ラッパ）
  - 入力: コマンドライン文字列
  - 出力: 命令列（Command AST）
    - Command: { argv: string[], redirections: [{type:'stdin'|'stdout', path, append?}], background?, subshell?: AST }
  - 拡張処理: 変数展開・コマンド置換は parser ラッパで解決（コマンド置換は StreamShell の run を呼ぶ必要あり）

- Executor 層（既存 StreamShell を拡張）
  - 入力: Parser が生成した AST
  - 挙動:
    - 各コマンドを Process (PassThrough streams) として spawn
    - pipeline は stream.pipe で結線
    - redirection (`>`, `>>`, `<`) は Process と fileRepository を接続
    - subshell / command substitution: 内部で再帰的に parser → executor を呼ぶ（ストリームでつなぐ）
    - background job: Process をバックグラウンドで走らせ、ジョブテーブルに登録
    - signals: Terminal が Ctrl+C を受けたら現在のフォアグラウンドプロセスに kill('SIGINT') を送る

- Builtins / Command Registry
  - builtins はストリーム入出力 API を持つこと（stdin: Readable, stdout/stderr: Writable）
  - 既存 `UnixCommands` は多くが Promise ベースで同期的に結果を返す。Stream 互換を保つためのアダプタ層を作り、ストリーム入出力を UnixCommands 呼び出しにブリッジする。

データ契約（2-4行）
- Process: stdin: Writable, stdout/stderr: Readable、events: 'exit' (code, signal), 'signal'
- Executor.run(ast | string) => Promise<{ stdout: string, stderr: string, code: number | null }>
- Redirection: executor がファイル書き込みを行う場合は `fileRepository` の `createFile` / `saveFile` を使用

重要なエッジケース（優先度付き）
1. 大きな出力の streaming/backpressure（パイプの途中で停止するコマンド）
2. コマンド置換が非同期で複雑な I/O を含む場合の同期タイミング
3. Ctrl+C が複数ジョブに送られたときの振る舞い（フォアグラウンドのみ、または全て）
4. glob が `.gitignore` による無視規則とどう衝突するか（FileRepository の .gitignore の考慮が必要）
5. Terminal 側の既存リダイレクト実装と移行中の二重処理をどう排除するか

移行戦略（段階的）
1. Parser 実装（shell-quote wrapper）を追加。既存 StreamShell は残しつつ `tokenize` を置換できるようにする。
2. Shell.run が parser を受け付けるパスを作る。まずは単純コマンド/パイプ/リダイレクトに対して動作を確認するユニットテストを作成。
3. コマンド置換/サブシェル/変数展開を順次実装し、各機能に対するユニットテストを追加。
4. Terminal.tsx の `processCommand` を段階的に Shell.run に委譲。`>`/`>>` を Shell が扱うように移行（フラグで切替可能にする）。
5. デフォルトの Shell を切り替え、古い実装を削除。

テスト計画
- 単体テスト（Jest）
  - Parser: 各種クォート、エスケープ、command-substitution, variable expansion, redirections, background
  - Executor: パイプ連結で順序が守られること、stdin→stdoutの伝搬、redirのファイル書き込み
  - Signal: 長時間コマンドに対して SIGINT を送ったときに正しく中断されること
  - Subshell & Command substitution: `echo $(echo hi)` 等の出力が正しく評価されること
  - Globbing: `ls *.js` の結果と期待値一致（Mock UnixCommands を使用）

- 統合テスト
  - Terminal UI と結合して、キー入力（Enter/Ctrl+C）で正しく動くこと（E2Eは手動確認/小さな自動化）

テスト実行時の注意
- Node/Jest 環境では IndexedDB が無いため、`fileRepository` や `terminalCommandRegistry` の初期化を避ける。テストでは `unix` と `fileRepository` を注入（モック）する。

実装ステップ（タスク分解）
1. package.json に `shell-quote` と（必要なら）`fast-glob` を追加
2. 新ファイル: `src/engine/cmd/shell/parser.ts`（shell-quote ラッパ）
3. `src/engine/cmd/shell/streamShell.ts` を parser 結果を受けるように改修
4. Builtin アダプタ層作成: `src/engine/cmd/shell/builtins.ts`（UnixCommands とのストリームブリッジ）
5. Job/Process table を StreamShell に追加（バックグラウンドプロセス管理）
6. Terminal 統合: `src/components/Bottom/Terminal.tsx` の processCommand を段階的に Shell.run に委譲
7. テスト実装: `tests/parser.test.ts`, `tests/streamExecutor.test.ts`, `tests/terminal.integration.test.ts`（必要なモックを用意）

リスクと緩和策
- リスク: lightning-fs / IndexedDB の副作用でテストが壊れる
  - 緩和: executor と parser のロジックを依存注入可能にし、Jest では mock を使用（今回の StreamShell は既に依存注入対応済み）
- リスク: `shell-quote` が全ての shell 構文を網羅していない可能性
  - 緩和: コマンド置換・変数展開の処理を Shell 側で補完、必要に応じてより高度なパーサへ移行

パフォーマンスと品質ゲート
- 各コミットでユニットテストを追加し、CI（jest）でパスすることを必須化
- 大きな変更をマージする前に、Terminal UIで手動検証（パイプ、リダイレクト、Ctrl+C）を行う

マイルストーン（概算）
1. 設計完了（このドキュメント） — 0.5日
2. Parser 実装 + 単体テスト — 1日
3. Executor 統合（基本: pipes, >, >>, <） + tests — 2日
4. Subshell / Command substitution / Variable expansion — 1.5日
5. Globbing, background jobs, job table — 1日
6. Terminal 統合と E2E 確認 — 1日

合計（概算）：7-8日（並行作業で短縮可能）

ファイル一覧（想定して作る/改修する箇所）
- src/engine/cmd/shell/parser.ts  — shell-quote wrapper
- src/engine/cmd/shell/streamShell.ts — 既存実装の拡張（redirection, subshell, replacement）
- src/engine/cmd/shell/builtins.ts — UnixCommands とのストリームブリッジ
- src/engine/cmd/shell/processTable.ts — ジョブ管理（optional）
- src/components/Bottom/Terminal.tsx — Shell の統合箇所（段階的に移行）
- tests/parser.test.ts, tests/streamExecutor.test.ts, tests/terminal.integration.test.ts

最後に
この計画をベースに、まず parser を実装（`parser.ts`）してから StreamShell に結合する流れで進めます。実装段階で小さなプロトタイプを作りながら段階的に置き換えていくのが安全です。次は `parser.ts` を実装しますか？それとも先に `package.json` に `shell-quote` を追加して依存をインストールしましょうか。

---

### Progress update (2025-11-05)

- Parser implemented (partial):
  - Command-substitution detection (`$(...)` and `` `...` ``) is implemented as a placeholder extraction. The parser emits markers which the executor resolves.
  - Variable expansion (`${VAR}` and `$VAR`) implemented with basic quoting awareness (single-quote suppression, double-quote allowed).

- Executor/StreamShell changes:
  - `src/engine/cmd/shell/builtins.ts` added: an adapter that turns Promise-based UnixCommands into stream-aware builtins (echo, cat, head, tail, grep, ls, pwd, cd).
  - `src/engine/cmd/shell/streamShell.ts` updated to use the builtins adapter and to resolve command-substitution markers by invoking `StreamShell.run` recursively and replacing tokens with the subcommand stdout (simple whitespace splitting).
  - Race conditions between fast builtins and stdout listener attachment were mitigated by yielding to next tick before handlers run.

- Tests added:
  - `tests/parser.unit.test.ts` verifies parser markers and variable expansion.
  - `tests/parser.commandsub.test.ts` verifies basic and nested command-substitution and variable expansion integration with StreamShell.

### Current limitations / Next steps

- Quoted command-substitution semantics: when a command-substitution appears inside quotes (e.g. `"$(echo a b)"`), POSIX shells preserve whitespace as a single argument. Current implementation replaces markers and performs a simple whitespace split, losing information about whether the substitution was quoted. This means quoted substitutions are not fully POSIX-compliant yet.
- Word-splitting and IFS: only simple whitespace splitting is implemented. Implementing full IFS behavior and proper word-splitting requires tracking quote-context from parser through to executor.
- Terminal integration (Ctrl+C signal propagation) remains to be implemented: StreamShell exposes Process.kill; next is wiring Terminal to call kill on the foreground Process (or adding a `killForeground` API).
- Background job table, glob expansion, and full subshell AST handling are planned next.

See the repository tests (`pnpm test`) for current automated coverage. The next development focus is improving quoted substitution behavior and adding Terminal integration for Ctrl+C.
