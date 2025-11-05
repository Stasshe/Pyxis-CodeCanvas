import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import handlePyxisCommandFromComponent from '@/components/Bottom/TerminalPyxisCommands';

/**
 * Thin wrapper for existing pyxis command implementation.
 * It adapts the registry-based instances into the shape expected by the
 * original component-level handler (which accepted { unixCommandsRef, gitCommandsRef, npmCommandsRef }).
 */
export async function handlePyxisCommand(
  cmd: string,
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>
) {
  // Create lightweight "ref-like" objects that point to registry instances
  const unixInst = terminalCommandRegistry.getUnixCommands(projectName, projectId);
  const gitInst = terminalCommandRegistry.getGitCommands(projectName, projectId);
  const npmInst = terminalCommandRegistry.getNpmCommands(projectName, projectId, `/projects/${projectName}`);

  const refs = {
    unixCommandsRef: { current: unixInst } as any,
    gitCommandsRef: { current: gitInst } as any,
    npmCommandsRef: { current: npmInst } as any,
  };

  // Delegate to existing handler implementation (keeps feature parity)
  try {
    await handlePyxisCommandFromComponent(cmd, args, refs, projectName, projectId, writeOutput);
  } catch (e) {
    await writeOutput(`Error: ${(e as Error).message}`);
  }
}

export default handlePyxisCommand;
