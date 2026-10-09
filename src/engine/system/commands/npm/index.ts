import * as Comlink from 'comlink';
import { fsClient } from '@/engine/core/fs/client';
import { resolvePath } from '@/engine/core/fs/index';
import { UnixCommands } from '@/engine/system/commands/unix/index';
import { ShellExecutor } from '@/engine/system/shell/executor';
import type { ShellExecutionOptions } from '@/engine/system/shell/types';
import type { TerminalUI } from '@/engine/system/terminal/terminalUI';
import type { InstallPackageRequest, WorkerNpmCommands } from '../../npm/worker';
import type { OutputCallbacks } from '../../shell/types';

export class NpmCommands {
  private terminalUI?: TerminalUI;
  private setLoading?: (isLoading: boolean) => void;
  private servicePromise: Promise<Comlink.Remote<WorkerNpmCommands>>;
  private projectName: string;

  constructor(
    private readonly rootPath: string,
    setLoading?: (isLoading: boolean) => void
  ) {
    this.setLoading = setLoading;
    const segments = rootPath.split('/').filter(Boolean);
    this.projectName = segments.at(-1) || 'root';
    this.servicePromise = fsClient.getNpm(rootPath);
  }

  setLoadingHandler(callback: (isLoading: boolean) => void): void {
    this.setLoading = callback;
  }

  setTerminalUI(ui: TerminalUI): void {
    this.terminalUI = ui;
  }

  async downloadAndInstallPackage(packageName: string, version = 'latest'): Promise<void> {
    const service = await this.servicePromise;
    await service.install(packageName, [`--version=${version}`]);
  }

  async removeDirectory(path: string): Promise<void> {
    await fsClient.rm(path, { recursive: true, force: true });
  }

  async install(packageName?: string, flags: string[] = []): Promise<string> {
    const version = flags.find(flag => flag.startsWith('--version='))?.slice('--version='.length);
    const packages: InstallPackageRequest[] = [];
    if (packageName) packages.push({ name: packageName, version });
    return this.installPackages(packages, flags);
  }

  async installPackages(packages: InstallPackageRequest[], flags: string[] = []): Promise<string> {
    return this.withLoading(async () => {
      const ui = this.terminalUI;
      let target = 'dependencies';
      if (packages.length === 1) target = packages[0].name;
      if (packages.length > 1) target = packages.map(request => request.name).join(', ');
      if (ui) await ui.spinner.start(`Installing ${target}...`);
      try {
        const service = await this.servicePromise;
        const progress = async (name: string, version: string): Promise<void> => {
          if (!ui) return;
          await ui.spinner.update(`Installing ${name}@${version}`);
        };
        const output = await service.installPackages(packages, flags, Comlink.proxy(progress));
        if (ui) await ui.spinner.stop();
        return output;
      } catch (error) {
        if (ui) await ui.spinner.stop();
        let message = String(error);
        if (error instanceof Error) message = error.message;
        throw new Error(message);
      }
    });
  }

  async uninstall(packageName: string): Promise<string> {
    return this.withLoading(async () => {
      const ui = this.terminalUI;
      if (ui) await ui.spinner.start(`reify: removing ${packageName}...`);
      try {
        const result = await (await this.servicePromise).uninstall(packageName);
        if (ui) await ui.spinner.stop();
        return result;
      } catch (error) {
        if (ui) await ui.spinner.stop();
        let message = String(error);
        if (error instanceof Error) message = error.message;
        throw new Error(`npm uninstall failed: ${message}`);
      }
    });
  }

  async list(): Promise<string> {
    return (await this.servicePromise).list(this.projectName);
  }

  async init(force = false): Promise<string> {
    return (await this.servicePromise).init(force, this.projectName);
  }

  async run(scriptName: string): Promise<string> {
    const result = await this.runWithStatus(scriptName);
    return [result.stdout, result.stderr].filter(Boolean).join('\n');
  }

  async runWithStatus(
    scriptName: string,
    scriptArgs: string[] = [],
    callbacks?: OutputCallbacks,
    context?: NpmRunContext
  ): Promise<NpmRunResult> {
    try {
      const packagePath = resolvePath(this.rootPath, 'package.json');
      if (!(await fsClient.exists(packagePath))) {
        const error = 'npm ERR! Cannot find package.json\n';
        callbacks?.stderr?.(error);
        return { stdout: '', stderr: error, code: 1 };
      }
      const packageJson = JSON.parse(await fsClient.readText(packagePath)) as PackageJson;
      let command = packageJson.scripts?.[scriptName];
      if (
        !command &&
        scriptName === 'start' &&
        (await fsClient.exists(resolvePath(this.rootPath, 'server.js')))
      )
        command = 'node server.js';
      if (!command) {
        const scripts = packageJson.scripts ?? {};
        let output = `npm ERR! script '${scriptName}' not found\n`;
        const names = Object.keys(scripts);
        if (names.length > 0) {
          output += '\nAvailable scripts:\n';
          for (const name of names) output += `  ${name}: ${scripts[name]}\n`;
        }
        callbacks?.stderr?.(output);
        return { stdout: '', stderr: output, code: 1 };
      }
      let stdout = '';
      let stderr = '';
      const runScript = async (name: string, script: string, args: string[] = []) => {
        const header = [
          `> ${this.projectName}@${packageJson.version ?? '0.0.0'} ${name}`,
          `> ${script}`,
          '',
          '',
        ].join('\n');
        stdout += header;
        callbacks?.stdout?.(header);
        let commandLine = script;
        if (args.length > 0) commandLine += ` ${args.map(quoteShellArgument).join(' ')}`;
        const cwd = context?.cwd ?? this.rootPath;
        const unix = new UnixCommands(this.rootPath, fsClient);
        unix.setCurrentDir(cwd);
        const shell = new ShellExecutor({
          rootPath: this.rootPath,
          cwd,
          env: context?.env,
          signal: context?.signal,
          terminalColumns: context?.terminalColumns,
          terminalRows: context?.terminalRows,
          fsClient,
          unix,
          isInteractive: false,
        });
        const unsubscribe = context?.onSignal(signal => shell.killForeground(signal));
        try {
          const result = await shell.run(commandLine, callbacks, context);
          stdout += result.stdout;
          stderr += result.stderr;
          return result.code ?? 1;
        } finally {
          unsubscribe?.();
          shell.dispose();
        }
      };

      const preScript = packageJson.scripts?.[`pre${scriptName}`];
      if (preScript) {
        const code = await runScript(`pre${scriptName}`, preScript);
        if (code !== 0) return { stdout, stderr, code };
      }
      const code = await runScript(scriptName, command, scriptArgs);
      if (code !== 0) return { stdout, stderr, code };
      const postScript = packageJson.scripts?.[`post${scriptName}`];
      if (postScript) {
        const postCode = await runScript(`post${scriptName}`, postScript);
        if (postCode !== 0) return { stdout, stderr, code: postCode };
      }
      return { stdout, stderr, code: 0 };
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      const stderr = `npm run failed: ${message}\n`;
      callbacks?.stderr?.(stderr);
      return { stdout: '', stderr, code: 1 };
    }
  }

  private async withLoading(operation: () => Promise<string>): Promise<string> {
    if (!this.terminalUI) this.setLoading?.(true);
    try {
      return await operation();
    } finally {
      if (!this.terminalUI) this.setLoading?.(false);
    }
  }
}

interface PackageJson {
  version?: string;
  scripts?: Record<string, string>;
}

export interface NpmRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface NpmRunContext extends ShellExecutionOptions {
  cwd: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  onSignal: (fn: (signal: string) => void) => () => void;
  terminalColumns: number;
  terminalRows: number;
}

function quoteShellArgument(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`;
}
