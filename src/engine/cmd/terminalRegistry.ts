import type { FsApi } from '@/engine/core/fs';
import type { CommandRegistry } from '@/engine/extensions/commandRegistry';
import { GitCommands } from './global/git';
import type { NpmCommands } from './global/npm';
import { UnixCommands } from './global/unix';
import type StreamShell from './shell/streamShell';
import type TerminalUI from './terminalUI';

type ProjectEntry = {
  unix?: UnixCommands;
  git?: GitCommands;
  npm?: NpmCommands;
  shell?: StreamShell;
  terminalUI?: TerminalUI; // TerminalUI instance per-project
  createdAt: number;
};

type ShellOptions = {
  unix?: UnixCommands;
  commandRegistry?: Pick<
    CommandRegistry,
    'hasCommand' | 'executeCommand' | 'getRegisteredCommands'
  >;
  fsClient?: FsApi;
  terminalColumns?: number;
  terminalRows?: number;
  env?: Record<string, string>;
};

/**
 * TerminalCommandRegistry
 * - Provides per-project singleton instances of command classes (Git/Unix/Npm)
 * - Keeps lifecycle management (disposeProject / clearAll)
 * - Instances are created lazily on first request
 */
class TerminalCommandRegistry {
  private projects = new Map<string, ProjectEntry>();
  private npmCommandsModulePromise: Promise<typeof import('./global/npm')> | null = null;

  private getOrCreateEntry(rootPath: string): ProjectEntry {
    let entry = this.projects.get(rootPath);
    if (!entry) {
      entry = { createdAt: Date.now() };
      this.projects.set(rootPath, entry);
    }
    return entry;
  }

  /**
   * Register a TerminalUI instance for a project and propagate it to existing command instances
   */
  setTerminalUI(rootPath: string, ui: TerminalUI): void {
    const entry = this.getOrCreateEntry(rootPath);
    entry.terminalUI = ui;

    // Propagate to existing instances immediately
    if (entry.git) entry.git.setTerminalUI(ui);
    if (entry.npm) entry.npm.setTerminalUI(ui);
    if (entry.unix) entry.unix.setTerminalUI(ui);
  }

  /**
   * Retrieve the TerminalUI instance for a project (may be undefined)
   */
  getTerminalUI(rootPath: string): TerminalUI | undefined {
    return this.projects.get(rootPath)?.terminalUI;
  }

  getUnixCommands(rootPath: string): UnixCommands {
    const entry = this.getOrCreateEntry(rootPath);
    if (!entry.unix) {
      // Construct UnixCommands using the existing constructor signature
      entry.unix = new UnixCommands(rootPath);
      if (entry.terminalUI) entry.unix.setTerminalUI(entry.terminalUI);
    }
    return entry.unix;
  }

  getGitCommands(rootPath: string): GitCommands {
    const entry = this.getOrCreateEntry(rootPath);
    if (!entry.git) {
      entry.git = new GitCommands(rootPath);
      if (entry.terminalUI) entry.git.setTerminalUI(entry.terminalUI);
    }
    return entry.git;
  }

  private async loadNpmCommandsModule(): Promise<typeof import('./global/npm')> {
    if (!this.npmCommandsModulePromise) {
      this.npmCommandsModulePromise = import('./global/npm');
    }

    return this.npmCommandsModulePromise;
  }

  async getNpmCommands(rootPath: string): Promise<NpmCommands> {
    const entry = this.getOrCreateEntry(rootPath);
    if (!entry.npm) {
      const { NpmCommands } = await this.loadNpmCommandsModule();
      entry.npm = new NpmCommands(rootPath);
      if (entry.terminalUI) entry.npm.setTerminalUI(entry.terminalUI);
    }
    return entry.npm;
  }

  // Return or lazily construct a StreamShell instance for the project.
  async getShell(rootPath: string, opts?: ShellOptions): Promise<StreamShell> {
    const entry = this.getOrCreateEntry(rootPath);
    if (entry.shell) return entry.shell;
    const { default: StreamShell } = await import('./shell/streamShell');
    const unix = opts?.unix ?? this.getUnixCommands(rootPath);
    entry.shell = new StreamShell({
      rootPath,
      unix,
      fsClient: opts?.fsClient,
      commandRegistry: opts?.commandRegistry,
      terminalColumns: opts?.terminalColumns,
      terminalRows: opts?.terminalRows,
      env: opts?.env,
      terminalUI: entry.terminalUI,
    });
    return entry.shell;
  }

  async replaceShell(
    rootPath: string,
    expectedShell: StreamShell,
    opts?: ShellOptions
  ): Promise<StreamShell | undefined> {
    const entry = this.projects.get(rootPath);
    if (!entry) return undefined;
    if (entry.shell !== expectedShell) return entry.shell;

    entry.shell = undefined;
    await expectedShell.dispose();
    if (this.projects.get(rootPath) !== entry) return undefined;
    return this.getShell(rootPath, opts);
  }

  /**
   * Update terminal size for a project's shell
   */
  updateShellSize(rootPath: string, columns: number, rows: number): void {
    const entry = this.projects.get(rootPath);
    if (entry?.shell) {
      entry.shell.setTerminalSize(columns, rows);
    }
  }

  /**
   * Dispose and remove all command instances for a project
   */
  async disposeProject(rootPath: string): Promise<void> {
    const entry = this.projects.get(rootPath);
    if (!entry) return;

    try {
      await entry.shell?.dispose();
    } catch (e) {
      console.warn('[terminalRegistry] dispose shell failed', e);
    }
    try {
      await entry.terminalUI?.dispose();
    } catch (e) {
      console.warn('[terminalRegistry] dispose terminal UI failed', e);
    }

    this.projects.delete(rootPath);
  }

  /**
   * Clear all cached instances (useful for tests)
   */
  async clearAll(): Promise<void> {
    const keys = Array.from(this.projects.keys());
    for (const k of keys) {
      await this.disposeProject(k);
    }
    this.projects.clear();
  }
}

export const terminalCommandRegistry = new TerminalCommandRegistry();

export default terminalCommandRegistry;
