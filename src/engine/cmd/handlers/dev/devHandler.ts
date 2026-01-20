/**
 * Development/Testing Command Handler
 *
 * Main entry point for the \`dev\` command.
 * Routes subcommands to specialized handlers.
 *
 * Usage:
 *   dev merge-conflict create  - Create a merge conflict scenario
 *   dev help                   - Show available commands
 */

import type { DevCommandContext, DevCommandInfo } from './types';

// Subcommand imports
import { mergeConflictCommands } from './mergeConflictScenario';
import { tabCommands } from './tabScenario';

/**
 * Development Command Registry
 */
class DevCommandRegistry {
  private commands: Map<string, DevCommandInfo> = new Map();

  /**
   * Register a command
   */
  register(info: DevCommandInfo): void {
    this.commands.set(info.name, info);
  }

  /**
   * Register multiple commands at once
   */
  registerAll(infos: DevCommandInfo[]): void {
    for (const info of infos) {
      this.register(info);
    }
  }

  /**
   * Get a command by name
   */
  get(name: string): DevCommandInfo | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all commands
   */
  getAll(): DevCommandInfo[] {
    return Array.from(this.commands.values());
  }

  /**
   * Check if a command exists
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }
}

export const devCommandRegistry = new DevCommandRegistry();

// Register commands
devCommandRegistry.registerAll(mergeConflictCommands);
devCommandRegistry.registerAll(tabCommands);

/**
 * Help command
 */
async function showHelp(context: DevCommandContext): Promise<void> {
  const commands = devCommandRegistry.getAll();

  await context.writeOutput('=== Pyxis Development Commands ===\n');
  await context.writeOutput('Usage: dev <command> [options]\n');
  await context.writeOutput('\nAvailable commands:\n');

  for (const cmd of commands) {
    await context.writeOutput(\`  \${cmd.name.padEnd(25)} \${cmd.description}\`);
  }

  await context.writeOutput('\nFor detailed usage of a command:');
  await context.writeOutput('  dev <command> --help\n');
}

/**
 * Main handler
 */
export async function handleDevCommand(
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>
): Promise<void> {
  const context: DevCommandContext = {
    projectName,
    projectId,
    writeOutput,
  };

  // Show help if no arguments or help flag
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    await showHelp(context);
    return;
  }

  const subCommand = args[0];
  const subArgs = args.slice(1);

  // Find command
  const commandInfo = devCommandRegistry.get(subCommand);

  if (!commandInfo) {
    await writeOutput(\`dev: unknown command '\${subCommand}'\`);
    await writeOutput('Run "dev help" to see available commands.');
    return;
  }

  // Handle --help option
  if (subArgs.includes('--help') || subArgs.includes('-h')) {
    await writeOutput(\`\${commandInfo.name}: \${commandInfo.description}\n\`);
    await writeOutput(\`Usage: \${commandInfo.usage}\`);
    return;
  }

  // Execute command
  try {
    await commandInfo.handler(subArgs, context);
  } catch (error) {
    await writeOutput(\`dev \${subCommand}: \${(error as Error).message}\`);
  }
}
