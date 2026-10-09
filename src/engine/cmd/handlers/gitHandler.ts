import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import type { FsApi } from '@/engine/core/fs';
import { repositoryPath } from '@/engine/core/fs/git';
import { normalizePath, resolvePath } from '@/engine/core/pathUtils';
import { findGitRepositoryRoot } from '../global/gitOperations/repositoryRoot';

function repositoryPathFromCwd(gitRoot: string, cwd: string, path: string): string {
  return repositoryPath(gitRoot, resolvePath(cwd, path));
}

async function runGitCommand(
  args: string[],
  cwd: string,
  fsClient: FsApi,
  writeOutput: (output: string | Uint8Array) => Promise<void>
) {
  if (!args[0]) {
    throw new Error('missing command');
  }

  const gitCmd = args[0];
  let gitRoot = normalizePath(cwd);
  if (gitCmd !== 'init' && gitCmd !== 'clone') {
    gitRoot = (await findGitRepositoryRoot(cwd, fsClient)) ?? gitRoot;
  }
  const git = terminalCommandRegistry.getGitCommands(gitRoot);

  function getGitUsage(cmd?: string) {
    const general = `usage: git <command> [<args>]

Commands:
  clone <url> [dir]      Clone a repository
  status                 Show the working tree status
  add <file>             Add file contents to the index
  commit -m <msg>        Record changes to the repository
  push [remote] [branch] Push commits to remote
  pull [remote] [branch] Fetch and merge from remote
  branch [name]          List or create branches
  checkout <branch>      Switch branches or restore working tree files
  log                    Show commit logs
  diff [options]         Show changes
  reset [--hard <c>]     Reset current HEAD
  merge <branch>         Join two development histories
  revert <commit>        Revert a commit
  remote [--v]           Manage set of tracked repositories
  show <commit|file>     Show various types of objects
`;
    if (!cmd) return general;

    switch (cmd) {
      case 'clone':
        return 'usage: git clone <repository-url> [directory]\nClone a repository into a new directory.';
      case 'status':
        return 'usage: git status\nShow the working tree status.';
      case 'fetch':
        return 'usage: git fetch [<remote>] [<branch>] [--prune|-p] [--depth <n>]\n       git fetch --all [-p|--prune]\nDownload objects and refs from a remote repository. Use --all to fetch from all remotes (same as native git).';
      case 'pull':
        return 'usage: git pull [<remote>] [<branch>]\nFetch from and integrate with another repository or a local branch.';
      case 'init':
        return 'usage: git init\nCreate an empty Git repository or reinitialize an existing one.';
      case 'add':
        return 'usage: git add <pathspec>\nAdd file contents to the index.';
      case 'commit':
        return 'usage: git commit -m <message>\nRecord changes to the repository.';
      case 'log':
        return 'usage: git log\nShow commit logs.';
      case 'checkout':
        return 'usage: git checkout [-b <new-branch>] <branch>\nSwitch branches or restore working tree files.';
      case 'switch':
        return 'usage: git switch [-c|--create] <branch>\nSwitch branches (experimental).';
      case 'branch':
        return 'usage: git branch [-d|-D] [name]\nList, create, or delete branches.';
      case 'revert':
        return 'usage: git revert <commit>\nCreate a new commit that undoes the changes of an earlier commit.';
      case 'reset':
        return 'usage: git reset [--hard <commit>|<file>]\nReset current HEAD to the specified state.';
      case 'diff':
        return 'usage: git diff [--staged|<commit> [<commit>]] [<file>]\nShow changes between commits, commit and working tree, etc.';
      case 'merge':
        return 'usage: git merge [--no-ff] <branch>\nJoin two development histories together.';
      case 'push':
        return 'usage: git push [<remote>] [<branch>] [--force]\nUpdate remote refs along with associated objects.';
      case 'remote':
        return 'usage: git remote [-v] | git remote add <name> <url> | git remote remove <name>\nManage set of tracked repositories.';
      case 'show':
        return 'usage: git show <object>\nShow various types of objects.';
      default:
        return general;
    }
  }

  // Handle top-level `git help` or subcommand --help/-h
  if (gitCmd === 'help') {
    const sub = args[1];
    await writeOutput(getGitUsage(sub));
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    await writeOutput(getGitUsage(gitCmd));
    return;
  }

  switch (gitCmd) {
    case 'fetch': {
      const fetchResult = await git.fetch(args.slice(1));
      await writeOutput(fetchResult);
      break;
    }

    case 'pull': {
      const pullArgs = args.slice(1);
      const rebase = pullArgs.includes('--rebase');
      const positional = pullArgs.filter(argument => {
        if (!argument.startsWith('-')) return true;
        if (argument === '--rebase') return false;
        throw new Error(`unknown option '${argument}'`);
      });
      if (positional.length > 2) {
        throw new Error('too many arguments. Usage: git pull [<remote>] [<branch>]');
      }
      const [remote, branch] = positional;
      const pullResult = await git.pull({ remote, branch, rebase });
      await writeOutput(pullResult);
      break;
    }

    case 'init': {
      const initResult = await git.init();
      await writeOutput(initResult);
      break;
    }

    case 'clone':
      if (args[1]) {
        const url = args[1].trim();
        const targetDir = args[2]?.trim();
        if (
          !url.startsWith('http://') &&
          !url.startsWith('https://') &&
          !url.startsWith('git://')
        ) {
          throw new Error('invalid repository URL (must start with http://, https://, or git://)');
        }

        try {
          await writeOutput(`Cloning repository ${url}...`);
          const cloneResult = await git.clone(url, targetDir);
          await writeOutput(cloneResult);
          if (!targetDir) {
            await writeOutput(
              'Note: No target directory specified. Repository was cloned into a subdirectory named after the repository.'
            );
          }
        } catch (error) {
          const errorMessage = (error as Error).message || String(error);
          if (errorMessage.includes('CORS') || errorMessage.includes('fetch')) {
            throw new Error(`network/CORS error: ${errorMessage}`);
          }
          throw error;
        }
      } else {
        throw new Error('missing repository URL. Usage: git clone <repository-url> [directory]');
      }
      break;

    case 'status': {
      const statusResult = await git.status();
      await writeOutput(statusResult);
      break;
    }

    case 'add':
      if (args[1]) {
        const pathspec = repositoryPathFromCwd(gitRoot, cwd, args[1]);
        const addResult = await git.add(pathspec);
        await writeOutput(addResult);
      } else {
        throw new Error('missing file argument');
      }
      break;

    case 'commit': {
      if (args[1] !== '-m') {
        if (args[1]?.startsWith('-')) throw new Error(`unknown option '${args[1]}'`);
        throw new Error('missing -m flag and message');
      }

      if (args.length < 3) throw new Error('missing message after -m');
      if (args.length > 3) {
        const extraArgument = args[3];
        if (extraArgument.startsWith('-')) throw new Error(`unknown option '${extraArgument}'`);
        throw new Error(`unexpected argument '${extraArgument}'. Usage: git commit -m <message>`);
      }

      const commitResult = await git.commit(args[2]);
      await writeOutput(commitResult);
      break;
    }

    case 'log': {
      const logResult = await git.log();
      await writeOutput(logResult);
      break;
    }

    case 'checkout': {
      if (args[1]) {
        const createNew = args.includes('-b');
        let branchName: string;
        if (createNew) {
          const bIndex = args.indexOf('-b');
          branchName = args[bIndex + 1];
          if (!branchName) {
            throw new Error('missing branch name after -b');
          }
        } else {
          branchName = args[1];
        }

        let remoteBranch = branchName.startsWith('refs/remotes/');
        if (!createNew && !remoteBranch && branchName.includes('/')) {
          const branches = await git.getAvailableBranches();
          remoteBranch =
            !branches.local.includes(branchName) && branches.remote.includes(branchName);
        }
        if (!createNew && remoteBranch) {
          // remote branch like origin/main -> use checkoutRemote helper which handles fetch/resolve
          const result = await git.checkoutRemote(branchName.replace(/^refs\/remotes\//, ''));
          await writeOutput(result);
        } else {
          const checkoutResult = await git.checkout(branchName, createNew);
          await writeOutput(checkoutResult);
        }
      } else {
        throw new Error('missing branch name');
      }
      break;
    }

    case 'switch': {
      if (args[1]) {
        const createNew = args.includes('-c') || args.includes('--create');
        const detach = args.includes('--detach');
        let targetRef: string;

        if (createNew) {
          const cIndex = args.indexOf('-c') !== -1 ? args.indexOf('-c') : args.indexOf('--create');
          targetRef = args[cIndex + 1];
          if (!targetRef) {
            throw new Error('missing branch name after -c/--create');
          }
        } else {
          targetRef = args[1];
        }

        const switchResult = await git.switch(targetRef, {
          createNew,
          detach,
        });
        await writeOutput(switchResult);
      } else {
        throw new Error('missing branch name or commit hash');
      }
      break;
    }

    case 'branch': {
      const deleteFlag = args.includes('-d') || args.includes('-D');
      const remoteFlag = args.includes('-r');
      const allFlag = args.includes('-a');
      const branchName = args.find(arg => !arg.startsWith('-') && arg !== 'branch');

      if (branchName && branchName.trim() !== '') {
        const branchResult = await git.branch(branchName, { delete: deleteFlag });
        await writeOutput(branchResult);
      } else {
        const branchResult = await git.branch(undefined, { remote: remoteFlag, all: allFlag });
        await writeOutput(branchResult);
      }
      break;
    }

    case 'revert':
      if (args[1]) {
        const revertResult = await git.revert(args[1]);
        await writeOutput(revertResult);
      } else {
        throw new Error('missing commit hash');
      }
      break;

    case 'reset': {
      if (args.includes('--hard')) {
        const commitHash = args[args.indexOf('--hard') + 1];
        const resetResult = await git.reset({ hard: true, commit: commitHash });
        await writeOutput(resetResult);
      } else if (args[1]) {
        // Check if args[1] looks like a file path or a commit reference
        // Try to parse as commit first, fall back to filepath if it fails
        const arg = args[1];

        // Skip if it's a flag
        if (arg.startsWith('--')) {
          const resetResult = await git.reset();
          await writeOutput(resetResult);
        } else {
          // Try as commit reference first
          try {
            const resetResult = await git.reset({ commit: arg });
            await writeOutput(resetResult);
          } catch (commitError) {
            // If commit fails, try as filepath
            try {
              const filepath = repositoryPathFromCwd(gitRoot, cwd, arg);
              const resetResult = await git.reset({ filepath });
              await writeOutput(resetResult);
            } catch (fileError) {
              throw new Error(
                `unable to resolve '${arg}' as either a commit reference or filepath\nCommit error: ${(commitError as Error).message}\nFile error: ${(fileError as Error).message}`
              );
            }
          }
        }
      } else {
        const resetResult = await git.reset();
        await writeOutput(resetResult);
      }
      break;
    }

    case 'diff': {
      const diffArgs = args.filter(arg => arg !== 'diff');
      if (diffArgs.includes('--staged') || diffArgs.includes('--cached')) {
        const pathArg = diffArgs.find(arg => !arg.startsWith('--'));
        const filepath = pathArg ? repositoryPathFromCwd(gitRoot, cwd, pathArg) : undefined;
        const diffResult = await git.diff({ staged: true, filepath });
        await writeOutput(diffResult);
      } else if (diffArgs.length === 1 && !diffArgs[0].startsWith('-')) {
        const value = diffArgs[0];
        const branches = await git.getAvailableBranches();
        const diffResult = branches.local.includes(value)
          ? await git.diff({ branchName: value })
          : await git.diff({ filepath: repositoryPathFromCwd(gitRoot, cwd, value) });
        await writeOutput(diffResult);
      } else if (
        diffArgs.length >= 2 &&
        !diffArgs[0].startsWith('-') &&
        !diffArgs[1].startsWith('-')
      ) {
        const pathArg = diffArgs[2];
        const filepath = pathArg ? repositoryPathFromCwd(gitRoot, cwd, pathArg) : undefined;
        const diffResult = await git.diff({ commit1: diffArgs[0], commit2: diffArgs[1], filepath });
        await writeOutput(diffResult);
      } else {
        const pathArg = diffArgs.find(arg => !arg.startsWith('-'));
        const filepath = pathArg ? repositoryPathFromCwd(gitRoot, cwd, pathArg) : undefined;
        const diffResult = await git.diff({ filepath });
        await writeOutput(diffResult);
      }
      break;
    }

    case 'merge': {
      if (args.includes('--abort')) {
        const mergeAbortResult = await git.merge('', { abort: true });
        await writeOutput(mergeAbortResult);
      } else {
        let branchName: string | undefined;
        let message: string | undefined;
        let noFf = false;

        for (let index = 1; index < args.length; index += 1) {
          const argument = args[index];
          if (argument === '--no-ff') {
            noFf = true;
          } else if (argument === '-m') {
            const value = args[index + 1];
            if (!value || value.startsWith('-')) {
              throw new Error('missing message after -m');
            }
            if (message !== undefined) {
              throw new Error('multiple -m messages are not supported');
            }
            message = value;
            index += 1;
          } else if (argument.startsWith('-')) {
            throw new Error(`unknown option '${argument}'`);
          } else if (branchName === undefined) {
            branchName = argument;
          } else {
            throw new Error(
              `unexpected argument '${argument}'. Usage: git merge [--no-ff] [-m <message>] <branch>`
            );
          }
        }

        if (!branchName) throw new Error('missing branch name');
        const mergeResult = await git.merge(branchName, { noFf, message });
        await writeOutput(mergeResult);
      }
      break;
    }

    case 'push': {
      const positional = args.slice(1).filter(argument => !argument.startsWith('-'));
      const [remote, branch] = positional;
      const force = args.includes('--force') || args.includes('-f');

      const pushResult = await git.push({ remote, branch, force });
      await writeOutput(pushResult);
      break;
    }

    case 'remote': {
      if (args[1] === 'add' && args[2] && args[3]) {
        const addResult = await git.addRemote(args[2], args[3]);
        await writeOutput(addResult);
      } else if (args[1] === 'remove' && args[2]) {
        const removeResult = await git.deleteRemote(args[2]);
        await writeOutput(removeResult);
      } else if (args[1] === '-v' || !args[1]) {
        const listResult = await git.listRemotes();
        await writeOutput(listResult);
      } else {
        throw new Error(
          'invalid command. Usage: git remote [-v] | git remote add <name> <url> | git remote remove <name>'
        );
      }
      break;
    }

    case 'show': {
      const showArgs = args.slice(1);
      if (showArgs.length === 0) {
        throw new Error('missing commit or file');
      }
      const colonIndex = showArgs[0].indexOf(':');
      if (colonIndex !== -1) {
        const commit = showArgs[0].slice(0, colonIndex);
        const path = showArgs[0].slice(colonIndex + 1);
        if (path) showArgs[0] = `${commit}:${repositoryPathFromCwd(gitRoot, cwd, path)}`;
      }
      const showResult = await git.show(showArgs);
      await writeOutput(showResult);
      break;
    }

    default:
      throw new Error(`'${gitCmd}' is not a git command`);
  }
}

export async function handleGitCommand(
  args: string[],
  cwd: string,
  fsClient: FsApi,
  writeOutput: (output: string | Uint8Array) => Promise<void>
): Promise<void> {
  const command = args[0] || 'git';
  try {
    await runGitCommand(args, cwd, fsClient, writeOutput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const context = command === 'git' ? 'git' : `git ${command}`;
    const contextualMessage = message.startsWith(context) ? message : `${context}: ${message}`;
    throw new Error(contextualMessage, { cause: error });
  }
}

export default handleGitCommand;
