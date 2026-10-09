import { fsClient } from '@/engine/core/fs/index';
import type { UnixCommands } from '@/engine/system/commands/unix/index';
import type StreamShell from '@/engine/system/shell/streamShell';
import type { TerminalCompletionSource } from './terminalCompletion';

export function createTerminalCompletionSource(
  unix: UnixCommands | null,
  shell: StreamShell | null
): TerminalCompletionSource | null {
  if (!unix) return null;
  return {
    getCommandNames: async () => (await shell?.getCommandNames()) ?? [],
    pwd: () => unix.pwd(),
    normalizePath: path => unix.normalizePath(path),
    readdir: path => fsClient.readdir(path),
  };
}
