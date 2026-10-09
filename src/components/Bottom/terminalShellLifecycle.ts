import type { UnixCommands } from '@/engine/cmd/global/unix';
import type { OutputCallbacks } from '@/engine/cmd/shell/executor';
import type StreamShell from '@/engine/cmd/shell/streamShell';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fsClient } from '@/engine/core/fs';
import type { CommandRegistry } from '@/engine/extensions/commandRegistry';

type TerminalCommandRegistry = Pick<
  CommandRegistry,
  'hasCommand' | 'executeCommand' | 'getRegisteredCommands'
>;

export function createShellOutputCallbacks(
  redirected: boolean,
  writeOutput: (data: string) => Promise<void>,
  writeError: (data: string) => Promise<void> | undefined
): { callbacks: OutputCallbacks; pendingWrites: Promise<void>[] } {
  const pendingWrites: Promise<void>[] = [];
  return {
    callbacks: {
      stdout: data => {
        if (redirected) return;
        pendingWrites.push(writeOutput(data).catch(() => {}));
      },
      stderr: data => {
        if (redirected) return;
        pendingWrites.push(writeError(data)?.catch(() => {}) ?? Promise.resolve());
      },
    },
    pendingWrites,
  };
}

export async function runTerminalShellCommand(
  rootPath: string,
  shell: StreamShell,
  command: string,
  callbacks: OutputCallbacks,
  unix: UnixCommands | null,
  commandRegistry: TerminalCommandRegistry | undefined
): Promise<StreamShell> {
  const result = await shell.run(command, callbacks);
  if (!result.exitShell) return shell;
  if (!unix || !commandRegistry) throw new Error('Cannot restart the terminal shell.');
  const replacement = await terminalCommandRegistry.replaceShell(rootPath, shell, {
    unix,
    commandRegistry,
    fsClient,
  });
  if (!replacement) throw new Error('Terminal shell was removed during exit.');
  return replacement;
}
