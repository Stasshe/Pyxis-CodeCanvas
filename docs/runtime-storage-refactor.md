# Runtime Storage

Node.js runs in a Runtime Worker with a prewarmed idle Worker available for reuse. Normally completed Workers are returned to an idle pool capped at one; terminated or failed Workers are replaced. Its filesystem adapter delegates to the shared FS Worker; file contents are not copied into a project-wide runtime map.

## Ownership

`FsCore` in the FS Worker owns persistent OPFS access and the temporary `/tmp` tree. The FS Worker is the only writer, serializes filesystem requests, and emits file change events. `/tmp` is in-memory and cleared when the FS Worker is recreated.

The canonical virtual HOME is `/home/pyxis`; a newly created workspace is `~/<name>`. Runtime module cache belongs at `~/.cache/pyxis`. npm metadata is fetched fresh; only package tarballs are cached at `~/.npm`, keyed by the SHA-256 of the exact resolved tarball URL and written after successful extraction.

The Runtime Worker's `RuntimeFsMount` adapts Node-style filesystem calls to the runtime bridge. It does not hold project files or preload them into memory. `ModuleFileSystem` uses the same bridge for module reads, path resolution, and transforms.

## Runtime request paths

- Async filesystem calls travel over a `MessagePort` directly from Runtime Worker to FS Worker.
- Sync filesystem calls and sync module path lookups use `sync-message`: a synchronous XHR reaches the Service Worker, which forwards the request through its retained FS Worker port.
- If the Service Worker restarts and loses that port, it asks the main page for a replacement and waits for the FS Worker port acknowledgement.
- Shell execution and stdin are the only runtime requests handled by the main page. `execSync` and `spawnSync` use the shell host; stdin supports synchronous reads.

Both paths reach the same FS Worker and OPFS owner. The main thread does not perform runtime file I/O.

## Runtime storage API

`RuntimeFsMount` sends read and write, directory listing, stat, mkdir, remove, and rename operations through the bridge. Async methods return promises. Sync methods issue a bridge request and block only the Runtime Worker while the Service Worker and FS Worker complete the operation.

The FS Worker exposes absolute-path operations backed by `FsCore`. Project files, `node_modules`, Git data, and runtime cache live in OPFS. `/tmp` uses the FS Worker's volatile memory map.

## Transpilation

The FS Worker owns one lazy transpile pool with one dedicated worker. It serializes requests and terminates an idle worker after 30 seconds; a later request creates it again. Runtime JavaScript module transforms and extension-provided TypeScript transforms use this pool, keeping transform memory out of the main page and Runtime Worker. npm archives and extracted files preserve bytes; module transforms happen when runtime code loads them.

## Verification still required

Safari device behavior and the page-wide 400 MB memory budget have not been verified. See [Development/TODO.md](../Development/TODO.md) for the remaining device checks and measurements.
