import type { FsApi } from '@/engine/core/fs';
import { resolvePath } from '@/engine/core/pathUtils';
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

async function resolveBinary(
  command: string,
  cwd: string,
  fsClient: FsApi
): Promise<string | null> {
  const packagePath = resolvePath(cwd, `node_modules/${command}/package.json`);
  const source = await fsClient.readText(packagePath).catch(() => null);
  if (source) {
    try {
      const metadata = JSON.parse(source) as {
        bin?: string | Record<string, string>;
      };
      let binary: string | undefined;
      if (typeof metadata.bin === 'string') binary = metadata.bin;
      if (typeof metadata.bin === 'object') {
        binary = metadata.bin[command] ?? Object.values(metadata.bin)[0];
      }
      if (binary) {
        return resolvePath(cwd, `node_modules/${command}/${binary.replace(/^\.\//, '')}`);
      }
    } catch {
      // Invalid package metadata falls back to the installed .bin shim.
    }
  }

  const shimPath = resolvePath(cwd, `node_modules/.bin/${command}`);
  if (await fsClient.exists(shimPath).catch(() => false)) return shimPath;
  return null;
}

export async function runLocalBinary(options: LocalBinaryOptions): Promise<number | null> {
  const { command, args, rootPath, cwd, terminalColumns, terminalRows, process, fsClient } =
    options;
  const filePath = await resolveBinary(command, cwd, fsClient);
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
