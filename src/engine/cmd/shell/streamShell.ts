/**
 * StreamShell - Backward compatible wrapper for ShellExecutor
 *
 * This is a compatibility layer that wraps the new provider-based ShellExecutor
 * while maintaining the existing StreamShell API for backward compatibility.
 */

import type { fileRepository } from '@/engine/core/fileRepository';
import type { UnixCommands } from '../global/unix';
import type TerminalUI from '@/engine/cmd/terminalUI';
import {
  type OutputCallbacks,
  type ShellExecutor,
  type ShellExecutorOptions,
  type ShellRunResult,
  createShellExecutor,
} from './executor';
import { type ProcExit, Process } from './process';

// Re-export for backward compatibility
export { Process, type ProcExit } from './process';

/**
 * Shell Options (backward compatible)
 */
export interface ShellOptions {
  projectName: string;
  projectId: string;
  unix: UnixCommands;
  fileRepository?: typeof fileRepository | any; // Allow mock file repositories
  commandRegistry?: any;
  terminalColumns?: number;
  terminalRows?: number;
  terminalUI?: TerminalUI; // Optional TerminalUI instance
}

/**
 * StreamShell - Backward compatible shell interface
 *
 * Delegates all operations to the new ShellExecutor while maintaining
 * the existing public API for backward compatibility.
 */
export class StreamShell {
  private executor: ShellExecutor;
  private _terminalColumns: number;
  private _terminalRows: number;

  constructor(opts: ShellOptions) {
    // Create executor with options
    const execOpts: ShellExecutorOptions = {
      projectName: opts.projectName,
      projectId: opts.projectId,
      unix: opts.unix,
      fileRepository: opts.fileRepository,
      commandRegistry: opts.commandRegistry,
      terminalColumns: opts.terminalColumns ?? 80,
      terminalRows: opts.terminalRows ?? 24,
      terminalUI: opts.terminalUI,
      isInteractive: true,
    };

    this.executor = createShellExecutor(execOpts);
    this._terminalColumns = opts.terminalColumns ?? 80;
    this._terminalRows = opts.terminalRows ?? 24;
  }

  /**
   * Update terminal size (call on resize)
   */
  setTerminalSize(columns: number, rows: number): void {
    this._terminalColumns = columns;
    this._terminalRows = rows;
    this.executor.setTerminalSize(columns, rows);
  }

  get terminalColumns(): number {
    return this._terminalColumns;
  }

  get terminalRows(): number {
    return this._terminalRows;
  }

  /**
   * Run a command line
   *
   * @param line - Command line to execute
   * @param onData - Optional callbacks for real-time output
   * @returns Promise with stdout, stderr, and exit code
   */
  async run(
    line: string,
    onData?: {
      stdout?: (data: string) => void;
      stderr?: (data: string) => void;
    }
  ): Promise<ShellRunResult> {
    const callbacks: OutputCallbacks | undefined = onData
      ? {
          stdout: onData.stdout,
          stderr: onData.stderr,
        }
      : undefined;

    return this.executor.run(line, callbacks);
  }

  /**
   * Kill the current foreground process with given signal
   */
  killForeground(signal = 'SIGINT'): void {
    this.executor.killForeground(signal);
  }

  /**
   * Set an alias
   */
  setAlias(name: string, expansion: string): void {
    this.executor.setAlias(name, expansion);
  }

  /**
   * Get an alias
   */
  getAlias(name: string): string | undefined {
    return this.executor.getAlias(name);
  }

  /**
   * Set an environment variable
   */
  setEnv(key: string, value: string): void {
    this.executor.setEnv(key, value);
  }

  /**
   * Get an environment variable
   */
  getEnv(key: string): string | undefined {
    return this.executor.getEnv(key);
  }

  /**
   * Get the underlying executor (for advanced usage)
   */
  getExecutor(): ShellExecutor {
    return this.executor;
  }
}

export default StreamShell;
