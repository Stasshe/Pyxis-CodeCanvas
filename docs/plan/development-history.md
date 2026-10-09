# 開発資料の履歴

Development/ に残っていた構想と実装メモのうち、後の判断に役立つ背景だけを記録する。以下はすべて履歴であり、現在の仕様・実装手順ではない。現行の構成は [CLAUDE.md](../../CLAUDE.md) と各ドメイン文書を参照する。

## ファイル保存構成の旧案

`NEW-ARCHITECTURE.md` は IndexedDB を正本とし、FileRepository から lightning-fs へ同期する案だった。現行構成では OPFS が永続ファイルシステムであり、IndexedDB はメタデータを担う。古い案にある `projectDB`、`gitFileSystem`、`SyncManager` の責務説明や例を現行コードへ適用しない。

## Project ID の状態共有

2025-12-03 の `PROJECT-ID-BEST-PRACTICES.md` は、各コンポーネントが個別の `useProject()` 状態を持ち、非同期コールバックから古い・空の project ID を参照し得る問題を背景にしていた。store 経由の状態共有へ移った経緯を示す記録である。ファイルには古い Zustand API 名や `/projects/<id>` 前提も含むため、コード例は引き継がない。

## Shell の構文拡張案

2025-11-05 の `SHELL-PARSER-PLAN.md` は shell-quote と StreamShell を使い、pipeline、redirection、subshell、command substitution、glob、job control を段階導入する計画だった。途中経過には単純な空白分割など POSIX と異なる実装制約が記載され、全構文を実装済みとは示していない。2026-10-08 の [TODO](../../Development/TODO.md) にも残る shell suite の未対応項目を、網羅的互換性の主張に読み替えない。

## タブ・エディター管理案

`TAB-MANAGEMENT-ARCHITECTURE.md` は TabContext、Zustand TabStore、Registry によるタブ管理案を説明しているが、props 名、タブ型、永続化方法には旧仕様が混在する。`EditorMemoryManager` の評価・利用ガイド、コンテンツ復元ガイド、英語の code-flow 検証文書も実装時点の説明であり、現在の API 契約としては使わない。設計背景として残る要点は、非同期保存中に編集内容が進む場合、保存完了処理が新しい編集を巻き戻さないようにする必要があること（詳細は[保存競合 incident](../knowledge/incidents/2026-05-30-async-save-edit-race.md)）。

## Runtime / Module cache 案

`NodeJSRuntime-new-arc.md` と `MODULE-CACHE-STRATEGY.md` は SWC WASM Worker、vm-browserify、LRU/GC、依存グラフを含む設計案だった。これらは現行 runtime の実装根拠ではない。キャッシュ配置・Node API 対応状況などを案から推定せず、[Node runtime 文書](../domain/node-runtime.md)を参照する。

## 拡張機能関連の旧ガイド

複数ファイル拡張、npm ライブラリ、tab/sidebar API、command extension、code splitting の各文書は、古いビルド方法や型例を含む。React 周辺の外部化、manifest の files 配列、Blob URL import、npm/pnpm/yarn の任意選択などを現行仕様として再利用しない。拡張機能の現在仕様は対応するドメイン文書を参照する。

## その他の提案・記録

- AI agent 実装計画は初期の機能分割案であり、型・ファイル構成・保存方法は現在の実装を表さない。
- FileRepository の最適化メモは旧 IndexedDB インデックス案であり、現在の OPFS ファイルアクセス API と混同しない。
- Storage/keybindings 文書は `pyxis-global` IndexedDB と旧ショートカット API の説明を含み、現行の設定保存仕様として扱わない。
- Tauri setup は別ブランチ・npm を前提とした案で、現行の開発手順ではない。
- Git 削除検知分析は修正案を列挙した文書で、原因や解決が実証済みだとは確認できないため、根拠のない結論を引き継がない。
