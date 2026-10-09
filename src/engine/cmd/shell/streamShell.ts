import type { OutputCallbacks, ShellExecutor, ShellRunResult } from './executor';
import { createShellExecutor } from './factory';
import type { ShellOptions } from './types';

export { type ProcExit, Process } from './process';
export type { ShellOptions } from './types';

export class StreamShell {
  private executor: ShellExecutor;

  constructor(options: ShellOptions) {
    this.executor = createShellExecutor({ ...options, isInteractive: true });
  }

  setTerminalSize(columns: number, rows: number): void {
    this.executor.setTerminalSize(columns, rows);
  }

  get terminalColumns(): number {
    return this.executor.terminalColumns;
  }

  get terminalRows(): number {
    return this.executor.terminalRows;
  }

  async run(line: string, callbacks?: OutputCallbacks): Promise<ShellRunResult> {
    return this.executor.run(line, callbacks);
  }

  async runInSubshell(line: string): Promise<ShellRunResult> {
    return this.executor.runInSubshell(line);
  }

  async expandWords(source: string, callbacks?: OutputCallbacks): Promise<string[]> {
    return this.executor.expandWords(source, callbacks);
  }

  async getCommandNames(): Promise<string[]> {
    return this.executor.getCommandNames();
  }

  killForeground(signal = 'SIGINT'): void {
    this.executor.killForeground(signal);
  }

  setEnv(key: string, value: string): void {
    this.executor.setEnv(key, value);
  }

  getEnv(key: string): string | undefined {
    return this.executor.getEnv(key);
  }

  getEnvironment(): Readonly<Record<string, string>> {
    return this.executor.getEnvironment();
  }

  unsetEnv(key: string): void {
    this.executor.unsetEnv(key);
  }

  setPipefail(enabled: boolean): void {
    this.executor.setPipefail(enabled);
  }

  setNounset(enabled: boolean): void {
    this.executor.setNounset(enabled);
  }

  getExecutor(): ShellExecutor {
    return this.executor;
  }

  dispose(): void {
    this.executor.dispose();
  }
}

export default StreamShell;
