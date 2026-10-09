# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server (Vite)
pnpm run dev
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

Single test file: `pnpm exec vitest run tests/engine/some.test.ts`

`setup-build` runs automatically before dev/build: copies locales, generates initial file TS, builds extensions.

## Architecture

Pyxis is a fully client-side browser IDE. No server-side persistence. All data lives in the browser.

### Storage — OPFS Files and IndexedDB Metadata

| Layer | Contents | Purpose |
|-------|----------|---------|
| **OPFS** | Workspace files, `.git`, `node_modules`, runtime cache `~/.cache/pyxis`, npm cache `~/.npm` | Sole persistent filesystem |
| **IndexedDB** | Recent folders, chats, tabs, AI reviews, settings, translations, extension data, path-keyed filesystem permission bits | Searchable application metadata |
| **Memory** | `/tmp` | Ephemeral files |

The FS Worker in `src/engine/core/fs/` is the only OPFS owner. Main-thread code uses its FS Client. Git and npm installation run in the FS Worker against the same filesystem. `ProjectFile` contains absolute path, entry type, full `stat` mode, size, and mtime. File identity is its normalized absolute path. OPFS stores payloads; permission bits are keyed by canonical absolute path in IndexedDB, while `/tmp` modes stay in memory. Virtual symlinks use authoritative per-link records under the reserved OPFS root `.pyxis-fs-links`; `/tmp` links are memory-backed. A workspace root controls the file tree and default working directory; it does not create a separate path namespace. The Web Lock allows one active tab to own the filesystem.

Temporary legacy migration lives in `src/engine/core/migration/`; keep its invocation centralized. Remove it after the migration window ending around April 2027. Virtual `HOME` is `/home/pyxis`; new workspaces at `~/<name>` start empty. Startup seeds the generated `initial_files/` content into `~/demo` only when that directory is absent; existing folders, including an existing `~/demo`, are left intact. Runtime cache is `~/.cache/pyxis`, npm cache is `~/.npm`, and `/tmp` is memory-backed. Legacy projects target `/home/pyxis/<name>` without a reserved suffix. A destination collision stops migration before project writes and preserves legacy data; persisted project-to-root mappings let retries reuse their assigned destination. Filesystem-worker seeding runs after legacy migration and before recent folders are read.

### State Management

Global state uses **valtio** stores in `src/stores/`:
- `projectStore.ts` — current workspace and absolute root path. **Always get the current root path from this store.**
- `tabState.ts` — tab state per pane
- `tabContentStore.ts` — cached tab content
- `sessionStore.ts` — session-level state
- `loggerStore.ts` — log messages

### Engine Subsystems (`src/engine/`)

- `core/fs/` — OPFS core, FS Worker, FS Client, path API, and Git adapter
- `core/migration/` — temporary import from legacy storage
- `extensions/` — Extension Manager, Loader, Registry, Command Registry (dynamic Blob URL loading)
- `tabs/` — TabRegistry, builtin tab types
- `runtime/` — Custom browser-based Node.js runtime (no WASM)
- `cmd/` — Terminal command implementations (git, unix, npm)
- `ai/` — AI integration (Gemini)
- `i18n/` — Internationalization (20 languages, locale files in `locales/`)
- `storage/` — Storage adapters

### Extension System

Extensions are built via esbuild to `public/extensions/`, registered in `extensions/registry.json`. Each extension activates via a context API providing tabs, sidebar panels, terminal commands, and typed system modules. See `extensions/_shared/` for the extension-facing API types.

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
- **docs/**: Never create new doc files without explicit instruction. Layout: `docs/arch/` whole-system architecture only, `docs/domain/` per-feature spec and implementation, `docs/knowledge/incidents/` past bugs with root cause and prevention, `docs/plan/` plans and `*_INTENT.md`. Docs are Japanese; only `README_en.md` is English. Index: `docs/README.md`.
- **Existing files**: Check before creating. Never create a file that already exists.

### Docs Writing Rules (when instructed to write docs)

Goal: convey processing flow, design rationale, and architecture accurately to other developers.
- Prefer mermaid diagrams, tables, and prose over code blocks.
- Mermaid node names: English only, no `(`, `/`, `{` in node names.
- No speculation — only write what matches the actual implementation.

後方互換性は一切気にしなくてよい。

docsを書く場合の注意点
docsの目標は、他の開発者にPyxisがどういう構成で、どういう処理フロー、またなぜそういう設計になっているのかの情報を、正しくわかりやすく伝えること。
だから、コードブロックは多用せず、図やmermaid,表、テキストを適切に使い分けて、嘘偽りなく、推測なく実装にそった内容を書くこと。
mermaidの記述のルールとして、ノードネームに(,/,{などは使えない。また、ノードネームは基本的に英語で書くこと。
コードブロックは必要最低限に。
