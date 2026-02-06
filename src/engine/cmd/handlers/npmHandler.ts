import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';

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

  const npm = terminalCommandRegistry.getNpmCommands(
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
    // Try common shim names
    const candidates = [
      `node_modules/.bin/${binary}`,
      `node_modules/.bin/${binary}.js`,
      `node_modules/.bin/${binary}.cmd`,
    ];

    // Lazy import path utils and NodeRuntime to avoid cycles
    const { fsPathToAppPath, resolvePath, toFSPath } = await import('@/engine/core/pathUtils');
    const { NodeRuntime } = await import('../../runtime/nodejs/nodeRuntime');

    for (const cand of candidates) {
      const cwdApp = fsPathToAppPath(cwdFs, projectName);
      const resolvedApp = resolvePath(cwdApp, cand.replace(/^\.\//, ''));
      const absFs = toFSPath(projectName, resolvedApp);
      const exists = await unix.cat([absFs]).catch(() => null);
      if (exists !== null) {
        // Execute via NodeRuntime
        const debugConsole = {
          log: async (...a: unknown[]) => await writeOutput(a.map(x => String(x)).join(' ') + '\n'),
          error: async (...a: unknown[]) =>
            await writeOutput(a.map(x => String(x)).join(' ') + '\n'),
          warn: async (...a: unknown[]) =>
            await writeOutput(a.map(x => String(x)).join(' ') + '\n'),
          clear: () => {},
        };

        const runtime = new NodeRuntime({
          projectId,
          projectName,
          filePath: absFs,
          debugConsole: {
            log: (...p: unknown[]) => debugConsole.log(...p),
            error: (...p: unknown[]) => debugConsole.error(...p),
            warn: (...p: unknown[]) => debugConsole.warn(...p),
            clear: () => {},
          },
          terminalColumns: 80,
          terminalRows: 24,
        });

        try {
          await runtime.execute(absFs, binArgs);
          await runtime.waitForEventLoop();
          return 0;
        } catch (e: any) {
          await writeOutput(String(e?.message ?? e) + '\n');
          return 1;
        }
      }
    }

    await writeOutput(`${binary}: command not found`);
    return 127;
  } catch (e: any) {
    await writeOutput(String(e?.message ?? e) + '\n');
    return 1;
  }
}
