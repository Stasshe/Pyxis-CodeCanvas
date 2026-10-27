# Pyxis 技術文書

| folder | 内容 |
|---|---|
| `arch/` | システム全体の構成、実行context、保存境界、層をまたぐ処理の流れ、主要な設計判断 |
| `domain/` | 機能ごとの仕様（対応範囲）と実装の詳細 |
| `knowledge/incidents/` | 過去の不具合の症状・根本原因・再発防止 |
| `plan/` | 計画と`*_INTENT.md`（判断の背景） |

文書は日本語。英語は`README_en.md`だけ。

## arch

- [システム全体像](arch/system-overview.md): 設計原則、Worker構成、層、起動順序
- [保存境界とpathモデル](arch/storage.md): OPFS・IndexedDB・memory、HOMEと絶対path、所有と並行性、bytes保持
- [層をまたぐ処理の流れ](arch/data-flow.md): 変更event、workspace切替、Node実行、Git・npm

## domain

| 領域 | 文書 |
|---|---|
| FS | [filesystem](domain/filesystem.md)（OPFS、symlink、内容検索、workspace、旧storage移行） |
| Terminal | [shell](domain/shell.md)、[terminal](domain/terminal.md)、[vim](domain/vim.md) |
| 実行 | [node-runtime](domain/node-runtime.md)、[runtime-provider](domain/runtime-provider.md) |
| package・VCS | [npm](domain/npm.md)、[git](domain/git.md) |
| Editor | [editor](domain/editor.md)、[operation-window](domain/operation-window.md)、[markdown-preview](domain/markdown-preview.md)、[monaco-model-management](domain/monaco-model-management.md) |
| 拡張・AI・i18n | [extensions](domain/extensions.md)、[extension-authoring](domain/extension-authoring.md)、[ai](domain/ai.md)、[i18n](domain/i18n.md) |

## knowledge/incidents

| 日付 | 件名 |
|---|---|
| 2026-05-30 | [非同期保存中の編集巻き戻り](knowledge/incidents/2026-05-30-async-save-edit-race.md) |
| 2026-09-11 | [Gitファイルシステムのflush漏れ](knowledge/incidents/2026-09-11-git-filesystem-flush.md) |
| 2026-10-07 | [FS WorkerにBufferがなくGit操作が失敗](knowledge/incidents/2026-10-07-fs-worker-buffer-missing.md) |
| 2026-10-07 | [Binary fileが複数経路で文字列化された](knowledge/incidents/2026-10-07-binary-stringified.md) |
| 2026-10-08 | [OPFSの親directoryを毎回rootから辿っていた](knowledge/incidents/2026-10-08-opfs-parent-traversal.md) |
| 2026-10-08 | [Folder切替後にタブ内容の復元が終わらない](knowledge/incidents/2026-10-08-restore-flag-folder-switch.md) |
| 2026-10-08 | [Markdown previewのAMD衝突](knowledge/incidents/2026-10-08-markdown-preview-amd-collision.md) |
| 2026-10-09 | [npm install後のroot全体walkがpromptを遅らせた](knowledge/incidents/2026-10-09-npm-install-root-walk.md) |

## plan

- [STORAGE_INTENT](plan/STORAGE_INTENT.md): storage・runtime再設計の判断理由
- [OPFS移行計画](plan/opfs-migration.md)
- [Runtime storage refactor](plan/runtime-storage-refactor.md): 実装済み構成と未計測の検証項目
- [ディレクトリ構造案](plan/directory-structure.md)
- [開発資料の履歴](plan/development-history.md): 廃止した旧設計案の要点

検証記録と未完了の確認項目は [Development/TODO.md](../Development/TODO.md)。
