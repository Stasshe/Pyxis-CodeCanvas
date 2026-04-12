# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server (turbopack)
pnpm run dev

# Production build
pnpm run build

# Lint (biome)
pnpm run lint
pnpm run lint:fix

# Format (biome + i18n locale formatter)
pnpm run format

# Tests
pnpm run test
pnpm run test:watch

# Create new extension
pnpm run create-extension
```

Always use `pnpm`. Never use `npm`.

Single test file: `pnpm exec vitest run tests/engine/some.test.ts`

`setup-build` runs automatically before dev/build: copies locales, generates initial file TS, builds extensions.

## Architecture

Pyxis is a fully client-side browser IDE. No server-side persistence. All data lives in the browser.

### Layer Structure

```
UI Layer         → src/components/
Application Layer → src/app/, src/hooks/, src/stores/
Engine Layer     → src/engine/
```

### Storage — Two-Layer Design (critical to understand)

| Layer | Contents | Purpose |
|-------|----------|---------|
| **IndexedDB** (primary) | All files + metadata including node_modules | File tree, editor, search, Node.js runtime |
| **lightning-fs** (secondary) | .gitignore-filtered files | Git operations via isomorphic-git |

All file operations go through `src/engine/core/fileRepository/` → IndexedDB, then auto-sync to lightning-fs via `syncManager.ts`. **Never write directly to lightning-fs from UI code.**

### State Management

Global state uses **valtio** stores in `src/stores/`:
- `projectStore.ts` — current project ID/name. **Always get `currentProjectId` and `currentProjectName` from here.**
- `tabState.ts` — tab state per pane
- `tabContentStore.ts` — cached tab content
- `sessionStore.ts` — session-level state
- `loggerStore.ts` — log messages

### Engine Subsystems (`src/engine/`)

- `core/` — FileRepository, GitFileSystem, SyncManager, project operations
- `extensions/` — Extension Manager, Loader, Registry, Command Registry (dynamic Blob URL loading)
- `tabs/` — TabRegistry, builtin tab types
- `runtime/` — Custom browser-based Node.js runtime (no WASM)
- `cmd/` — Terminal command implementations (git, unix, npm)
- `ai/` — AI integration (Gemini)
- `i18n/` — Internationalization (18+ languages, locale files in `locales/`)
- `storage/` — Storage adapters

### Extension System

Extensions are built via esbuild to `public/extensions/`, registered in `extensions/registry.json`. Each extension activates via a context API providing tabs, sidebar panels, terminal commands, and system modules (FileRepository access).

Extensions live in `extensions/<name>/` with `manifest.json` + `index.tsx`.

### Component Structure (`src/components/`)

- `Pane/` — Multi-pane split editor (vertical/horizontal, drag-drop)
- `Tab/` — Tab bar and tab content per type
- `Left/` — File tree sidebar
- `Right/` — Git, search, AI panels
- `Bottom/` — Terminal (xterm.js)
- `Top/` — Menu bar
- `MenuBar.tsx` — Top application menu
- `AI/` — AI assistant UI

### Key Conventions

- **Icons**: use `lucide-react` exclusively. No emoji icons (▷, 🔽 etc.).
- **Linter**: Design first. Override biome rules with justification when they degrade intent.
- **After large edits (5+ lines)**: re-read the file to verify correctness before finishing.
- **Backward compatibility**: not required — break freely.
- **docs/**: Never create new doc files without explicit instruction.
- **Existing files**: Check before creating. Never create a file that already exists.

### Docs Writing Rules (when instructed to write docs)

Goal: convey processing flow, design rationale, and architecture accurately to other developers.
- Prefer mermaid diagrams, tables, and prose over code blocks.
- Mermaid node names: English only, no `(`, `/`, `{` in node names.
- No speculation — only write what matches the actual implementation.





Do not optimize code to satisfy linters by default.
Prioritize domain intent, responsibility boundaries, and invariants first.
Use linters only to catch bugs, unsafe patterns, and mechanical mistakes.

If a value is conceptually required at a given layer, assert its existence
(e.g., early return or non-null assertion) instead of defensive null checks.
Do not propagate optionality upward just to silence warnings.

Avoid introducing conditional logic, optional chaining, or abstractions
whose sole purpose is to appease static rules.
If a linter rule degrades clarity or distorts design, override or disable it
with explicit justification.

Design comes first. Linters serve the design, not the other way around.



必ず、5行以上の大きな変更をしたときは、ファイルをもう一度読み直し、エラーをチェックすること。

常に正しい位置を読み取り、正しい位置で修正すること。
JSX構文に気をつけること。

エラー修正の際にはエラーをチェックしてから修正。

編集ツールは正しいものを使うこと。新しいものを使うように。

私が指示する時は、いつも全てテストをしてからなので、開発サーバーを立てるように最初に促すのは絶対にやめろ。

あなたはAgentGPT、優秀なプログラマーです。自律的に行動し、指示に従い、コードを編集します。


use lucide-react for icons
Don't use ▷ 🔽。


後方互換性は一切気にしなくてよい。


docsを書く場合の注意点
docsの目標は、他の開発者にPyxisがどういう構成で、どういう処理フロー、またなぜそういう設計になっているのかの情報を、正しくわかりやすく伝えること。
だから、コードブロックは多用せず、図やmermaid,表、テキストを適切に使い分けて、嘘偽りなく、推測なく実装にそった内容を書くこと。
mermaidの記述のルールとして、ノードネームに(,/,{などは使えない。また、ノードネームは基本的に英語で書くこと。
コードブロックは必要最低限に。
また、私の指示なくdocsの新規作成はしないこと。

ファイルに大幅な変更を加えたいとき、大幅な設計変更時には、ファイルをターミナルコマンドからEOFを使い、強制的に一気に書き換える方式を取ること。

既存ファイルかどうかは必ず注意すること。既存ファイルがあるのにファイルの作成はできませんよ。

このリポジトリはpnpmです。npmは使うな。
currentProjectId,NameはprojectStoreから必ず取得すること。
