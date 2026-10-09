import type { Readable } from 'node:stream';
import { UnixCommands } from '@/engine/cmd/global/unix';
import { ShellExecutor } from '@/engine/cmd/shell/executor';
import type { ShellResult } from './workerProtocol';

interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  stdin?: Readable;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export async function executeRuntimeShell(
  rootPath: string,
  command: string,
  options: ShellOptions
): Promise<ShellResult> {
  const unix = new UnixCommands(rootPath);
  await unix.cd([options.cwd ?? rootPath]);
  const executor = new ShellExecutor({
    rootPath,
    cwd: options.cwd ?? rootPath,
    signal: options.signal,
    unix,
    env: options.env,
  });
  const result = await executor.run(
    command,
    {
      stdout: options.onStdout,
      stderr: options.onStderr,
    },
    {
      stdin: options.stdin,
    }
  );
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}
