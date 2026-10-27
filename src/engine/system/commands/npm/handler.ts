import { fsClient } from '@/engine/core/fs/client';
import type { NpmCommands, NpmRunContext } from '@/engine/system/commands/npm/index';
import { UnixCommands } from '@/engine/system/commands/unix/index';
import type { RuntimeExecutionOptions } from '@/engine/system/runtime/core/RuntimeProvider';
import { runtimeRegistry } from '@/engine/system/runtime/core/RuntimeRegistry';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { getCurrentRootPath } from '@/stores/projectStore';
import { resolveLocalBinary } from '../../shell/localBinary';
import type { ProcessStdin } from '../../terminal/terminalProcessBridge';

export async function handleNPMCommand(
  args: string[],
  rootPath: string,
  writeOutput: (output: string) => Promise<void>,
  writeError: (output: string) => Promise<void>,
  setLoading?: (isLoading: boolean) => void,
  streamOutput?: {
    stdout: (output: string) => Promise<void>;
    stderr: (output: string) => Promise<void>;
  },
  runContext?: NpmRunContext
): Promise<number> {
  if (!args[0]) {
    await writeError('npm: missing command');
    return 2;
  }
  const npmCmd = args[0];
  let npmOptions = args.slice(1);
  if (npmCmd === 'run' || npmCmd === 'start' || npmCmd === 'test') {
    const separator = npmOptions.indexOf('--');
    if (separator !== -1) npmOptions = npmOptions.slice(0, separator);
  }
  if (npmOptions.includes('-g') || npmOptions.includes('--global')) {
    await writeError('npm: global operations are not supported');
    return 1;
  }

  const npm = await terminalCommandRegistry.getNpmCommands(rootPath);
  if (setLoading) {
    npm.setLoadingHandler(setLoading);
  }

  switch (npmCmd) {
    case 'init': {
      const force = args.includes('--force') || args.includes('-f');
      const initResult = await npm.init(force);
      await writeOutput(initResult);
      break;
    }

    case 'install':
    case 'i': {
      const parsed = parseInstallArgs(args.slice(1));
      if (parsed.error) {
        await writeError(`npm install: ${parsed.error}`);
        return 1;
      }
      let installResult: string;
      if (parsed.packages.length > 1) {
        installResult = await npm.installPackages(parsed.packages, parsed.flags);
      } else {
        installResult = await npm.install(
          parsed.packages[0]?.name,
          flagsForSinglePackage(parsed.packages[0], parsed.flags)
        );
      }
      await writeOutput(installResult);
      break;
    }

    case 'uninstall':
    case 'remove':
    case 'rm': {
      const packages = args.slice(1);
      const unsupportedOption = packages.find(argument => argument.startsWith('-'));
      if (unsupportedOption) {
        await writeError(`npm uninstall: unsupported option '${unsupportedOption}'`);
        return 1;
      }
      if (packages.length > 0) {
        for (const packageName of packages) {
          const uninstallResult = await npm.uninstall(packageName);
          await writeOutput(uninstallResult);
        }
      } else {
        await writeError('npm uninstall: missing package name');
        return 2;
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
      const parsed = parseRunArgs(args.slice(1));
      if (parsed.error) {
        await writeError(`npm run: ${parsed.error}`);
        return parsed.code;
      }
      return runNpmScript(
        npm,
        parsed.scriptName,
        parsed.scriptArgs,
        streamOutput ?? { stdout: writeOutput, stderr: writeError },
        runContext
      );
    }

    case 'start':
    case 'test': {
      const parsed = parseRunArgs([npmCmd, ...args.slice(1)]);
      if (parsed.error) {
        await writeError(`npm ${npmCmd}: ${parsed.error}`);
        return parsed.code;
      }
      return runNpmScript(
        npm,
        parsed.scriptName,
        parsed.scriptArgs,
        streamOutput ?? { stdout: writeOutput, stderr: writeError },
        runContext
      );
    }

    default:
      await writeError(`npm: '${npmCmd}' is not a supported npm command`);
      return 1;
  }
  return 0;
}

async function runNpmScript(
  npm: NpmCommands,
  scriptName: string,
  scriptArgs: string[],
  streamOutput: {
    stdout: (output: string) => Promise<void>;
    stderr: (output: string) => Promise<void>;
  },
  runContext?: NpmRunContext
): Promise<number> {
  let writes = Promise.resolve();
  const result = await npm.runWithStatus(
    scriptName,
    scriptArgs,
    {
      stdout: output => {
        writes = writes.then(() => streamOutput.stdout(output));
      },
      stderr: output => {
        writes = writes.then(() => streamOutput.stderr(output));
      },
    },
    runContext
  );
  await writes;
  return result.code;
}

function parseRunArgs(args: string[]): {
  scriptName: string;
  scriptArgs: string[];
  error?: string;
  code: number;
} {
  const scriptName = args[0];
  if (!scriptName) return { scriptName: '', scriptArgs: [], error: 'missing script name', code: 2 };
  const separator = args.indexOf('--', 1);
  if (separator === -1 && args.length > 1)
    return { scriptName, scriptArgs: [], error: 'pass script arguments after --', code: 1 };
  if (separator > 1)
    return { scriptName, scriptArgs: [], error: `unsupported option '${args[1]}'`, code: 1 };
  let scriptArgs: string[] = [];
  if (separator !== -1) scriptArgs = args.slice(separator + 1);
  return { scriptName, scriptArgs, code: 0 };
}

function parsePackageSpec(spec: string): { name: string; version?: string } {
  const aliasSeparator = spec.indexOf('@npm:');
  if (aliasSeparator > 0) {
    return { name: spec.slice(0, aliasSeparator), version: spec.slice(aliasSeparator + 1) };
  }
  const separator = spec.lastIndexOf('@');
  if (separator <= spec.lastIndexOf('/')) return { name: spec };
  const name = spec.slice(0, separator);
  const version = spec.slice(separator + 1);
  if (!name || !version) throw new Error(`Invalid package spec '${spec}'`);
  return { name, version };
}

function parseInstallArgs(args: string[]): {
  packages: Array<{ name: string; version?: string }>;
  flags: string[];
  error?: string;
} {
  const packages: Array<{ name: string; version?: string }> = [];
  const flags: string[] = [];
  let version: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '-D' || argument === '--save-dev') {
      flags.push(argument);
      continue;
    }
    if (argument === '--version') {
      const value = args[index + 1];
      if (!value || value.startsWith('-'))
        return { packages, flags, error: '--version requires a value' };
      version = value;
      flags.push(`--version=${value}`);
      index += 1;
      continue;
    }
    if (argument.startsWith('--version=')) {
      version = argument.slice('--version='.length);
      if (!version) return { packages, flags, error: '--version requires a value' };
      flags.push(argument);
      continue;
    }
    if (argument.startsWith('-'))
      return { packages, flags, error: `unsupported option '${argument}'` };
    const request = parsePackageSpec(argument);
    packages.push(request);
  }
  for (const request of packages) {
    if (!request.version) request.version = version;
  }
  if (packages.length === 0 && version)
    return { packages, flags, error: '--version requires a package' };
  return { packages, flags };
}

function flagsForSinglePackage(
  request: { name: string; version?: string } | undefined,
  flags: string[]
): string[] {
  if (!request?.version) return flags;
  const result = flags.filter(flag => !flag.startsWith('--version='));
  result.push(`--version=${request.version}`);
  return result;
}

export default handleNPMCommand;

export async function handleNPXCommand(
  args: string[],
  writeOutput: (output: string | Uint8Array) => Promise<void>,
  processStdin: ProcessStdin,
  subscribeInterrupt?: RuntimeExecutionOptions['subscribeInterrupt'],
  signal?: AbortSignal,
  env?: Record<string, string>,
  outputTTY?: Pick<RuntimeExecutionOptions, 'stdoutIsTTY' | 'stderrIsTTY'>
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
    const absFs = await resolveLocalBinary(binary, cwdFs, fsClient);

    if (!absFs) {
      await writeOutput(`${binary}: command not found`);
      return 127;
    }

    const runtime = runtimeRegistry.getRuntime('nodejs');
    if (!runtime) throw new Error('Node.js runtime provider is unavailable.');
    const fmt = (...values: unknown[]) =>
      writeOutput(values.map(value => String(value)).join(' ') + '\n');
    const result = await runtime.execute({
      rootPath,
      filePath: absFs,
      cwd: cwdFs,
      env,
      argv: binArgs,
      subscribeInterrupt,
      signal,
      debugConsole: { log: fmt, error: fmt, warn: fmt, clear: () => {} },
      processStdin,
      ...outputTTY,
      onStdout: output => writeOutput(output),
      onStderr: output => writeOutput(output),
    });
    if (result.stderr) await writeOutput(result.stderr);
    return result.exitCode ?? 0;
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) message = error.message;
    await writeOutput(`${message}\n`);
    return 1;
  }
}
