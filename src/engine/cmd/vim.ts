import { VimEditor } from './VimEditor';
import { fileRepository } from '@/engine/core/fileRepository';

// Vim command handler that integrates VimEditor with the terminal
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

    if (isNewFile) {
      // Note: The message will be shown in the Vim status line
      // We don't need to write it here as it would interfere with Vim's display
    }
  } catch (e) {
    await write(`vim: Error: ${(e as Error).message}\n`);
  }
}

export default handleVimCommand;
