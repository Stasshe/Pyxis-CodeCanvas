import type { UnixCommands } from '@/engine/cmd/global/unix';
import type StreamShell from '@/engine/cmd/shell/streamShell';
import { fsClient } from '@/engine/core/fs';
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
