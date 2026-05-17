# Monaco Model Management

## URI Scheme

```
inmemory://workspace/<path-from-pyxis-root>
```

Example:

```
inmemory://workspace/src/typescript/hello.ts
inmemory://workspace/src/typescript/math.ts
```

The authority is always `workspace` (fixed). The URI path is the real Pyxis file path and must end with the real file extension.

## Why Fixed Authority

Monaco's TypeScript worker resolves module imports relative to the model's URI.

With per-tab authority (old design):

```
use-math.ts → inmemory://tab-A/typescript/use-math.ts
math.ts     → inmemory://tab-B/typescript/math.ts
```

The worker resolving `./math` from tab-A's model looks for `inmemory://tab-A/typescript/math.ts` — not found. Cross-file resolution was broken.

With fixed `workspace` authority:

```
use-math.ts → inmemory://workspace/typescript/use-math.ts
math.ts     → inmemory://workspace/typescript/math.ts
```

The worker resolves `./math` and finds the model. Cross-file resolution works.

## Model Identity

One Monaco model per unique file path (not per tab).

- `filePath` → model cache key for file-based tabs
- `tabId` → model cache key for untitled tabs (no filePath)

The same file opened in multiple panes shares one model. Edits in one pane are immediately visible in all panes showing the same file.

## Tab View State

Tab-specific state (cursor position, scroll, folding, selections) is stored separately as `ICodeEditorViewState` keyed by `tabId`.

On tab switch:
1. Save view state for the outgoing `tabId`
2. `editor.setModel(sharedModel)`
3. Restore view state for the incoming `tabId`

This gives each tab its own cursor/scroll position even when sharing a model.

## Responsibilities

`utils/monacoPathUtils.ts`

- `getWorkspaceModelUri(filePath, tabId)` — builds the `inmemory://workspace/...` URI
- `getModelCacheKey(filePath, tabId)` — filePath for file tabs, tabId for untitled
- `getLanguageFileName(filePath, fileName)` — basename for language detection
- `getFilePathFromUri(resourcePath)` — strips leading slash for display

`hooks/useMonacoModels.ts`

- Owns model lookup, creation, reuse, language updates, and LRU disposal
- `sharedModelMap` keyed by modelKey (filePath or tabId)
- `tabViewStates` keyed by tabId — persists cursor/scroll across tab switches
- Exports `saveTabViewState` and `restoreTabViewState` for use by MonacoEditor
- Exports `updateCachedModelContent(modelKey, content)` for contentSync

`editors/MonacoEditor.tsx`

- Passes `tabId`, `fileName`, `filePath` to `getOrCreateModel`
- Saves view state for previous tab before switching
- Restores view state after switching to new tab
- Saves view state on unmount

`Bottom/ProblemsPanel.tsx`

- `marker.resource.path` → display file path (authority is always `workspace`, not used)
- Jump-to-problem: `findTabByFilePath(filePath)` → finds open tab by `tab.path`

`stores/tabState/contentSync.ts`

- `updateCachedModelContent` called with `filePath` (not `tabId`) to update the shared model once per file regardless of how many tabs show it

## Forbidden URI Patterns

Do not put tab identity in the URI authority, query, or hash:

```
inmemory://<tab-id>/path/file.ts         ← breaks cross-file resolution
inmemory://workspace/path/file.ts?tab=x  ← TS worker sees wrong ScriptKind
inmemory://workspace/path/file.ts#id     ← same problem
```

Do not append uniqueness after the file extension:

```
inmemory://workspace/path/file.ts-timestamp-id  ← breaks ScriptKind detection
```

## ScriptKind Rule

Monaco's TypeScript worker derives `ScriptKind` from `uri.toString()`. The URI path must end with `.ts`, `.tsx`, `.js`, or `.jsx` for correct TypeScript/JavaScript parsing.

## Model Reuse Rules

1. If cached model URI matches desired URI: sync content, update language if stale, return model
2. If URI changed (filePath changed for a tab): dispose old model async, create new model
3. If no cache entry but Monaco registry has the URI: reuse registry model, register in cache
4. Never create fallback URIs or append suffixes after the file extension

## Troubleshooting

**"Cannot find module" errors:**

1. Confirm all related files are open as Monaco models (models are created on tab open)
2. Check `model.uri.toString()` — must be `inmemory://workspace/<path>`
3. Confirm authority is `workspace`, not a tabId

**TypeScript errors in `.ts` files (wrong ScriptKind):**

1. Check `model.uri.toString()` ends with `.ts` or `.tsx`
2. Check `model.getLanguageId()` is `typescript`
3. Close and reopen the tab if an old model was created under the previous URI scheme
