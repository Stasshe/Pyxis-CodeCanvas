/**
 * NPM Command Provider
 * Provides npm command execution through the existing NpmCommands implementation.
 */

import type {
  CommandProvider,
  CompletionResult,
  ExecutionResult,
  IExecutionContext,
  IStreamManager,
} from './types';
import { ProviderType } from './types';

/**
 * NPM Command Provider Implementation
 */
export class NpmCommandProvider implements CommandProvider {
  readonly id = 'pyxis.provider.npm';
  readonly type = ProviderType.DOMAIN;
  readonly priority = 500;
  readonly cacheTTL = -1; // Infinite cache - npm command is static

  private npmCommands: any = null;
  private projectId: string = '';
  private projectName: string = '';

  async canHandle(command: string, _context: IExecutionContext): Promise<boolean> {
    return command === 'npm';
  }

  getSupportedCommands(): string[] {
    return ['npm'];
  }

  async initialize(projectId: string, context: IExecutionContext): Promise<void> {
    this.projectId = projectId;
    this.projectName = context.projectName;

    try {
      const { terminalCommandRegistry } = await import('../../terminalRegistry');
      this.npmCommands = terminalCommandRegistry.getNpmCommands(
        this.projectName,
        this.projectId,
        context.cwd
      );
    } catch (e) {
      console.error('[NpmProvider] Failed to initialize:', e);
    }
  }

  async execute(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (!this.npmCommands) {
      await this.initialize(context.projectId, context);
    }

    if (!this.npmCommands) {
      await streams.writeStderr('npm: npm commands not initialized\n');
      return { exitCode: 1 };
    }

    if (args.length === 0) {
      await streams.writeStderr('npm: missing command\n');
      await streams.writeStderr('Usage: npm <command>\n');
      return { exitCode: 1 };
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);

    try {
      const result = await this.executeSubcommand(subcommand, subArgs, context, streams);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await streams.writeStderr(`npm: ${message}\n`);
      return { exitCode: 1 };
    }
  }

  private async executeSubcommand(
    subcommand: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    const writeOutput = async (output: string) => {
      await streams.writeStdout(output);
      if (!output.endsWith('\n')) {
        await streams.writeStdout('\n');
      }
    };

    switch (subcommand) {
      case 'init': {
        const useDefault = args.includes('-y') || args.includes('--yes');
        const result = await this.npmCommands.init({ useDefault });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'install':
      case 'i': {
        const packages = args.filter(a => !a.startsWith('-'));
        const saveDev = args.includes('-D') || args.includes('--save-dev');
        const global = args.includes('-g') || args.includes('--global');

        if (packages.length === 0) {
          // Install all dependencies from package.json
          const result = await this.npmCommands.install();
          await writeOutput(result);
        } else {
          // Install specific packages
          const result = await this.npmCommands.install(packages, { saveDev, global });
          await writeOutput(result);
        }
        return { exitCode: 0 };
      }

      case 'uninstall':
      case 'un':
      case 'remove':
      case 'rm': {
        if (args.length === 0) {
          await streams.writeStderr('npm uninstall: missing package name\n');
          return { exitCode: 1 };
        }
        const packages = args.filter(a => !a.startsWith('-'));
        const result = await this.npmCommands.uninstall(packages);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'run': {
        if (args.length === 0) {
          // List available scripts
          const result = await this.npmCommands.listScripts();
          await writeOutput(result);
          return { exitCode: 0 };
        }
        const scriptName = args[0];
        const scriptArgs = args.slice(1);
        const result = await this.npmCommands.runScript(scriptName, scriptArgs);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'start': {
        const result = await this.npmCommands.runScript('start', args);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'test': {
        const result = await this.npmCommands.runScript('test', args);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'build': {
        const result = await this.npmCommands.runScript('build', args);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'ls':
      case 'list': {
        const depth = args.find(a => a.startsWith('--depth='))?.split('=')[1];
        const global = args.includes('-g') || args.includes('--global');
        const result = await this.npmCommands.list({ depth: depth ? Number(depth) : undefined, global });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'outdated': {
        const result = await this.npmCommands.outdated();
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'update':
      case 'up': {
        const packages = args.filter(a => !a.startsWith('-'));
        const result = await this.npmCommands.update(packages.length > 0 ? packages : undefined);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'search': {
        if (args.length === 0) {
          await streams.writeStderr('npm search: missing search term\n');
          return { exitCode: 1 };
        }
        const result = await this.npmCommands.search(args.join(' '));
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'info':
      case 'view':
      case 'show': {
        if (args.length === 0) {
          await streams.writeStderr('npm info: missing package name\n');
          return { exitCode: 1 };
        }
        const result = await this.npmCommands.info(args[0]);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'version': {
        if (args.length === 0) {
          const result = await this.npmCommands.version();
          await writeOutput(result);
        } else {
          const newVersion = args[0];
          const result = await this.npmCommands.version(newVersion);
          await writeOutput(result);
        }
        return { exitCode: 0 };
      }

      case 'pack': {
        const result = await this.npmCommands.pack();
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'audit': {
        const fix = args.includes('fix');
        const result = await this.npmCommands.audit(fix);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'cache': {
        if (args[0] === 'clean' || args.includes('--force')) {
          const result = await this.npmCommands.cacheClean();
          await writeOutput(result);
        } else {
          await streams.writeStderr('npm cache: use "npm cache clean --force"\n');
          return { exitCode: 1 };
        }
        return { exitCode: 0 };
      }

      case 'config': {
        if (args[0] === 'list' || args.length === 0) {
          const result = await this.npmCommands.configList();
          await writeOutput(result);
        } else if (args[0] === 'get' && args[1]) {
          const result = await this.npmCommands.configGet(args[1]);
          await writeOutput(result);
        } else if (args[0] === 'set' && args[1]) {
          const value = args.slice(2).join(' ');
          const result = await this.npmCommands.configSet(args[1], value);
          await writeOutput(result);
        } else {
          await streams.writeStderr('npm config: invalid usage\n');
          return { exitCode: 1 };
        }
        return { exitCode: 0 };
      }

      case 'help': {
        const helpText = await this.getHelp('npm');
        await writeOutput(helpText);
        return { exitCode: 0 };
      }

      default:
        await streams.writeStderr(`npm: '${subcommand}' is not a npm command\n`);
        await streams.writeStderr('Run "npm help" for available commands\n');
        return { exitCode: 1 };
    }
  }

  async complete(partial: string, _context: IExecutionContext): Promise<CompletionResult[]> {
    const subcommands = [
      'init', 'install', 'i', 'uninstall', 'un', 'remove', 'rm',
      'run', 'start', 'test', 'build', 'ls', 'list', 'outdated',
      'update', 'up', 'search', 'info', 'view', 'show', 'version',
      'pack', 'audit', 'cache', 'config', 'help',
    ];

    return subcommands
      .filter(cmd => cmd.startsWith(partial))
      .map(cmd => ({
        text: cmd,
        type: 'command' as const,
        description: `npm ${cmd}`,
      }));
  }

  async getHelp(_command: string): Promise<string> {
    return `npm - Node Package Manager
Usage: npm <command> [options]

Commands:
  init [-y]              Create package.json
  install [packages]     Install packages
  uninstall <packages>   Remove packages
  run <script>           Run npm script
  start                  Run start script
  test                   Run test script
  build                  Run build script
  ls                     List installed packages
  outdated               Check for outdated packages
  update [packages]      Update packages
  search <term>          Search npm registry
  info <package>         Show package information
  version [version]      Show or bump version
  pack                   Create tarball
  audit [fix]            Security audit
  cache clean --force    Clear cache
  config                 Manage npm configuration
  help                   Show this help`;
  }

  async dispose(): Promise<void> {
    this.npmCommands = null;
  }
}

/**
 * Create a new npm command provider
 */
export function createNpmProvider(): NpmCommandProvider {
  return new NpmCommandProvider();
}
