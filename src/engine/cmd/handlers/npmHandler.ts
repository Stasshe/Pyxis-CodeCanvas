import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { TerminalUI, createTerminalUI } from '@/engine/cmd/terminalUI';

/**
 * Check if operation should be aborted
 */
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Operation interrupted');
  }
}

export async function handleNPMCommand(
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>,
  setLoading?: (isLoading: boolean) => void,
  signal?: AbortSignal
) {
  if (!args[0]) {
    await writeOutput('npm: missing command');
    return;
  }

  // Check for abort before starting
  checkAbort(signal);

  // Create TerminalUI instance for advanced display features
  const ui = createTerminalUI(writeOutput);

  const npm = terminalCommandRegistry.getNpmCommands(
    projectName,
    projectId,
    `/projects/${projectName}`
  );

  // Pass the TerminalUI to npm commands for advanced output
  npm.setTerminalUI(ui);

  if (setLoading) {
    npm.setLoadingHandler(setLoading);
  }

  const npmCmd = args[0];

  switch (npmCmd) {
    case 'init': {
      checkAbort(signal);
      const force = args.includes('--force') || args.includes('-f');
      const initResult = await npm.init(force);
      await writeOutput(initResult);
      break;
    }

    case 'install':
    case 'i': {
      checkAbort(signal);
      if (args[1]) {
        const packageName = args[1];
        const flags = args.slice(2);
        const installResult = await npm.install(packageName, flags);
        checkAbort(signal);
        await writeOutput(installResult);
      } else {
        const installResult = await npm.install();
        checkAbort(signal);
        await writeOutput(installResult);
      }
      break;
    }

    case 'uninstall':
    case 'remove':
    case 'rm': {
      checkAbort(signal);
      if (args[1]) {
        const uninstallResult = await npm.uninstall(args[1]);
        checkAbort(signal);
        await writeOutput(uninstallResult);
      } else {
        await writeOutput('npm uninstall: missing package name');
      }
      break;
    }

    case 'list':
    case 'ls': {
      checkAbort(signal);
      const listResult = await npm.list();
      await writeOutput(listResult);
      break;
    }

    case 'run': {
      checkAbort(signal);
      if (args[1]) {
        const runResult = await npm.run(args[1]);
        checkAbort(signal);
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
