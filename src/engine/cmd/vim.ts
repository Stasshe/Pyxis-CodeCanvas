import { fileRepository } from '@/engine/core/fileRepository';
import { VimEditor } from './VimEditor';

// Vim command handler that integrates VimEditor with the terminal
// src/engine/cmd/vim.ts
export async function handleVimCommand(
  args: string[],
  unixCommandsRef: { current: any } | null,
  captureWriteOutput: (output: string) => Promise<void> | void,
  currentProject: string,
  currentProjectId: string,
  xtermInstance?: any,
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

  let entryPath = args[0];
  try {
    if (unixCommandsRef && unixCommandsRef.current) {
      if (!entryPath.startsWith('/')) {
        const cwd = await unixCommandsRef.current.pwd();
        const combined = cwd.replace(/\/$/, '') + '/' + entryPath;
        entryPath = unixCommandsRef.current.normalizePath(combined);
      } else {
        entryPath = unixCommandsRef.current.normalizePath(entryPath);
      }
    }
  } catch (e) {
    // resolve failed, use original path
    entryPath = args[0];
  }

  try {
    const relativePath = unixCommandsRef?.current
      ? unixCommandsRef.current.getRelativePathFromProject(entryPath)
      : entryPath;

    // Try to load existing file
    let content = '';
    let isNewFile = false;

    try {
      const file = await fileRepository.getFileByPath(currentProjectId, relativePath);
      if (file) {
        content = file.content || '';
      } else {
        isNewFile = true;
      }
    } catch (e) {
      // File doesn't exist, create new
      isNewFile = true;
    }

    // Extract filename from path
    const fileName = relativePath.split('/').pop() || relativePath;

    // Create and start Vim editor
    const vimEditor = new VimEditor(
      xtermInstance,
      fileName,
      content,
      currentProjectId,
      relativePath
    );

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
