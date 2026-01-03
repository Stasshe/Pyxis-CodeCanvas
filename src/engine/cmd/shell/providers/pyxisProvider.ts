/**
 * Pyxis Command Provider
 * Provides pyxis-specific commands (export, import, settings, etc.)
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
 * Pyxis Command Provider Implementation
 */
export class PyxisCommandProvider implements CommandProvider {
  readonly id = 'pyxis.provider.pyxis';
  readonly type = ProviderType.DOMAIN;
  readonly priority = 450; // Higher priority than external commands
  readonly cacheTTL = -1; // Infinite cache - pyxis command is static

  private projectId: string = '';
  private projectName: string = '';

  async canHandle(command: string, _context: IExecutionContext): Promise<boolean> {
    return command === 'pyxis';
  }

  async initialize(projectId: string, context: IExecutionContext): Promise<void> {
    this.projectId = projectId;
    this.projectName = context.projectName;
  }

  async execute(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      await streams.writeStderr('pyxis: missing subcommand\n');
      await streams.writeStderr('Usage: pyxis <category> <action> [args]\n');
      return { exitCode: 1 };
    }

    const category = args[0];
    const action = args[1];

    if (!action && !category.startsWith('-')) {
      await streams.writeStderr('pyxis: missing action\n');
      await streams.writeStderr('Usage: pyxis <category> <action> [args]\n');
      return { exitCode: 1 };
    }

    // Determine command name and sub-arguments
    let cmdToCall: string;
    let subArgs: string[];

    if (action && action.startsWith('-')) {
      // Action looks like a flag: `pyxis export --indexeddb`
      cmdToCall = category;
      subArgs = args.slice(1);
    } else if (action) {
      // Normal form: `pyxis export zip`
      cmdToCall = `${category}-${action}`;
      subArgs = args.slice(2);
    } else {
      cmdToCall = category;
      subArgs = args.slice(1);
    }

    try {
      const { handlePyxisCommand } = await import('../../handlers/pyxisHandler');

      const writeOutput = async (output: string) => {
        await streams.writeStdout(output);
        if (!output.endsWith('\n')) {
          await streams.writeStdout('\n');
        }
      };

      await handlePyxisCommand(
        cmdToCall,
        subArgs,
        context.projectName,
        context.projectId,
        writeOutput
      );

      return { exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await streams.writeStderr(`pyxis: ${message}\n`);
      return { exitCode: 1 };
    }
  }

  async complete(partial: string, _context: IExecutionContext): Promise<CompletionResult[]> {
    const categories = [
      'export',
      'import',
      'settings',
      'extension',
      'project',
      'help',
    ];

    const actions: Record<string, string[]> = {
      export: ['zip', 'json', 'indexeddb'],
      import: ['zip', 'json'],
      settings: ['show', 'reset'],
      extension: ['list', 'enable', 'disable'],
      project: ['info', 'list'],
    };

    // If partial is empty, return categories
    if (!partial) {
      return categories.map(cat => ({
        text: cat,
        type: 'command' as const,
        description: `pyxis ${cat}`,
      }));
    }

    // If partial contains space, complete action
    if (partial.includes(' ')) {
      const [cat, actionPartial] = partial.split(' ');
      const catActions = actions[cat] || [];
      return catActions
        .filter(a => a.startsWith(actionPartial || ''))
        .map(a => ({
          text: a,
          type: 'option' as const,
          description: `pyxis ${cat} ${a}`,
        }));
    }

    // Complete category
    return categories
      .filter(cat => cat.startsWith(partial))
      .map(cat => ({
        text: cat,
        type: 'command' as const,
        description: `pyxis ${cat}`,
      }));
  }

  async getHelp(_command: string): Promise<string> {
    return `pyxis - Pyxis IDE control commands
Usage: pyxis <category> <action> [args]

Categories:
  export     Export project data
    zip      Export as ZIP file
    json     Export as JSON
    indexeddb Export IndexedDB data

  import     Import project data
    zip      Import from ZIP file
    json     Import from JSON

  settings   Manage settings
    show     Show current settings
    reset    Reset to defaults

  extension  Manage extensions
    list     List installed extensions
    enable   Enable an extension
    disable  Disable an extension

  project    Project operations
    info     Show project information
    list     List all projects

  help       Show this help message`;
  }

  async dispose(): Promise<void> {
    // Nothing to dispose
  }
}

/**
 * Create a new pyxis command provider
 */
export function createPyxisProvider(): PyxisCommandProvider {
  return new PyxisCommandProvider();
}
