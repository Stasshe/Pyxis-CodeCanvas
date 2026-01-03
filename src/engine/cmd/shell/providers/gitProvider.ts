/**
 * Git Command Provider
 * Provides git command execution through the existing GitCommands implementation.
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
 * Git Command Provider Implementation
 */
export class GitCommandProvider implements CommandProvider {
  readonly id = 'pyxis.provider.git';
  readonly type = ProviderType.DOMAIN;
  readonly priority = 500;
  readonly cacheTTL = -1; // Infinite cache - git command is static

  private gitCommands: any = null;
  private projectId: string = '';
  private projectName: string = '';

  async canHandle(command: string, _context: IExecutionContext): Promise<boolean> {
    return command === 'git';
  }

  getSupportedCommands(): string[] {
    return ['git'];
  }

  async initialize(projectId: string, context: IExecutionContext): Promise<void> {
    this.projectId = projectId;
    this.projectName = context.projectName;

    try {
      const { terminalCommandRegistry } = await import('../../terminalRegistry');
      this.gitCommands = terminalCommandRegistry.getGitCommands(this.projectName, this.projectId);
    } catch (e) {
      console.error('[GitProvider] Failed to initialize:', e);
    }
  }

  async execute(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (!this.gitCommands) {
      await this.initialize(context.projectId, context);
    }

    if (!this.gitCommands) {
      await streams.writeStderr('git: git commands not initialized\n');
      return { exitCode: 1 };
    }

    if (args.length === 0) {
      await streams.writeStderr('git: missing command\n');
      await streams.writeStderr('Usage: git <command> [<args>]\n');
      return { exitCode: 1 };
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);

    try {
      const result = await this.executeSubcommand(subcommand, subArgs, context, streams);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await streams.writeStderr(`git: ${message}\n`);
      return { exitCode: 1 };
    }
  }

  private async executeSubcommand(
    subcommand: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    const writeOutput = async (output: string) => {
      await streams.writeStdout(output);
      if (!output.endsWith('\n')) {
        await streams.writeStdout('\n');
      }
    };

    switch (subcommand) {
      case 'init': {
        const result = await this.gitCommands.init();
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'clone': {
        if (!args[0]) {
          await streams.writeStderr('git clone: missing repository URL\n');
          return { exitCode: 1 };
        }
        const url = args[0];
        const targetDir = args[1];
        const result = await this.gitCommands.clone(url, targetDir, { skipDotGit: true });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'status': {
        const result = await this.gitCommands.status();
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'add': {
        if (!args[0]) {
          await streams.writeStderr('git add: missing file argument\n');
          return { exitCode: 1 };
        }
        const result = await this.gitCommands.add(args[0]);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'commit': {
        const messageIndex = args.indexOf('-m');
        if (messageIndex === -1 || !args[messageIndex + 1]) {
          await streams.writeStderr('git commit: missing -m flag and message\n');
          return { exitCode: 1 };
        }
        const message = args.slice(messageIndex + 1).join(' ').replace(/['\"]/g, '');
        const result = await this.gitCommands.commit(message);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'log': {
        const result = await this.gitCommands.log();
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'diff': {
        const diffOpts: any = {};
        if (args.includes('--staged') || args.includes('--cached')) {
          diffOpts.staged = true;
        }
        const filepath = args.find(a => !a.startsWith('-'));
        if (filepath) diffOpts.filepath = filepath;
        const result = await this.gitCommands.diff(diffOpts);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'branch': {
        const deleteFlag = args.includes('-d') || args.includes('-D');
        const remoteFlag = args.includes('-r');
        const allFlag = args.includes('-a');
        const branchName = args.find(arg => !arg.startsWith('-'));

        const result = await this.gitCommands.branch(branchName, {
          delete: deleteFlag,
          remote: remoteFlag,
          all: allFlag,
        });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'checkout': {
        if (!args[0]) {
          await streams.writeStderr('git checkout: missing branch name\n');
          return { exitCode: 1 };
        }
        const createNew = args.includes('-b');
        let branchName: string;
        if (createNew) {
          const bIndex = args.indexOf('-b');
          branchName = args[bIndex + 1];
        } else {
          branchName = args[0];
        }
        const result = await this.gitCommands.checkout(branchName, createNew);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'switch': {
        if (!args[0]) {
          await streams.writeStderr('git switch: missing branch name\n');
          return { exitCode: 1 };
        }
        const createNew = args.includes('-c') || args.includes('--create');
        const detach = args.includes('--detach');
        let targetRef: string;
        if (createNew) {
          const cIndex = args.indexOf('-c') !== -1 ? args.indexOf('-c') : args.indexOf('--create');
          targetRef = args[cIndex + 1];
        } else {
          targetRef = args[0];
        }
        const result = await this.gitCommands.switch(targetRef, { createNew, detach });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'merge': {
        if (args.includes('--abort')) {
          const result = await this.gitCommands.merge('', { abort: true });
          await writeOutput(result);
          return { exitCode: 0 };
        }
        if (!args[0]) {
          await streams.writeStderr('git merge: missing branch name\n');
          return { exitCode: 1 };
        }
        const noFf = args.includes('--no-ff');
        const messageIndex = args.indexOf('-m');
        let message: string | undefined;
        if (messageIndex !== -1 && args[messageIndex + 1]) {
          message = args.slice(messageIndex + 1).join(' ').replace(/['\"]/g, '');
        }
        const result = await this.gitCommands.merge(args[0], { noFf, message });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'fetch': {
        const remote = args.find(a => !a.startsWith('-'));
        const branch = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
        const result = await this.gitCommands.fetch({ remote, branch });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'pull': {
        const remote = args.find(a => !a.startsWith('-'));
        const branch = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
        const result = await this.gitCommands.pull({ remote, branch });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'push': {
        const remote = args.find(a => !a.startsWith('-'));
        const branch = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
        const force = args.includes('--force') || args.includes('-f');
        const result = await this.gitCommands.push({ remote, branch, force });
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'reset': {
        const hardIndex = args.indexOf('--hard');
        if (hardIndex !== -1 && args[hardIndex + 1]) {
          const commit = args[hardIndex + 1];
          const result = await this.gitCommands.reset({ hard: true, commit });
          await writeOutput(result);
        } else if (args[0] && !args[0].startsWith('--')) {
          const result = await this.gitCommands.reset({ commit: args[0] });
          await writeOutput(result);
        } else {
          const result = await this.gitCommands.reset();
          await writeOutput(result);
        }
        return { exitCode: 0 };
      }

      case 'revert': {
        if (!args[0]) {
          await streams.writeStderr('git revert: missing commit hash\n');
          return { exitCode: 1 };
        }
        const result = await this.gitCommands.revert(args[0]);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      case 'remote': {
        if (args[0] === 'add' && args[1] && args[2]) {
          const result = await this.gitCommands.addRemote(args[1], args[2]);
          await writeOutput(result);
        } else if (args[0] === 'remove' && args[1]) {
          const result = await this.gitCommands.deleteRemote(args[1]);
          await writeOutput(result);
        } else if (args[0] === '-v' || !args[0]) {
          const result = await this.gitCommands.listRemotes();
          await writeOutput(result);
        } else {
          await streams.writeStderr('git remote: invalid command\n');
          return { exitCode: 1 };
        }
        return { exitCode: 0 };
      }

      case 'show': {
        if (args.length === 0) {
          await streams.writeStderr('git show: missing commit or file\n');
          return { exitCode: 1 };
        }
        const result = await this.gitCommands.show(args);
        await writeOutput(result);
        return { exitCode: 0 };
      }

      default:
        await streams.writeStderr(`git: '${subcommand}' is not a git command\n`);
        return { exitCode: 1 };
    }
  }

  async complete(partial: string, _context: IExecutionContext): Promise<CompletionResult[]> {
    const subcommands = [
      'init', 'clone', 'status', 'add', 'commit', 'push', 'pull',
      'fetch', 'branch', 'checkout', 'switch', 'merge', 'log',
      'diff', 'reset', 'revert', 'remote', 'show',
    ];

    return subcommands
      .filter(cmd => cmd.startsWith(partial))
      .map(cmd => ({
        text: cmd,
        type: 'command' as const,
        description: `git ${cmd}`,
      }));
  }

  async getHelp(_command: string): Promise<string> {
    return `git - Version control system
Usage: git <command> [options]

Commands:
  init       Create an empty Git repository
  clone      Clone a repository
  status     Show working tree status
  add        Add file contents to the index
  commit     Record changes to the repository
  push       Update remote refs
  pull       Fetch and integrate with another repository
  fetch      Download objects and refs from another repository
  branch     List, create, or delete branches
  checkout   Switch branches or restore working tree files
  switch     Switch branches
  merge      Join two or more development histories together
  log        Show commit logs
  diff       Show changes between commits
  reset      Reset current HEAD to the specified state
  revert     Revert some existing commits
  remote     Manage set of tracked repositories
  show       Show various types of objects`;
  }

  async dispose(): Promise<void> {
    this.gitCommands = null;
  }
}

/**
 * Create a new git command provider
 */
export function createGitProvider(): GitCommandProvider {
  return new GitCommandProvider();
}
