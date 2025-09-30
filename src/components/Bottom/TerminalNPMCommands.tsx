// TerminalNPMCommands.tsx
// TerminalのNPMコマンド処理部分を分割
// ...original Terminal.tsx からNPMコマンド処理部分を移植して実装してください。

export async function handleNPMCommand(
  args: string[],
  npmCommandsRef: React.RefObject<any>, // NPMコマンドを扱うリファレンス
  writeOutput: (output: string) => Promise<void>
) {
  if (!npmCommandsRef.current || !args[0]) {
    await writeOutput('npm: missing command');
    return;
  }
  const npmCmd = args[0];
  switch (npmCmd) {
    case 'init':
      const force = args.includes('--force') || args.includes('-f');
      const initResult = await npmCommandsRef.current.init(force);
      await writeOutput(initResult);
      break;

    case 'install':
    case 'i':
      if (args[1]) {
        // npm install <package> [flags]
        const packageName = args[1];
        const flags = args.slice(2); // 2番目以降の引数をflagsとして渡す
        const installResult = await npmCommandsRef.current.install(packageName, flags);
        await writeOutput(installResult);
      } else {
        // npm install (install all dependencies)
        const installResult = await npmCommandsRef.current.install();
        await writeOutput(installResult);
      }
      break;

    case 'uninstall':
    case 'remove':
    case 'rm':
      if (args[1]) {
        const uninstallResult = await npmCommandsRef.current.uninstall(args[1]);
        await writeOutput(uninstallResult);
      } else {
        await writeOutput('npm uninstall: missing package name');
      }
      break;

    case 'list':
    case 'ls':
      const listResult = await npmCommandsRef.current.list();
      await writeOutput(listResult);
      break;

    case 'run':
      if (args[1]) {
        const runResult = await npmCommandsRef.current.run(args[1]);
        await writeOutput(runResult);
      } else {
        await writeOutput('npm run: missing script name');
      }
      break;

    default:
      await writeOutput(`npm: '${npmCmd}' is not a supported npm command`);
      break;
  }
}
