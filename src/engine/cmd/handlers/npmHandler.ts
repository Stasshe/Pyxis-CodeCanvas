import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { NpmInstall } from '../global/npmOperations/npmInstall';
import { FileRepository as InMemoryFileRepository } from '@/engine/core/fileRepository/inmemory';

function parsePackageSpec(spec: string): { packageName: string; version: string } {
  if (spec.startsWith('@')) {
    const atIndex = spec.lastIndexOf('@');
    if (atIndex > 0) {
      return {
        packageName: spec.slice(0, atIndex),
        version: spec.slice(atIndex + 1) || 'latest',
      };
    }
    return { packageName: spec, version: 'latest' };
  }

  const atIndex = spec.lastIndexOf('@');
  if (atIndex > 0) {
    return {
      packageName: spec.slice(0, atIndex),
      version: spec.slice(atIndex + 1) || 'latest',
    };
  }
  return { packageName: spec, version: 'latest' };
}

function resolvePackageBinPath(packageJson: any, binary: string): string | null {
  if (!packageJson) return null;
  const bin = packageJson.bin;
  if (typeof bin === 'string') {
    return bin.replace(/^[./]+/, '');
  }
  if (typeof bin === 'object' && bin !== null) {
    if (typeof bin[binary] === 'string') {
      return String(bin[binary]).replace(/^[./]+/, '');
    }
    const keys = Object.keys(bin);
    if (keys.length === 1 && typeof bin[keys[0]] === 'string') {
      return String(bin[keys[0]]).replace(/^[./]+/, '');
    }
  }
  if (typeof packageJson.main === 'string') {
    return packageJson.main.replace(/^[./]+/, '');
  }
  return 'index.js';
}

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

    const { packageName, version } = parsePackageSpec(binary);
    const tempRepo = InMemoryFileRepository.createNewInstance();
    const tempInstall = new NpmInstall(projectName, projectId, true, tempRepo);
    tempInstall.startBatchProcessing();
    try {
      await writeOutput(`npx: installing ${packageName}@${version} temporarily...\n`);
      await tempInstall.installWithDependencies(packageName, version, {
        isDirect: true,
        ignoreEntry: 'node_modules',
      });
      await tempInstall.ensureBinsForPackage(packageName).catch(() => {});
      await tempInstall.finishBatchProcessing();

      const pkgFile = await tempRepo.getFileByPath(projectId, `/node_modules/${packageName}/package.json`);
      if (!pkgFile || !pkgFile.content) {
        throw new Error(`Package ${packageName} installed but package.json not found`);
      }
      const pkgJson = JSON.parse(pkgFile.content);
      const binRelative = resolvePackageBinPath(pkgJson, binary);
      if (!binRelative) {
        throw new Error(`Cannot resolve executable for ${binary}`);
      }
      const absFsTemp = toFSPath(projectName, `/node_modules/${packageName}/${binRelative}`);
      const binFile = await tempRepo.getFileByPath(projectId, `/node_modules/${packageName}/${binRelative}`);
      if (!binFile) {
        throw new Error(`Temporary executable not found: ${binRelative}`);
      }

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
        filePath: absFsTemp,
        debugConsole: {
          log: (...p: unknown[]) => debugConsole.log(...p),
          error: (...p: unknown[]) => debugConsole.error(...p),
          warn: (...p: unknown[]) => debugConsole.warn(...p),
          clear: () => {},
        },
        fileRepository: tempRepo,
        terminalColumns: 80,
        terminalRows: 24,
      });

      try {
        await runtime.execute(absFsTemp, binArgs);
        await runtime.waitForEventLoop();
        return 0;
      } catch (e: any) {
        await writeOutput(String(e?.message ?? e) + '\n');
        return 1;
      }
    } catch (error: any) {
      await tempInstall.finishBatchProcessing();
      await writeOutput(`npx: failed to install ${packageName}: ${String(error?.message ?? error)}\n`);
      return 1;
    }
  } catch (e: any) {
    await writeOutput(String(e?.message ?? e) + '\n');
    return 1;
  }
}
