/**
 * __EXTENSION_NAME__
 * __EXTENSION_DESCRIPTION__
 */

import type { CommandContext, ExtensionActivation, ExtensionContext } from '../_shared/types';

async function myCommand(args: string[], context: CommandContext): Promise<string> {
  if (args.length === 0) {
    return 'Usage: mycommand <argument>';
  }

  const argument = args[0];
  let output = `Command executed with argument: ${argument}\n`;
  output += `Project: ${context.projectName}\n`;
  output += `Current Directory: ${context.currentDirectory}\n`;

  try {
    const workspaceEntries = await context.fsClient.walk(context.rootPath);
    const workspaceFiles = workspaceEntries.filter(entry => entry.type === 'file');
    const currentDirectoryEntries = await context.fsClient.readdir(context.currentDirectory);
    const currentDirectoryFiles = currentDirectoryEntries.filter(entry => entry.type === 'file');

    output += `\nTotal files in workspace: ${workspaceFiles.length}\n`;
    output += `Files in current directory: ${currentDirectoryFiles.length}\n`;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return `${output}\nError accessing workspace files: ${error.message}\n`;
  }

  return output;
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('__EXTENSION_NAME__ activating...');
  context.commands.registerCommand('mycommand', myCommand);
  context.logger.info('Registered command: mycommand');
  context.logger.info('__EXTENSION_NAME__ activated');

  return {};
}

export async function deactivate(): Promise<void> {
  console.log('__EXTENSION_NAME__ deactivated');
}
