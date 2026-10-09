import type { ThemeColors } from '@/context/ThemeContext';
import { findGitRepositoryRoot } from '@/engine/cmd/global/gitOperations/repositoryRoot';
import type { UnixCommands } from '@/engine/cmd/global/unix';
import type { TerminalOutputManager } from '@/engine/cmd/terminalOutputManager';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import type { FsApi } from '@/engine/core/fs';

export async function writeTerminalPrompt(
  output: TerminalOutputManager,
  unix: UnixCommands,
  fsClient: FsApi,
  colors: ThemeColors
): Promise<void> {
  await output.flush();
  await output.ensureNewline();
  const currentDirectory = await unix.pwd();
  let branchDisplay = '';
  const gitRoot = await findGitRepositoryRoot(currentDirectory, fsClient);
  if (gitRoot) {
    const branch = await terminalCommandRegistry.getGitCommands(gitRoot).getCurrentBranch();
    if (branch !== '(no git)') {
      const branchColors = colors.gitBranchColors || [];
      let colorHex = colors.primary;
      if (branchColors.length > 0) {
        const branchValue = branch
          .split('')
          .reduce((sum, character) => sum + character.charCodeAt(0), 0);
        colorHex = branchColors[Math.abs(branchValue) % branchColors.length];
      }
      const rgb = colorHex
        .replace('#', '')
        .match(/.{2}/g)
        ?.map(value => Number.parseInt(value, 16)) || [0, 0, 0];
      branchDisplay = ` (\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${branch}\x1b[0m)`;
    }
  }
  await output.writeRaw(`${currentDirectory}${branchDisplay} $ `);
  await output.flush();
}

export async function showTerminalPrompt(
  output: TerminalOutputManager,
  unix: UnixCommands,
  fsClient: FsApi,
  colors: ThemeColors,
  scrollToBottom: () => void
): Promise<void> {
  await writeTerminalPrompt(output, unix, fsClient, colors);
  scrollToBottom();
  setTimeout(scrollToBottom, 50);
  setTimeout(scrollToBottom, 150);
}
