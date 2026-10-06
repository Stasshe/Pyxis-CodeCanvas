import { UnixCommands } from '@/engine/cmd/global/unix';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fsClient } from '@/engine/core/fs/client';
import type { RuntimeExecutionOptions } from '@/engine/runtime/core/RuntimeProvider';
import { runtimeRegistry } from '@/engine/runtime/core/RuntimeRegistry';
import { getCurrentRootPath } from '@/stores/projectStore';
import { terminalProcessBridge } from '../terminalProcessBridge';

export async function handleNPMCommand(
  args: string[],
  rootPath: string,
  writeOutput: (output: string) => Promise<void>,
  setLoading?: (isLoading: boolean) => void
) {
  if (!args[0]) {
    await writeOutput('npm: missing command');
    return;
  }

  const npm = await terminalCommandRegistry.getNpmCommands(rootPath);
  if (setLoading) {
    npm.setLoadingHandler(setLoading);
  }

  const npmCmd = args[0];

  switch (npmCmd) {
    case 'init': {
      const force = args.includes('--force') || args.includes('-f');
      const initResult = await npm.init(force);
      await writeOutput(initResult);
      break;
    }

    case 'install':
    case 'i': {
      if (args[1]) {
        const packageName = args[1];
        const flags = args.slice(2);
        const installResult = await npm.install(packageName, flags);
        await writeOutput(installResult);
      } else {
        const installResult = await npm.install();
        await writeOutput(installResult);
      }
      break;
    }

    case 'uninstall':
    case 'remove':
    case 'rm': {
      if (args[1]) {
        const uninstallResult = await npm.uninstall(args[1]);
        await writeOutput(uninstallResult);
      } else {
        await writeOutput('npm uninstall: missing package name');
      }
      break;
    }

    case 'list':
    case 'ls': {
      const listResult = await npm.list();
      await writeOutput(listResult);
      break;
    }

    case 'run': {
      if (args[1]) {
        const runResult = await npm.run(args[1]);
        await writeOutput(runResult);
      } else {
        await writeOutput('npm run: missing script name');
      }
      break;
    }

    default:
      await writeOutput(`npm: '${npmCmd}' is not a supported npm command`);
      break;
  }
}

export default handleNPMCommand;

export async function handleNPXCommand(
  args: string[],
  writeOutput: (output: string) => Promise<void>,
  subscribeInterrupt?: RuntimeExecutionOptions['subscribeInterrupt'],
  signal?: AbortSignal
): Promise<number> {
  // npx <bin> [args...]
  if (!args[0]) {
    await writeOutput('npx: missing command');
    return 2;
  }

  const binary = args[0];
  const binArgs = args.slice(1);

  try {
    const rootPath = getCurrentRootPath();
    if (!rootPath) throw new Error('No workspace folder is open.');
    const unix = new UnixCommands(rootPath);
    const cwdFs = await unix.pwd();
    // Lazy import path utils and NodeRuntime to avoid cycles
    const { resolvePath } = await import('@/engine/core/pathUtils');
    const cwdApp = cwdFs;

    const directPackageJsonApp = resolvePath(cwdApp, `node_modules/${binary}/package.json`);
    const directPackageJson = await fsClient.readText(directPackageJsonApp).catch(() => null);

    let absFs: string | null = null;

    if (directPackageJson) {
      try {
        const pkg = JSON.parse(directPackageJson);
        const binField = typeof pkg.bin === 'string' ? { [pkg.name || binary]: pkg.bin } : pkg.bin;
        const selectedBin =
          (binField &&
            typeof binField === 'object' &&
            (binField[binary] || Object.values(binField)[0])) ||
          null;

        if (typeof selectedBin === 'string' && selectedBin.trim() !== '') {
          absFs = resolvePath(cwdApp, `node_modules/${binary}/${selectedBin.replace(/^\.\//, '')}`);
        }
      } catch (error: any) {
        await writeOutput(`npx: failed to resolve ${binary}: ${String(error?.message ?? error)}\n`);
        return 1;
      }
    }

    // パッケージ名とバイナリ名が一致しない場合 (例: tsc → typescript) の fallback
    if (!absFs) {
      const dotBinApp = resolvePath(cwdApp, `node_modules/.bin/${binary}`);
      const dotBinExists = await fsClient.exists(dotBinApp).catch(() => false);
      if (dotBinExists) {
        absFs = dotBinApp;
      }
    }

    if (!absFs) {
      await writeOutput(`${binary}: command not found`);
      return 127;
    }

    const exists = await fsClient.exists(absFs).catch(() => false);
    if (!exists) {
      await writeOutput(`${binary}: command not found`);
      return 127;
    }

    const runtime = runtimeRegistry.getRuntime('nodejs');
    if (!runtime) throw new Error('Node.js runtime provider is unavailable.');
    const fmt = (...values: unknown[]) =>
      writeOutput(values.map(value => String(value)).join(' ') + '\n');
    terminalProcessBridge.activate();
    try {
      const result = await runtime.execute({
        rootPath,
        filePath: absFs,
        cwd: cwdFs,
        argv: binArgs,
        subscribeInterrupt,
        signal,
        debugConsole: { log: fmt, error: fmt, warn: fmt, clear: () => {} },
        processStdin: terminalProcessBridge.stdin,
        onStdout: output => writeOutput(output),
        onStderr: output => writeOutput(output),
      });
      if (result.stderr) await writeOutput(result.stderr);
      return result.exitCode ?? 0;
    } finally {
      terminalProcessBridge.deactivate();
    }
  } catch (e: any) {
    await writeOutput(String(e?.message ?? e) + '\n');
    return 1;
  }
}
