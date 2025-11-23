import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';

export async function handleGitCommand(
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>
) {
  if (!args[0]) {
    await writeOutput('git: missing command');
    return;
  }

  const git = terminalCommandRegistry.getGitCommands(projectName, projectId);
  const gitCmd = args[0];

  switch (gitCmd) {
    case 'fetch': {
      const remote = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      const branch = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
      try {
        const fetchResult = await git.fetch({ remote, branch });
        await writeOutput(fetchResult);
      } catch (error) {
        const msg = (error as Error).message || '';
        await writeOutput(`git fetch: ${msg}`);
      }
      break;
    }

    case 'pull': {
      const remote = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      const branch = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
      try {
        const pullResult = await git.pull({ remote, branch });
        await writeOutput(pullResult);
      } catch (error) {
        await writeOutput(`git pull: ${(error as Error).message}`);
      }
      break;
    }

    case 'init':
      await writeOutput(
        `git init: Command not available from terminal\nプロジェクトの初期化は左下の「プロジェクト管理」ボタンから\n新規プロジェクトを作成してください。\n新規プロジェクトには自動でGitリポジトリが設定されます。`
      );
      break;

    case 'clone':
      if (args[1]) {
        const url = args[1].trim();
        const targetDir = args[2]?.trim();
        if (
          !url.startsWith('http://') &&
          !url.startsWith('https://') &&
          !url.startsWith('git://')
        ) {
          await writeOutput(
            'git clone: invalid repository URL (must start with http://, https://, or git://)'
          );
          break;
        }

        try {
          await writeOutput(`Cloning repository ${url}...`);
          const cloneResult = await git.clone(url, targetDir, { skipDotGit: true });
          await writeOutput(cloneResult);
          if (!targetDir) {
            await writeOutput(
              `Note: No target directory specified. Repository was cloned into a subdirectory named after the repository.\nTo clone directly into a project root (like via Project manager), use the Project modal which clones into the project root.`
            );
          }
        } catch (error) {
          const errorMessage = (error as Error).message || String(error);
          if (errorMessage.includes('CORS') || errorMessage.includes('fetch')) {
            await writeOutput(`git clone: network/CORS error: ${errorMessage}`);
          } else {
            await writeOutput(`git clone: ${errorMessage}`);
          }
        }
      } else {
        await writeOutput(
          'git clone: missing repository URL\nUsage: git clone <repository-url> [directory]'
        );
      }
      break;

    case 'status':
      try {
        const statusResult = await git.status();
        await writeOutput(statusResult);
      } catch (e) {
        await writeOutput(`git status: ${(e as Error).message}`);
      }
      break;

    case 'add':
      if (args[1]) {
        const addResult = await git.add(args[1]);
        await writeOutput(addResult);
      } else {
        await writeOutput('git add: missing file argument');
      }
      break;

    case 'commit': {
      const messageIndex = args.indexOf('-m');
      if (messageIndex !== -1 && args[messageIndex + 1]) {
        const message = args
          .slice(messageIndex + 1)
          .join(' ')
          .replace(/['\"]/g, '');
        const commitResult = await git.commit(message);
        await writeOutput(commitResult);
      } else {
        await writeOutput('git commit: missing -m flag and message');
      }
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
            await writeOutput('git checkout: missing branch name after -b');
            break;
          }
        } else {
          branchName = args[1];
        }

        if (/^[\\w-]+\//.test(branchName)) {
          // remote branch like origin/main -> use checkoutRemote helper which handles fetch/resolve
          try {
            const result = await git.checkoutRemote(branchName.replace(/^refs\/remotes\//, ''));
            await writeOutput(result);
          } catch (error) {
            await writeOutput(`git checkout: ${(error as Error).message}`);
          }
        } else {
          const checkoutResult = await git.checkout(branchName, createNew);
          await writeOutput(checkoutResult);
        }
      } else {
        await writeOutput('git checkout: missing branch name');
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
            await writeOutput('git switch: missing branch name after -c/--create');
            break;
          }
        } else {
          targetRef = args[1];
        }

        try {
          const switchResult = await git.switch(targetRef, {
            createNew,
            detach,
          });
          await writeOutput(switchResult);
        } catch (error) {
          await writeOutput(`git switch: ${(error as Error).message}`);
        }
      } else {
        await writeOutput('git switch: missing branch name or commit hash');
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
        await writeOutput('git revert: missing commit hash');
      }
      break;

    case 'reset': {
      if (args.includes('--hard') && args[args.indexOf('--hard') + 1]) {
        const commitHash = args[args.indexOf('--hard') + 1];
        try {
          const resetResult = await git.reset({ hard: true, commit: commitHash });
          await writeOutput(resetResult);
        } catch (error) {
          await writeOutput(`git reset: ${(error as Error).message}`);
        }
      } else if (args[1]) {
        const resetResult = await git.reset({ filepath: args[1] });
        await writeOutput(resetResult);
      } else {
        const resetResult = await git.reset();
        await writeOutput(resetResult);
      }
      break;
    }

    case 'diff': {
      const diffArgs = args.filter(arg => arg !== 'diff');
      if (diffArgs.includes('--staged') || diffArgs.includes('--cached')) {
        const filepath = diffArgs.find(arg => !arg.startsWith('--'));
        const diffResult = await git.diff({ staged: true, filepath });
        await writeOutput(diffResult);
      } else if (diffArgs.length === 1 && !diffArgs[0].startsWith('-')) {
        const branchName = diffArgs[0];
        const diffResult = await git.diff({ branchName });
        await writeOutput(diffResult);
      } else if (
        diffArgs.length >= 2 &&
        !diffArgs[0].startsWith('-') &&
        !diffArgs[1].startsWith('-')
      ) {
        const filepath = diffArgs[2];
        const diffResult = await git.diff({ commit1: diffArgs[0], commit2: diffArgs[1], filepath });
        await writeOutput(diffResult);
      } else {
        const filepath = diffArgs.find(arg => !arg.startsWith('-'));
        const diffResult = await git.diff({ filepath });
        await writeOutput(diffResult);
      }
      break;
    }

    case 'merge':
      if (args.includes('--abort')) {
        const mergeAbortResult = await git.merge('', { abort: true });
        await writeOutput(mergeAbortResult);
      } else if (args[1]) {
        const branchName = args[1];
        const noFf = args.includes('--no-ff');
        let message: string | undefined;
        const messageIndex = args.indexOf('-m');
        if (messageIndex !== -1 && args[messageIndex + 1]) {
          message = args
            .slice(messageIndex + 1)
            .join(' ')
            .replace(/['\"]/g, '');
        }
        const mergeResult = await git.merge(branchName, { noFf, message });
        await writeOutput(mergeResult);
      } else {
        await writeOutput('git merge: missing branch name');
      }
      break;

    case 'push': {
      const remote = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      const branch = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
      const force = args.includes('--force') || args.includes('-f');

      try {
        const pushResult = await git.push({ remote, branch, force });
        await writeOutput(pushResult);

        let usedBranch = branch;
        if (!usedBranch && typeof pushResult === 'string') {
          const match = pushResult.match(/\s([\w\-]+) -> [\w\-]+/);
          if (match && match[1]) usedBranch = match[1];
        }
        if (usedBranch) {
          const fetchResult = await git.fetch({ remote: 'origin', branch: usedBranch });
          await writeOutput(`(auto) git fetch origin ${usedBranch}\n${fetchResult}`);
          const resetResult = await git.reset({ hard: true, commit: `origin/${usedBranch}` });
          await writeOutput(`(auto) git reset --hard origin/${usedBranch}\n${resetResult}`);
        }
      } catch (error) {
        const msg = (error as Error).message || '';
        await writeOutput(`git push: ${msg}`);
      }
      break;
    }

    case 'remote': {
      if (args[1] === 'add' && args[2] && args[3]) {
        try {
          const addResult = await git.addRemote(args[2], args[3]);
          await writeOutput(addResult);
        } catch (error) {
          await writeOutput(`git remote add: ${(error as Error).message}`);
        }
      } else if (args[1] === 'remove' && args[2]) {
        try {
          const removeResult = await git.deleteRemote(args[2]);
          await writeOutput(removeResult);
        } catch (error) {
          await writeOutput(`git remote remove: ${(error as Error).message}`);
        }
      } else if (args[1] === '-v' || !args[1]) {
        try {
          const listResult = await git.listRemotes();
          await writeOutput(listResult);
        } catch (error) {
          await writeOutput(`git remote: ${(error as Error).message}`);
        }
      } else {
        await writeOutput(
          'git remote: invalid command\nUsage: git remote [-v] | git remote add <name> <url> | git remote remove <name>'
        );
      }
      break;
    }

    case 'show': {
      const showArgs = args.slice(1);
      if (showArgs.length === 0) {
        await writeOutput('git show: missing commit or file');
      } else {
        try {
          const showResult = await git.show(showArgs);
          await writeOutput(showResult);
        } catch (error) {
          await writeOutput(`git show: ${(error as Error).message}`);
        }
      }
      break;
    }

    default:
      await writeOutput(`git: '${gitCmd}' is not a git command`);
      break;
  }
}

export default handleGitCommand;
