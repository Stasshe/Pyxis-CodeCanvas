/**
 * Types for development/testing commands
 */

/**
 * Development command context
 */
export interface DevCommandContext {
  rootPath: string;
  writeOutput: (output: string) => Promise<void>;
}

/**
 * Development command handler type
 */
export type DevCommandHandler = (args: string[], context: DevCommandContext) => Promise<void>;

/**
 * Development command registration info
 */
export interface DevCommandInfo {
  name: string;
  description: string;
  usage: string;
  handler: DevCommandHandler;
}
