import { UnixCommands } from '../global/unix';
import type { ShellExecutorOptions, ShellRunResult } from './executor';

interface ForkShellOptions extends ShellExecutorOptions {
  aliases: Record<string, string>;
  pipefail: boolean;
  nounset: boolean;
}

interface ForkShell {
  run(line: string): Promise<ShellRunResult>;
  setAlias(name: string, value: string): void;
  setPipefail(enabled: boolean): void;
  setNounset(enabled: boolean): void;
}

export async function createForkedShell<T extends ForkShell>(
  options: ForkShellOptions,
  createShell: (options: ShellExecutorOptions) => T
): Promise<T> {
  const cwd = options.unix ? await options.unix.pwd() : (options.cwd ?? options.rootPath);
  let unix: UnixCommands | undefined;
  if (options.unix) {
    unix = new UnixCommands(options.rootPath);
    unix.setCurrentDir(cwd);
  }
  const child = createShell({
    ...options,
    cwd,
    unix,
    env: { ...options.env, PWD: cwd },
  });
  for (const [name, value] of Object.entries(options.aliases)) {
    child.setAlias(name, value);
  }
  child.setPipefail(options.pipefail);
  child.setNounset(options.nounset);
  return child;
}
