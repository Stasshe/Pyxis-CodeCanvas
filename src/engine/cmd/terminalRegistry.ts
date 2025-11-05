/**
 * terminalRegistry
 *
 * シングルトンで Unix/Git/Npm コマンドインスタンスをプロジェクト単位で管理する
 */
import { UnixCommands } from './unix';
import { GitCommands } from './git';
import { NpmCommands } from './npm';

type Key = string;

const makeKey = (projectName: string, projectId?: string) => `${projectName}::${projectId || ''}`;

class TerminalRegistry {
  private unixMap = new Map<Key, UnixCommands>();
  private gitMap = new Map<Key, GitCommands>();
  private npmMap = new Map<Key, NpmCommands>();

  getUnixCommands(projectName: string, projectId?: string): UnixCommands {
    const key = makeKey(projectName, projectId);
    if (!this.unixMap.has(key)) {
      this.unixMap.set(key, new UnixCommands(projectName, projectId));
    }
    return this.unixMap.get(key)!;
  }

  getGitCommands(projectName: string, projectId?: string): GitCommands {
    const key = makeKey(projectName, projectId);
    if (!this.gitMap.has(key)) {
      this.gitMap.set(key, new GitCommands(projectName, projectId || ''));
    }
    return this.gitMap.get(key)!;
  }

  getNpmCommands(projectName: string, projectId?: string, projectPath?: string): NpmCommands {
    const key = makeKey(projectName, projectId);
    if (!this.npmMap.has(key)) {
      // NpmCommands signature: (projectName, projectId, projectPath)
      this.npmMap.set(key, new NpmCommands(projectName, projectId || '', projectPath || `/projects/${projectName}`));
    }
    return this.npmMap.get(key)!;
  }
}

export const terminalCommandRegistry = new TerminalRegistry();
