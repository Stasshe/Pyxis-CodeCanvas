# Runtime Provider Architecture

`RuntimeRegistry` selects and manages providers by file extension. Node.js is registered as a built-in provider; language extensions can register other providers such as Python. The registry is the common entry point used by shell commands, npm scripts, and RunPanel.

## Provider contract

The current contract is defined in `src/engine/runtime/core/RuntimeProvider.ts`:

```typescript
export interface RuntimeProvider {
  readonly id: string;
  readonly name: string;
  readonly supportedExtensions: string[];
  canExecute(filePath: string): boolean;
  initialize?(rootPath: string): Promise<void>;
  execute(options: RuntimeExecutionOptions): Promise<RuntimeExecutionResult>;
  clearCache?(): void;
  dispose?(): Promise<void>;
  isReady?(): boolean;
}
```

`RuntimeExecutionOptions` provides absolute `rootPath` and `filePath`, optional `cwd` and `argv`, an `AbortSignal`, `subscribeInterrupt`, stdout/stderr callbacks, a debug console, stdin, and terminal dimensions. `AbortSignal` cancels the run once. `subscribeInterrupt` receives each SIGINT separately, allowing a second Ctrl+C to force termination after the first was handled. A result can return stdout, stderr, a value, and an exit code.

The Node.js provider uses virtual HOME `/home/pyxis`; a newly created workspace is `~/<name>`. Its module cache is stored at `~/.cache/pyxis`. npm metadata is fetched fresh; package tarballs are cached at `~/.npm` under a SHA-256 key derived from the exact resolved tarball URL, after successful extraction.

## Node.js provider lifecycle

`NodeRuntimeProvider` prewarms one idle Runtime Worker. `execute()` reuses it when available and creates a Worker on demand for concurrent runs. Normal completion returns a Worker to the idle pool, which retains at most one; termination or an unhandled worker failure discards it and starts a replacement. Runtime output is forwarded to the caller as it arrives. `AbortSignal` force-cancels the Worker and returns exit code 130. `subscribeInterrupt` delivers catchable SIGINT events; an unhandled or repeated SIGINT terminates the Worker with exit code 130. Runtime host shell work receives its own abort signal and is stopped when the run is interrupted or terminated.

Runtime calls come through the registry:

```typescript
const provider = runtimeRegistry.getRuntimeForFile(filePath);
if (provider) {
  await provider.execute({ rootPath, filePath, cwd, signal, onStdout, onStderr });
}
```

The Node.js provider runs in a Worker. Python's extension provider remains on its own existing execution path. Runtime implementation details are in [Node.js Runtime](./NODE-RUNTIME.md).

## Transpiler registration

`TranspilerProvider` is a descriptor, not a callback API. It declares an id, supported extensions, and the transform to run in the shared transpile Worker:

```typescript
export interface TranspilerProvider {
  readonly id: string;
  readonly supportedExtensions: string[];
  readonly workerTransform: 'typescript';
}
```

The registry maps extensions to descriptors. The FS Worker owns one lazy transpile pool with one Worker, shared by JavaScript module transforms and registered TypeScript transforms. The pool retires its Worker after 30 seconds without work. npm installation preserves package file bytes; runtime transforms occur when modules load.

## Lifecycle responsibilities

Providers own their active execution resources. The Node.js provider keeps Runtime Workers in a page-shared pool; `dispose()` stops that provider's active executions, while the pool's idle Worker remains available for the page lifetime. Callers pass an `AbortSignal` for forced cancellation and `subscribeInterrupt` for catchable, repeatable SIGINT events. The registry does not cache NodeRuntime instances between runs.
