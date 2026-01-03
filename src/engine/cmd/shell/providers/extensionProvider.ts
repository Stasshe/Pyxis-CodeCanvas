/**
 * Extension Command Provider
 * Wraps the existing CommandRegistry to integrate extension commands with the provider system.
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
 * Extension Command Provider Implementation
 */
export class ExtensionCommandProvider implements CommandProvider {
  readonly id = 'pyxis.provider.extension';
  readonly type = ProviderType.EXTENSION;
  readonly priority = 400;
  readonly cacheTTL = 60000; // 60 seconds cache

  private commandRegistry: any = null;

  constructor(commandRegistry?: any) {
    this.commandRegistry = commandRegistry;
  }

  async canHandle(command: string, _context: IExecutionContext): Promise<boolean> {
    if (!this.commandRegistry) {
      await this.ensureRegistry();
    }

    if (!this.commandRegistry || typeof this.commandRegistry.hasCommand !== 'function') {
      return false;
    }

    return this.commandRegistry.hasCommand(command);
  }

  getSupportedCommands(): string[] {
    if (!this.commandRegistry || typeof this.commandRegistry.getCommands !== 'function') {
      return [];
    }
    return this.commandRegistry.getCommands();
  }

  private async ensureRegistry(): Promise<void> {
    if (this.commandRegistry) return;

    try {
      const { commandRegistry } = await import('../../../extensions/commandRegistry');
      this.commandRegistry = commandRegistry;
    } catch (e) {
      console.warn('[ExtensionProvider] Failed to load commandRegistry:', e);
    }
  }

  async initialize(_projectId: string, _context: IExecutionContext): Promise<void> {
    await this.ensureRegistry();
  }

  async execute(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (!this.commandRegistry) {
      await this.ensureRegistry();
    }

    if (!this.commandRegistry) {
      await streams.writeStderr(`${command}: extension registry not available\n`);
      return { exitCode: 1 };
    }

    try {
      // Build execution context for extension
      const extContext = {
        projectName: context.projectName,
        projectId: context.projectId,
        currentDirectory: context.cwd,
        getSystemModule: context.getSystemModule,
        env: context.env,
        stdin: streams.stdin,
        stdout: streams.stdout,
        stderr: streams.stderr,
      };

      // Execute extension command
      const result = await this.commandRegistry.executeCommand(command, args, extContext);

      // Write result to stdout
      if (result !== undefined && result !== null) {
        const output = typeof result === 'string' ? result : String(result);
        await streams.writeStdout(output);
        if (!output.endsWith('\n')) {
          await streams.writeStdout('\n');
        }
      }

      return { exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await streams.writeStderr(`${command}: ${message}\n`);
      return { exitCode: 1 };
    }
  }

  async complete(partial: string, _context: IExecutionContext): Promise<CompletionResult[]> {
    if (!this.commandRegistry) {
      await this.ensureRegistry();
    }

    if (!this.commandRegistry || typeof this.commandRegistry.getRegisteredCommands !== 'function') {
      return [];
    }

    const commands = this.commandRegistry.getRegisteredCommands() as string[];
    const info = this.commandRegistry.getCommandInfo?.() as Array<{ command: string; extensionId: string }> || [];

    return commands
      .filter(cmd => cmd.startsWith(partial))
      .map(cmd => {
        const cmdInfo = info.find(i => i.command === cmd);
        return {
          text: cmd,
          type: 'command' as const,
          description: cmdInfo ? `Extension: ${cmdInfo.extensionId}` : 'Extension command',
        };
      });
  }

  async getHelp(command: string): Promise<string> {
    if (!this.commandRegistry) {
      await this.ensureRegistry();
    }

    if (!this.commandRegistry || typeof this.commandRegistry.getCommandInfo !== 'function') {
      return `${command}: extension command`;
    }

    const info = this.commandRegistry.getCommandInfo() as Array<{ command: string; extensionId: string }>;
    const cmdInfo = info.find(i => i.command === command);

    if (cmdInfo) {
      return `${command} - Provided by extension: ${cmdInfo.extensionId}`;
    }

    return `${command}: extension command`;
  }

  /**
   * Set the command registry (for dependency injection)
   */
  setCommandRegistry(registry: any): void {
    this.commandRegistry = registry;
  }

  /**
   * Get all registered extension commands
   */
  getRegisteredCommands(): string[] {
    if (!this.commandRegistry || typeof this.commandRegistry.getRegisteredCommands !== 'function') {
      return [];
    }
    return this.commandRegistry.getRegisteredCommands();
  }

  async dispose(): Promise<void> {
    // Extension registry is global, don't dispose it
  }
}

/**
 * Create a new extension command provider
 */
export function createExtensionProvider(commandRegistry?: any): ExtensionCommandProvider {
  return new ExtensionCommandProvider(commandRegistry);
}
