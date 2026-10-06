# Pyxis Technical Documentation

## Architecture and storage

- [System Overview](./SYSTEM-OVERVIEW.md): application layers and major components
- [Two-Layer Architecture](./TWO-LAYER-ARCHITECTURE.md): OPFS file authority and IndexedDB metadata
- [Core Engine](./CORE-ENGINE.md): FS Worker, FS Client, path API, and Git adapter
- [Data Flow](./DATA-FLOW.md): file, Git, runtime, and metadata paths
- [UI Components](./UI-COMPONENTS.md): component hierarchy and shared operation window
- [Node Runtime](./NODE-RUNTIME.md): browser Node-compatible runtime
- [Runtime Provider](./RUNTIME-PROVIDER.md): runtime integration details
- [Shell System](./SHELL-SYSTEM.md): terminal parsing and process execution

## Features

- [Extension System](./EXTENSION-SYSTEM.md): extension loading and APIs
- [How to Create an Extension](./HOW-TO-CREATE-EXTENSION.md): extension authoring guide
- [AI System](./AI-SYSTEM.md): chat and code review
- [I18N System](./I18N-SYSTEM.md): locale storage and translation loading
- [UI Components](./UI-COMPONENTS.md): component hierarchy and state
- [GitHub Integration](./GITHUB-INTEGRATION.md): GitHub authentication and operations

## Storage rules

- OPFS is the only persistent store for file contents, `.git`, and `node_modules`.
- The FS Worker owns OPFS access; main-thread code goes through the FS Client.
- IndexedDB stores metadata and application records, including recent folders, tabs, chats, AI reviews, and extension data.
- Paths are normalized absolute paths. A workspace root scopes the file tree and root-scoped metadata; it does not create a separate path namespace.
- Virtual HOME is `/home/pyxis`; workspaces are `~/<name>`. `/tmp` is ephemeral memory storage, runtime cache is `~/.cache/pyxis`, and npm's cache directory is `~/.npm`.
- Legacy-storage migration is temporary and documented in [Two-Layer Architecture](./TWO-LAYER-ARCHITECTURE.md).
