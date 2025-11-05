
import { UnixCommands } from './global/unix';
import { GitCommands } from './global/git';
import { NpmCommands } from './global/npm';

type ProjectEntry = {
  unix?: UnixCommands;
  git?: GitCommands;
  npm?: NpmCommands;
  createdAt: number;
};

/**
 * TerminalCommandRegistry
 * - Provides per-project singleton instances of command classes (Git/Unix/Npm)
 * - Keeps lifecycle management (disposeProject / clearAll)
 * - Instances are created lazily on first request
 */
class TerminalCommandRegistry {
  private projects = new Map<string, ProjectEntry>();

  private getOrCreateEntry(projectId: string): ProjectEntry {
    let entry = this.projects.get(projectId);
    if (!entry) {
      entry = { createdAt: Date.now() } as ProjectEntry;
      this.projects.set(projectId, entry);
    }
    return entry;
  }

  getUnixCommands(projectName: string, projectId: string): UnixCommands {
    const entry = this.getOrCreateEntry(projectId);
    if (!entry.unix) {
      // Construct UnixCommands using the existing constructor signature
      entry.unix = new UnixCommands(projectName, projectId);
    }
    return entry.unix!;
  }

  getGitCommands(projectName: string, projectId: string): GitCommands {
    const entry = this.getOrCreateEntry(projectId);
    if (!entry.git) {
      entry.git = new GitCommands(projectName, projectId);
    }
    return entry.git!;
  }

  getNpmCommands(projectName: string, projectId: string, currentDir = '/'): NpmCommands {
    const entry = this.getOrCreateEntry(projectId);
    if (!entry.npm) {
      entry.npm = new NpmCommands(projectName, projectId, currentDir);
    }
    return entry.npm!;
  }

  /**
   * Dispose and remove all command instances for a project
   */
  async disposeProject(projectId: string): Promise<void> {
    const entry = this.projects.get(projectId);
    if (!entry) return;

    // Call dispose if provided on each command
    try {
      if (entry.git && typeof (entry.git as any).dispose === 'function') {
        await (entry.git as any).dispose();
      }
    } catch (e) {
      console.warn('[terminalRegistry] dispose git failed', e);
    }
    try {
      if (entry.unix && typeof (entry.unix as any).dispose === 'function') {
        await (entry.unix as any).dispose();
      }
    } catch (e) {
      console.warn('[terminalRegistry] dispose unix failed', e);
    }
    try {
      if (entry.npm && typeof (entry.npm as any).dispose === 'function') {
        await (entry.npm as any).dispose();
      }
    } catch (e) {
      console.warn('[terminalRegistry] dispose npm failed', e);
    }

    this.projects.delete(projectId);
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
