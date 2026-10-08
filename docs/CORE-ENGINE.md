# Core Engine

`src/engine/core/` owns browser filesystem access, workspace selection, and file-change notifications. The FS Worker is the sole owner of OPFS handles; main-thread code uses the FS Client.

## Modules

| Module | Responsibility |
|---|---|
| `fs/core.ts` | OPFS operations, `/tmp`, path normalization, per-path access serialization, and change events |
| `fs/worker.ts` | Worker entry; imports the Buffer bootstrap before the endpoint |
| `fs/endpoint.ts` | Serializes filesystem operations and hosts Git operations on the same FS Core |
| `fs/client.ts` | Comlink client, single-tab Web Lock, change listeners, and MessagePort creation |
| `fs/git.ts` | POSIX-style adapter used by isomorphic-git over FS Core |
| `pathUtils.ts` | Shared Node POSIX lexical path operations plus strict absolute-path boundary helpers |
| `project.ts` | Workspace file-tree integration and root-path based folder selection |
| `migration/` | Temporary migration from legacy IndexedDB and lightning-fs data |

## Filesystem API

The filesystem API accepts normalized absolute paths. `readFile` returns raw `Uint8Array` bytes; `readText` explicitly decodes UTF-8. `writeFile` accepts text or bytes. UI consumers use `readFileContent(path)` to classify freshly read bytes as `{kind: 'text', content}` or `{kind: 'binary', bufferContent, mimeType?}`; only text is decoded. Classification checks bytes and known binary extensions; a text suffix never bypasses byte checks. `readdir`, `walk`, and `stat` return metadata only. `pathUtils` uses the shared POSIX path implementation for lexical operations; `normalizePath` requires an absolute path, while `resolvePath(cwd, ...parts)` requires the caller to supply its cwd.

Path normalization does not expand shell syntax. Tilde, glob, quotes, and variables belong to shell parsing and are handled before a command passes paths to the filesystem API. Runtime filesystem calls receive ordinary Node-style path strings.

`mkdir` supports recursive creation. `rm` accepts recursive and force options. `rename` moves files or directory trees and emits change events. `exists` distinguishes a missing entry from other filesystem errors. Errors expose filesystem-style codes such as `ENOENT`, `ENOTDIR`, `EISDIR`, and `ENOSPC`.

FS Core retains only the directory-handle chain for its last successful path lookup and reuses shared ancestors on the next lookup. Initialization resets the chain; directory removal invalidates it before and after removal, including source removal during a directory rename. An in-flight lookup from an earlier generation cannot republish stale handles. Each operation carries its parent and file handles through path discovery, access, and metadata collection; these handles do not persist between operations. File contents are never cached. A SyncAccessHandle is opened and closed around the operation, and operations against a path are queued to avoid overlapping handles. `/tmp` uses an in-memory map. HOME is `/home/pyxis`; runtime module cache is `~/.cache/pyxis`, and npm's canonical cache directory is `~/.npm`.

## Worker and events

The client acquires the `pyxis-fs-owner` Web Lock before creating the worker. Lock contention rejects initialization, enforcing one active application tab. The client proxies the FS API and broadcasts worker change events to registered listeners. `createPort()` creates a Comlink endpoint for worker-to-worker access.

Git and npm operations execute in the FS Worker, where filesystem access is direct. Its entry statically imports the Buffer bootstrap before the endpoint, so `globalThis.Buffer` exists when isomorphic-git's Git index modules initialize. The main-thread polyfill does not cross the Worker boundary. Git uses `createGitFs` to adapt the core methods to isomorphic-git's promises interface. This keeps the worktree and `.git` in the same OPFS tree; file bytes remain unchanged through the adapter. npm shares one network limit of six across registry and tarball requests, resolves dependency metadata with up to six concurrent requests, and installs up to six packages concurrently. It shares in-flight lookups within an install. A compatible package already in the lockfile takes priority; otherwise a range selects the `latest` dist-tag when it satisfies the range, then the maximum satisfying version. The abbreviated registry packument is cached under `~/.npm/registry` according to HTTP freshness and revalidated with ETag; tarballs are keyed by URL digest in `~/.npm`. Gzip data is passed through a streaming decompressor and tar entries are written one at a time per package, preserving raw payload bytes. For npm v3 package-lock files, an unchanged root dependency map replays the recorded package tree without registry metadata requests and retains the original lockfile bytes. A changed manifest reuses compatible locked packages, rebuilds placements, and writes an updated lockfile. Nested placements follow Node module lookup; the tarball integrity recorded in the lockfile is verified before extraction writes. Manifest and registry metadata cache reads use direct reads without an `exists` or `stat` preflight; `ENOENT` is a cache miss, `EISDIR` is treated as absent for manifests, and other filesystem errors remain visible. Cache directories are ensured once per installer, and extraction creates each package directory once. Metadata cache parse/shape corruption is warned about and removed. Runtime decodes `.mjs` source as UTF-8 only when applying a module transform.

## Workspace model

A workspace is a selected absolute root path. The file tree walks that root, while filesystem operations retain absolute paths and may address entries outside it. Recent-folder metadata is indexed by root path. Project state stores the current root path, not an ID used to construct a second filesystem namespace.

The Explorer tree is a structural projection of filesystem metadata. Existing-file updates do not change its path/name/type/children entries, so they refresh open-file consumers without walking the workspace. Create, delete, and rename events under the active root, including `.git`, coalesce for 100 ms and schedule a tree walk. Walks are serialized with one pending refresh; a root change or unmount prevents stale results from reaching the view.

`ProjectFile` contains only `path`, `type`, `size`, and `mtime`. File content remains in OPFS and is fetched only when needed. Chat, tab, and AI review metadata is stored separately in IndexedDB with root-path scope.

Reading workspace settings uses defaults when `.pyxis/settings.json` is absent and leaves the workspace unchanged. Explicit settings updates create or write the settings file.

## Migration boundary

`migration/` contains the temporary startup migration from the legacy file stores and project identifiers. Its caller is kept at one application entry point. The legacy databases are removed only after migration verification succeeds. This code is scheduled for removal around April 2027.

After legacy migration, the filesystem worker seeds generated `initial_files/` content into `~/demo` only if that directory is absent. This happens before recent folders are read. New workspaces created elsewhere remain empty, and existing folders are not seeded or rewritten.

## Related documents

- [Two-Layer Architecture](./TWO-LAYER-ARCHITECTURE.md)
- [Data Flow](./DATA-FLOW.md)
- [Path helpers](../src/engine/core/pathUtils.ts)
