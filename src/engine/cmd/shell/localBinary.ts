import type { FsApi } from '@/engine/core/fs';
import { getParentPath, resolvePath } from '@/engine/core/pathUtils';
import { runtimeRegistry } from '@/engine/runtime/core/RuntimeRegistry';
import { ProcessStdin, terminalProcessBridge } from '../terminalProcessBridge';
import type { Process } from './process';

export interface LocalBinaryOptions {
  command: string;
  args: string[];
  rootPath: string;
  cwd: string;
  terminalColumns: number;
  terminalRows: number;
  fsClient: FsApi;
  process: Process;
  signal?: AbortSignal;
}

export async function resolveLocalBinary(
  command: string,
  cwd: string,
  fsClient: FsApi
): Promise<string | null> {
  let directory = resolvePath(cwd);
  while (true) {
    const binaryPath = resolvePath(directory, `node_modules/.bin/${command}`);
    if (await fsClient.exists(binaryPath)) return binaryPath;
    if (directory === '/') return null;
    directory = getParentPath(directory);
  }
}

export async function runLocalBinary(options: LocalBinaryOptions): Promise<number | null> {
  const { command, args, rootPath, cwd, terminalColumns, terminalRows, process, fsClient } =
    options;
  const filePath = await resolveLocalBinary(command, cwd, fsClient);
  if (!filePath) return null;

  const runtime = runtimeRegistry.getRuntime('nodejs');
  if (!runtime) {
    process.writeStderr('Node.js runtime provider is unavailable.\n');
    return 1;
  }

  const writeConsole = (...values: unknown[]) =>
    process.writeStdout(`${values.map(value => String(value)).join(' ')}\n`);
  const writeConsoleError = (...values: unknown[]) =>
    process.writeStderr(`${values.map(value => String(value)).join(' ')}\n`);
  terminalProcessBridge.activate();
  try {
    let processStdin = terminalProcessBridge.stdin;
    if (process.stdinRedirected) processStdin = new ProcessStdin(process.stdinStream);
    const result = await runtime.execute({
      rootPath,
      filePath,
      cwd,
      argv: args,
      signal: options.signal,
      subscribeInterrupt: handler => {
        const listener = (signal: string) => {
          if (signal === 'SIGINT') handler();
        };
        process.on('signal', listener);
        return () => process.off('signal', listener);
      },
      debugConsole: {
        log: writeConsole,
        error: writeConsoleError,
        warn: writeConsole,
        clear: () => {},
      },
      processStdin,
      terminalColumns,
      terminalRows,
      onStdout: data => process.writeStdout(data),
      onStderr: data => process.writeStderr(data),
    });
    if (result.stderr) process.writeStderr(result.stderr);
    return result.exitCode ?? 0;
  } finally {
    terminalProcessBridge.deactivate();
  }
}
