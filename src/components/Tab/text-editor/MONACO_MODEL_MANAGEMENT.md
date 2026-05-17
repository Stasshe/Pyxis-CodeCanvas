# Monaco Model Management

This document defines how Pyxis manages Monaco editor models and URIs.

## Core Rule

Monaco model URIs must use this shape:

```text
inmemory://<encoded-tab-id>/<path-from-pyxis-root>
```

Example:

```text
inmemory://%2Fsrc%2Ftypescript%2Fhello.ts-1779005182520-j57xr/src/typescript/hello.ts
```

The URI path must be the real Pyxis file path and must end with the real file extension.

## Why This Matters

Monaco's TypeScript worker derives `ScriptKind` from `uri.toString()`, not just from the model language id.

If a URI ends like this:

```text
inmemory://model/src/typescript/hello.ts?tabId=hello.ts-1779005182520-j57xr
```

the worker sees the suffix as something other than `ts`, and with `allowJs: true` it falls back to JavaScript. That causes errors such as:

```text
Type annotations can only be used in TypeScript files.(8010)
```

Therefore, do not put identity data after the file extension.

## Identity Model

Use two identities deliberately:

- `tabId`: identifies an editor tab instance. It is stored in the URI authority.
- `filePath`: identifies the project file from the Pyxis root. It is stored in the URI path.

This allows the same file to be opened in multiple panes with separate Monaco models while keeping diagnostics tied to the real file path.

## Responsibilities

`utils/monacoPathUtils.ts`

- Owns Monaco URI construction and parsing.
- Encodes `tabId` into the URI authority.
- Encodes the Pyxis file path into the URI path.
- Provides helpers for ProblemsPanel to recover the display path and tab id.

`hooks/useMonacoModels.ts`

- Owns model lookup, creation, reuse, language updates, and LRU disposal.
- Uses `tabId` as the local cache key.
- Uses the Monaco URI as the Monaco registry key.
- Must never create TypeScript/JavaScript model URIs that fail to end with `.ts`, `.tsx`, `.js`, or `.jsx`.

`editors/MonacoEditor.tsx`

- Passes both `tabId` and `filePath` to `useMonacoModels`.
- Uses the normalized model filename for the editor `language` prop.

`Bottom/ProblemsPanel.tsx`

- Reads diagnostics from Monaco markers.
- Uses `marker.resource.path` for display file paths.
- Uses `marker.resource.authority` to recover the original `tabId` for jump-to-problem.

## Forbidden URI Patterns

Do not use query or hash for tab identity:

```text
inmemory://model/src/hello.ts?tabId=...
inmemory://model/src/hello.ts#...
```

Do not append uniqueness after the extension:

```text
inmemory://model/src/hello.ts-1779005182520-j57xr
inmemory://model/src/hello.ts__1779005182520
```

Both patterns break TypeScript worker extension detection.

## Model Reuse Rules

When reusing a cached model:

1. If the cached model URI matches the desired URI, reuse it.
2. If only the language id is stale, update the model language in place and clear old TS/JS markers.
3. If the URI changed, remove it from the tab cache and create a new model with the canonical URI.
4. Do not create fallback URIs by appending suffixes after the file extension.

## Troubleshooting

If TypeScript diagnostics report JavaScript-only errors in `.ts` files:

1. Check `model.uri.toString()`.
2. Confirm it ends with `.ts` or `.tsx`.
3. Confirm tab identity is in `model.uri.authority`, not query/hash/path suffix.
4. Confirm `model.getLanguageId()` is `typescript`.
5. Close/reopen the tab if an old in-memory model was created before the URI contract changed.

