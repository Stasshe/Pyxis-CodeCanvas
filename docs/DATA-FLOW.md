# Data Flow

Pyxis separates persistent file contents from application metadata. OPFS is the sole file store. IndexedDB stores records that need application-level keys and attributes.

## File operations

```mermaid
sequenceDiagram
  participant UI as UI or command
  participant Client as FS Client
  participant Worker as FS Worker
  participant Core as FS Core
  participant OPFS as OPFS
  UI->>Client: read or write absolute path
  Client->>Worker: Comlink request
  Worker->>Core: filesystem operation
  Core->>OPFS: resolve shared directory prefix; perform filesystem operation
  OPFS-->>Core: result
  Core-->>Worker: result and change event
  Worker-->>Client: response and event
  Client-->>UI: result and listeners
```

The worker opens and closes a SyncAccessHandle around each file operation. Writes flush before closing. File-change events carry absolute paths and metadata. Existing-file `update` events refresh tab content but do not rebuild the Explorer tree: its `FileItem` projection uses path, name, type, and children, so a file-content change cannot alter its structure. Create, delete, and rename events inside the active root, including `.git`, trigger a 100 ms coalesced tree walk. At most one walk runs at a time, with one pending refresh for changes received during that walk. Results from an old root or an unmounted view are discarded.

The Git panel restores its persisted branch filter before its initial status fetch. Changes to callback identity or commit-history depth do not repeat that fetch. Filesystem changes under the active root, including `.git`, invalidate Git status through a 100 ms debounce; refreshes are serialized with one latest pending refresh. Git actions rely on these filesystem events instead of issuing a second full status fetch. Discard does not reload the workspace.

OPFS, FS Worker, local Git, checkout, legacy migration, uploads, downloads, and ZIP extraction preserve file bytes. npm archives and extracted payloads are byte-based; runtime decodes `.mjs` source as UTF-8 only when intentional transpilation requires it. The GitHub push path Base64-encodes raw bytes only for transport. Text decoding is explicit at `readText`, runtime encoding options, and `.mjs` transpilation. UI consumers classify freshly read bytes before choosing a text editor, binary editor, or preview. Markdown preview normalizes configured math delimiters outside inline code spans and standalone fences; local preview assets are inlined using MIME detected from bytes, while external URLs remain unchanged. Bundled UMD dependencies see free `define` as `undefined` in both Vite's dev optimizer and production build, preventing AMD registration from colliding with Monaco's global loader. Runtime streams, pipes, and redirection preserve bytes until terminal display decodes them.

All layers share Node-compatible POSIX lexical path operations. Filesystem boundaries accept absolute paths; relative resolution receives an explicit working directory. Shell syntax such as `~`, globs, quotes, and variable expansion is interpreted by the shell parser before filesystem calls. Runtime `fs` calls do not perform shell expansion.

## Git and package installation

Git and npm installation run inside the FS Worker against FS Core. isomorphic-git uses a filesystem adapter over the same OPFS tree as editors and terminal operations. There is no file-copy synchronization layer, and `.gitignore` does not decide which files are copied to a Git filesystem.

npm resolves the dependency graph with up to six concurrent metadata requests and shares in-flight package lookups during one install. A compatible package already in the lockfile takes priority; for a new range resolution, the `latest` dist-tag is preferred when it satisfies the range, then the maximum satisfying version is selected. Registry requests and tarball downloads share a six-request gate; package installation runs with up to six packages concurrently. The compact abbreviated registry metadata is cached in `~/.npm/registry` according to HTTP freshness and ETag. A valid unchanged npm v3 `package-lock.json` replays its recorded tree without registry metadata requests and preserves its original bytes. When the root manifest changes, compatible locked packages are reused, placements are rebuilt, and the lockfile is updated. Nested placements follow Node module lookup; tarball integrity is checked before extraction writes. Foreign `os`/`cpu` optionals are omitted from the installed tree, while required incompatible packages fail. Registry cache and manifest reads use direct reads instead of an `exists`/`stat` preflight; `ENOENT` means absent (and manifest `EISDIR` is treated as absent). Cache directories are ensured once and each package extraction creates its root and child directories once. Tarballs remain URL-digest cached under `~/.npm` only after successful extraction. The installer handles registry tarballs; peer installation and workspace/file/git protocols are outside its supported scope.

Git diff tabs compare HEAD with the index as read-only content. Editable worktree diffs compare against the index when the file is staged, and against HEAD otherwise. Reopening a matching clean diff refreshes its comparison and editable cache from current Git state; an unsaved diff keeps its edits.

## Workspace and metadata

Opening a folder sets its absolute path as the workspace root. Newly created workspaces use `~/<name>` under HOME `/home/pyxis`. The file tree is built from `walk(rootPath)`, and the root is the default working directory. File identity remains the absolute path throughout the filesystem API.

Tab metadata is scoped by workspace root. Content restoration belongs to the session load that started it: after a root switch, an older restore cannot update the new session or signal its completion.

| Data | Storage key or location |
|---|---|
| File contents, `.git`, `node_modules` | OPFS absolute path |
| Runtime cache | OPFS `~/.cache/pyxis` |
| Temporary files | Memory-backed `/tmp` |
| Recent folders | IndexedDB, keyed by root path |
| Chat spaces and tab state | IndexedDB, scoped by root path |
| AI reviews | IndexedDB, scoped by root path and file path |
| Preferences, translations, extensions | Existing application storage |

## Runtime filesystem path

The Node runtime uses the filesystem bridge to access FS Worker operations. Its synchronous filesystem requests are routed through the Service Worker path; asynchronous filesystem calls use worker messaging. The Runtime Worker is separate from the FS Worker so a synchronous request cannot block the filesystem owner that must answer it. See [Node Runtime](./NODE-RUNTIME.md) for the runtime execution model.

## Legacy migration

At startup, the temporary migration moves legacy project files and Git history into OPFS and changes project-scoped metadata to root-path keys. Migration verifies copied data before removing legacy stores. The filesystem worker then seeds generated `initial_files/` content into `~/demo` only when that directory is absent. This runs before recent folders are read; new workspaces remain empty, and existing folders are untouched. Safari-specific behavior and performance checks remain tracked in [Development/TODO.md](../Development/TODO.md).
