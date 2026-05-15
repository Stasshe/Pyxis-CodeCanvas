import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fileRepository } from '@/engine/core/fileRepository';

export async function handleNPMCommand(
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>,
  setLoading?: (isLoading: boolean) => void
) {
  if (!args[0]) {
    await writeOutput('npm: missing command');
    return;
  }

  const npm = await terminalCommandRegistry.getNpmCommands(
    projectName,
    projectId,
    `/projects/${projectName}`
  );
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
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>
): Promise<number> {
  // npx <bin> [args...]
  if (!args[0]) {
    await writeOutput('npx: missing command');
    return 2;
  }

  const binary = args[0];
  const binArgs = args.slice(1);

  // Resolve using UnixCommands to access project FS
  const unix = terminalCommandRegistry.getUnixCommands(projectName, projectId);
  try {
    const cwdFs = await unix.pwd();
    // Lazy import path utils and NodeRuntime to avoid cycles
    const { fsPathToAppPath, resolvePath, toFSPath } = await import('@/engine/core/pathUtils');
    const { NodeRuntime } = await import('../../runtime/nodejs/nodeRuntime');
    const cwdApp = fsPathToAppPath(cwdFs, projectName);

    const directPackageJsonApp = resolvePath(cwdApp, `node_modules/${binary}/package.json`);
    const directPackageJson = await fileRepository
      .getFileByPath(projectId, directPackageJsonApp)
      .catch(() => null);

    let absFs: string | null = null;

    if (directPackageJson?.content) {
      try {
        const pkg = JSON.parse(directPackageJson.content);
        const binField = typeof pkg.bin === 'string' ? { [pkg.name || binary]: pkg.bin } : pkg.bin;
        const selectedBin =
          (binField && typeof binField === 'object' && (binField[binary] || Object.values(binField)[0])) ||
          null;

        if (typeof selectedBin === 'string' && selectedBin.trim() !== '') {
          absFs = toFSPath(
            projectName,
            resolvePath(cwdApp, `node_modules/${binary}/${selectedBin.replace(/^\.\//, '')}`)
          );
        }
      } catch (error: any) {
        await writeOutput(`npx: failed to resolve ${binary}: ${String(error?.message ?? error)}\n`);
        return 1;
      }
    }

    // パッケージ名とバイナリ名が一致しない場合 (例: tsc → typescript) の fallback
    if (!absFs) {
      const dotBinApp = resolvePath(cwdApp, `node_modules/.bin/${binary}`);
      const dotBinFile = await fileRepository.getFileByPath(projectId, dotBinApp).catch(() => null);
      if (dotBinFile) {
        absFs = toFSPath(projectName, dotBinApp);
      }
    }

    if (!absFs) {
      await writeOutput(`${binary}: command not found`);
      return 127;
    }

    if (!absFs) {
      await writeOutput(`${binary}: command not found`);
      return 127;
    }

    const exists = await unix.cat([absFs]).catch(() => null);
    if (exists === null) {
      await writeOutput(`${binary}: command not found`);
      return 127;
    }

    const fmt = (...a: unknown[]) => writeOutput(a.map(x => String(x)).join(' ') + '\n');
    const runtime = new NodeRuntime({
      projectId,
      projectName,
      filePath: absFs,
      cwd: cwdFs,
      debugConsole: { log: fmt, error: fmt, warn: fmt, clear: () => {} },
      terminalColumns: 80,
      terminalRows: 24,
    });

    try {
      await runtime.execute(absFs, binArgs);
      await runtime.waitForEventLoop();
      return runtime.getExitCode();
    } catch (e: any) {
      await writeOutput(String(e?.message ?? e) + '\n');
      return 1;
    }
  } catch (e: any) {
    await writeOutput(String(e?.message ?? e) + '\n');
    return 1;
  }
}
