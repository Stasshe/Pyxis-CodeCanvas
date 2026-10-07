import type { Terminal } from '@xterm/xterm';
import { readFileContent } from '@/engine/core/fileContent';
import { normalizePath, resolvePath } from '@/engine/core/fs';
import { VimEditor } from '../app/vim/VimEditor';

interface UnixCommands {
  pwd(): Promise<string>;
}

// Vim command handler that integrates VimEditor with the terminal
// src/engine/cmd/handlers/vimHandler.ts
export async function handleVimCommand(
  args: string[],
  unixCommandsRef: { current: UnixCommands | null } | null,
  captureWriteOutput: (output: string) => Promise<void> | void,
  rootPath: string,
  xtermInstance?: Terminal,
  onVimExit?: () => void
) {
  const write = async (s: string) => {
    try {
      await captureWriteOutput(s);
    } catch {
      // ignore
    }
  };

  if (!args || args.length === 0) {
    await write('Usage: vim <file>\n');
    return;
  }

  // Check if xterm instance is available
  if (!xtermInstance) {
    await write('vim: Terminal instance not available\n');
    return;
  }

  // **【重要】vim起動前にターミナルを完全にクリア**
  xtermInstance.clear();
  xtermInstance.write('\x1b[2J\x1b[3J\x1b[H');

  try {
    const cwd = unixCommandsRef?.current ? await unixCommandsRef.current.pwd() : rootPath;
    const relativePath = normalizePath(resolvePath(cwd, args[0]));

    // Try to load existing file
    let content = '';

    try {
      const loaded = await readFileContent(relativePath);
      if (loaded.kind === 'binary') throw new Error(`Cannot edit binary file: ${relativePath}`);
      content = loaded.content;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    // Extract filename from path
    const fileName = relativePath.split('/').pop() || relativePath;

    // Create and start Vim editor
    const vimEditor = new VimEditor(xtermInstance, fileName, content, relativePath);

    vimEditor.start(() => {
      // On exit callback
      if (onVimExit) {
        onVimExit();
      }
    });

    // Return VimEditor instance for external control (e.g., ESC button)
    return vimEditor;
  } catch (e) {
    await write(`vim: Error: ${(e as Error).message}\n`);
  }

  return null;
}

export default handleVimCommand;
