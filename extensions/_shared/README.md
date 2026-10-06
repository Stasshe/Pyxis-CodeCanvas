# extension shared types — which file to use

This directory provides the stable, extension-facing type definitions.

Workspace files use absolute POSIX paths. `getSystemModule('fsClient')` provides byte/text reads, writes, metadata, directory operations, walking, existence checks, and change events. `getSystemModule('pathUtils')` provides lexical POSIX operations; `normalizePath` accepts absolute paths and `resolvePath(cwd, ...paths)` resolves relative paths explicitly. `getSystemModule('workspace')` returns the current root path and a subscription for root changes. Command contexts carry `rootPath`, `currentDirectory`, and `fsClient`; file identity is the absolute path.

Quick guidance for extension authors:

- Use `extensions/_shared/types.ts` (or import `ExtensionTabsAPI` / `ExtensionCreateTabOptions`) when writing code inside the `extensions/` folder. These types are intentionally minimal and stable.

- Do NOT import types from `src/engine/...` in your extension code. The `src/engine` types are runtime/internal types used by the engine implementation and may change without notice.

Notes about tabs and IDs

- Resource id vs tab id:
  - When creating a tab from an extension, treat `id` in `ExtensionCreateTabOptions` as the resource id (eg. note id).
  - The system composes the final internal tab id as `extension:<extensionId>:<resourceId>`.
  - Use stable, unique resource ids (UUID recommended) for notes so the same note always maps to the same tab.

Examples

```ts
// inside an extension
import type { ExtensionTabsAPI } from '../_shared/types';

function openNote(tabs: ExtensionTabsAPI, noteId: string, title: string) {
  tabs.createTab({ id: noteId, title });
}
```

If you want a reference mapping for authors, link them to this README or copy the short comment blocks at the top of the two type files.
