import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import type { TerminalUI } from '@/engine/cmd/terminalUI';

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
