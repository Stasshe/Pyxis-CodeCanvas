import { fsClient } from '@/engine/core/fs/index';
import type { UnixCommands } from '@/engine/system/commands/unix/index';
import type { OutputCallbacks } from '@/engine/system/shell/executor';
import type StreamShell from '@/engine/system/shell/streamShell';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import type { ShellCommandRegistry } from '../shell/types';

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
  commandRegistry: ShellCommandRegistry | undefined
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
