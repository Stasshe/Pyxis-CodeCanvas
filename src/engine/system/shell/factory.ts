import { ShellExecutor } from './executor';
import type { ShellExecutorOptions } from './types';

export function createShellExecutor(options: ShellExecutorOptions): ShellExecutor {
  return new ShellExecutor(options);
}
