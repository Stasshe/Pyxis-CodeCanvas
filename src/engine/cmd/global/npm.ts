import * as Comlink from 'comlink';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import type { TerminalUI } from '@/engine/cmd/terminalUI';
import { resolvePath } from '@/engine/core/fs';
import { fsClient } from '@/engine/core/fs/client';
import type { WorkerNpmCommands } from './npmOperations/worker';

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
    return this.withLoading(async () => {
      const ui = this.terminalUI;
      let target = 'dependencies';
      if (packageName) target = packageName;
      if (ui) await ui.spinner.start(`reify: resolving ${target}...`);
      try {
        const service = await this.servicePromise;
        const progress = async (name: string, version: string): Promise<void> => {
          if (!ui) return;
          await ui.spinner.update(
            `reify:${name}@${version}: timing reifyNode:node_modules/${name} (${version})`
          );
        };
        const output = await service.install(packageName, flags, Comlink.proxy(progress));
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
    try {
      const packagePath = resolvePath(this.rootPath, 'package.json');
      if (!(await fsClient.exists(packagePath))) return 'npm ERR! Cannot find package.json';
      const packageJson = JSON.parse(await fsClient.readText(packagePath)) as PackageJson;
      const command = packageJson.scripts?.[scriptName];
      if (!command) {
        const scripts = packageJson.scripts ?? {};
        let output = `npm ERR! script '${scriptName}' not found\n`;
        const names = Object.keys(scripts);
        if (names.length > 0) {
          output += '\nAvailable scripts:\n';
          for (const name of names) output += `  ${name}: ${scripts[name]}\n`;
        }
        return output;
      }
      const shell = await terminalCommandRegistry.getShell(this.rootPath, { fsClient });
      const result = await shell.run(command);
      const output = [`> ${this.projectName}@${packageJson.version} ${scriptName}`, `> ${command}`];
      if (result.stdout) output.push(result.stdout);
      if (result.stderr) output.push(result.stderr);
      if (result.code === 0 || result.code === null)
        output.push(`Script '${scriptName}' completed successfully.`);
      else output.push(`Script '${scriptName}' exited with code ${result.code}.`);
      return output.join('\n');
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      throw new Error(`npm run failed: ${message}`);
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
