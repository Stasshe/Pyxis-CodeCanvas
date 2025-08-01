# Copilot Instructions for Pyxis Client-Side IDE

## Project Overview
Pyxis is a fully client-side IDE and terminal, running in the browser with Node.js runtime and Git support. No server is required. The codebase is built with Next.js (App Router), React, TypeScript, Tailwind CSS, Monaco Editor, xterm.js, and isomorphic-git.

## Architecture & Key Components
- **src/app/**: Next.js app entry, global styles, layout, and main page.
- **src/components/**: UI components (editor, terminal, file tree, git panels, etc.).
- **src/utils/**: Core logic for filesystem, database, runtime, git, and export/import operations.
- **src/context/**: React context for theming and global state.
- **public/**: Static assets and manifest files.

### Data Flow & Runtime
- **Filesystem**: Uses Lightning FS and IndexedDB for local file/project storage.
- **Node.js Emulation**: QuickJS and node-stdlib-browser polyfills provide Node.js APIs in-browser.
- **Terminal**: xterm.js powers the integrated terminal, supporting Unix-like commands and npm scripts.
- **Git**: isomorphic-git enables all git operations locally, with visual history via @gitgraph/react.

## Developer Workflows
- **No build step required for browser use.**
- **npm scripts**: Use the integrated terminal for `npm install`, `npm run <script>`, etc.
- **Git operations**: All commands (`git init`, `add`, `commit`, `branch`, `merge`, etc.) are supported in-browser.
- **Project persistence**: Projects/files are stored in IndexedDB and can be exported/imported via UI.
- **Debugging**: Use browser devtools; runtime errors are surfaced in the terminal/editor output.

## Project-Specific Patterns & Conventions
- **Component structure**: All UI logic is in `src/components/`, each panel/editor is a separate file.
- **File operations**: Use `src/utils/filesystem.ts` and related helpers for reading/writing files.
- **Git logic**: Modularized under `src/utils/cmd/git.ts` and `src/utils/cmd/gitOperations/`.
- **Export/Import**: Handled by `src/utils/export/` modules.
- **Theme/context**: Managed via React context in `src/context/ThemeContext.tsx`.
- **Touch/Tablet UX**: UI is optimized for iPad/mobile; see `terminal_touch_flow.md` for touch-specific flows.

## Integration Points
- **Monaco Editor**: Used for code editing, configured in `CodeEditor.tsx`.
- **xterm.js**: Terminal logic in `Terminal.tsx`.
- **isomorphic-git**: Git operations in `GitPanel.tsx`, `GitHistory.tsx`, and utils.
- **QuickJS/node-stdlib-browser**: Node.js emulation in `nodeRuntime.ts`.

## Examples
- **Add a new panel**: Create a component in `src/components/`, update layout in `src/app/layout.tsx`.
- **Add a new command**: Extend `src/utils/cmd/unix.ts` or `npm.ts` for terminal commands.
- **Persist new data**: Use IndexedDB logic in `src/utils/database.ts`.

## External Dependencies
- Next.js, React, Tailwind CSS, Monaco Editor, xterm.js, Lightning FS, QuickJS, node-stdlib-browser, isomorphic-git, @gitgraph/react

## References
- See `README.md` and `terminal_touch_flow.md` for further details on architecture and UX.
- For UI/UX conventions, review `src/components/` and global styles in `src/app/globals.css`.

---

**For AI agents:**
- Always prefer client-side APIs and local storage.
- Avoid server-side code or assumptions about backend availability.
- Follow modular patterns and keep logic in the appropriate `src/utils/` or `src/components/` subdirectory.
- When in doubt, reference the README and key utility files for project conventions.
