# Core Engine

`src/engine/core/` owns browser filesystem access, workspace selection, and file-change notifications. The FS Worker is the sole owner of OPFS handles; main-thread code uses the FS Client.

## Modules

| Module | Responsibility |
|---|---|
| `fs/core.ts` | OPFS operations, `/tmp`, path normalization, per-path access serialization, and change events |
| `fs/worker.ts` | Worker endpoint; serializes operations and hosts Git operations on the same FS Core |
| `fs/client.ts` | Comlink client, single-tab Web Lock, change listeners, and MessagePort creation |
| `fs/git.ts` | POSIX-style adapter used by isomorphic-git over FS Core |
| `pathUtils.ts` | Shared Node POSIX lexical path operations plus strict absolute-path boundary helpers |
| `project.ts` | Workspace file-tree integration and root-path based folder selection |
| `migration/` | Temporary migration from legacy IndexedDB and lightning-fs data |

## Filesystem API

The filesystem API accepts normalized absolute paths. `readFile` returns raw `Uint8Array` bytes; `readText` explicitly decodes UTF-8. `writeFile` accepts text or bytes. UI consumers use `readFileContent(path)` to classify freshly read bytes as `{kind: 'text', content}` or `{kind: 'binary', bufferContent, mimeType?}`; only text is decoded. Classification checks bytes and known binary extensions; a text suffix never bypasses byte checks. `readdir`, `walk`, and `stat` return metadata only. `pathUtils` uses the shared POSIX path implementation for lexical operations; `normalizePath` requires an absolute path, while `resolvePath(cwd, ...parts)` requires the caller to supply its cwd.

Path normalization does not expand shell syntax. Tilde, glob, quotes, and variables belong to shell parsing and are handled before a command passes paths to the filesystem API. Runtime filesystem calls receive ordinary Node-style path strings.

`mkdir` supports recursive creation. `rm` accepts recursive and force options. `rename` moves files or directory trees and emits change events. `exists` distinguishes a missing entry from other filesystem errors. Errors expose filesystem-style codes such as `ENOENT`, `ENOTDIR`, `EISDIR`, and `ENOSPC`.

The FS Worker opens a SyncAccessHandle for each file operation and closes it before returning. Operations against a path are queued to avoid overlapping handles. `/tmp` uses an in-memory map. HOME is `/home/pyxis`; runtime module cache is `~/.cache/pyxis`, and npm's canonical cache directory is `~/.npm`.

## Worker and events

The client acquires the `pyxis-fs-owner` Web Lock before creating the worker. Lock contention rejects initialization, enforcing one active application tab. The client proxies the FS API and broadcasts worker change events to registered listeners. `createPort()` creates a Comlink endpoint for worker-to-worker access.

Git and npm operations execute in the FS Worker, where filesystem access is direct. Git uses `createGitFs` to adapt the core methods to isomorphic-git's promises interface. This keeps the worktree and `.git` in the same OPFS tree; file bytes remain unchanged through the adapter. npm archives are extracted from bytes and payloads are written without text decoding, except `.mjs` source intentionally strict-UTF-8-decoded for transpilation.

## Workspace model

A workspace is a selected absolute root path. The file tree walks that root, while filesystem operations retain absolute paths and may address entries outside it. Recent-folder metadata is indexed by root path. Project state stores the current root path, not an ID used to construct a second filesystem namespace.

`ProjectFile` contains only `path`, `type`, `size`, and `mtime`. File content remains in OPFS and is fetched only when needed. Chat, tab, and AI review metadata is stored separately in IndexedDB with root-path scope.

Reading workspace settings uses defaults when `.pyxis/settings.json` is absent and leaves the workspace unchanged. Explicit settings updates create or write the settings file.

## Migration boundary

`migration/` contains the temporary startup migration from the legacy file stores and project identifiers. Its caller is kept at one application entry point. The legacy databases are removed only after migration verification succeeds. This code is scheduled for removal around April 2027.

After legacy migration, the filesystem worker seeds generated `initial_files/` content into `~/demo` only if that directory is absent. This happens before recent folders are read. New workspaces created elsewhere remain empty, and existing folders are not seeded or rewritten.

## Related documents

- [Two-Layer Architecture](./TWO-LAYER-ARCHITECTURE.md)
- [Data Flow](./DATA-FLOW.md)
- [Path helpers](../src/engine/core/pathUtils.ts)
