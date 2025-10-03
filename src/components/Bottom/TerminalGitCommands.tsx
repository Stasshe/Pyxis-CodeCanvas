// TerminalGitCommands.tsx
// Terminalのgitコマンド処理部分を分割
// ...original Terminal.tsx から git コマンド処理部分を移植して実装してください。

import type { GitCommands } from '@/engine/core/filesystem';

export async function handleGitCommand(
  args: string[],
  gitCommandsRef: React.RefObject<GitCommands | null>,
  writeOutput: (output: string) => Promise<void>
) {
  if (!gitCommandsRef.current || !args[0]) {
    await writeOutput('git: missing command');
    return;
  }
  const gitCmd = args[0];
  switch (gitCmd) {
    case 'fetch': {
      // git fetch [remote] [branch]
      const remote = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      const branch = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
      try {
        const fetchResult = await gitCommandsRef.current.fetch({ remote, branch });
        await writeOutput(fetchResult);
      } catch (error) {
        const msg = (error as Error).message || '';
        // fetchは空リポジトリでも内部でハンドリングされるので、それ以外のエラーのみ表示
        await writeOutput(`git fetch: ${msg}`);
      }
      break;
    }

    case 'pull': {
      // git pull [remote] [branch]
      const remote = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      const branch = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
      try {
        const pullResult = await gitCommandsRef.current.pull({ remote, branch });
        await writeOutput(pullResult);
      } catch (error) {
        await writeOutput(`git pull: ${(error as Error).message}`);
      }
      break;
    }
    case 'init':
      const initMessage = `git init: Command not available from terminal
プロジェクトの初期化は左下の「プロジェクト管理」ボタンから
新規プロジェクトを作成してください。
新規プロジェクトには自動でGitリポジトリが設定されます。`;
      await writeOutput(initMessage);
      break;

    case 'clone':
      if (args[1]) {
        const url = args[1].trim();
        const targetDir = args[2]?.trim(); // オプションのターゲットディレクトリ

        // URLの基本的な妥当性チェック
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
          const cloneResult = await gitCommandsRef.current.clone(url, targetDir);
          await writeOutput(cloneResult);
        } catch (error) {
          const errorMessage = (error as Error).message;
          // ネットワークエラーやCORSエラーの場合は、より分かりやすいメッセージを表示
          if (errorMessage.includes('CORS') || errorMessage.includes('fetch')) {
            await writeOutput(
              `git clone: Failed to clone repository. This may be due to CORS restrictions or network issues.\nTry using a repository that supports CORS or is hosted on a platform that allows cross-origin requests.`
            );
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
      const statusResult = await gitCommandsRef.current.status();
      await writeOutput(statusResult);
      break;

    case 'add':
      if (args[1]) {
        const addResult = await gitCommandsRef.current.add(args[1]);
        await writeOutput(addResult);
      } else {
        await writeOutput('git add: missing file argument');
      }
      break;

    case 'commit':
      const messageIndex = args.indexOf('-m');
      if (messageIndex !== -1 && args[messageIndex + 1]) {
        const message = args
          .slice(messageIndex + 1)
          .join(' ')
          .replace(/['"]/g, '');
        const commitResult = await gitCommandsRef.current.commit(message);
        await writeOutput(commitResult);
      } else {
        await writeOutput('git commit: missing -m flag and message');
      }
      break;

    case 'log':
      const logResult = await gitCommandsRef.current.log();
      await writeOutput(logResult);
      break;

    case 'checkout': {
      if (args[1]) {
        const createNew = args.includes('-b');
        let branchName: string;

        if (createNew) {
          // -bフラグがある場合、-bの次の引数がブランチ名
          const bIndex = args.indexOf('-b');
          branchName = args[bIndex + 1];
          if (!branchName) {
            await writeOutput('git checkout: option requires an argument -- b');
            break;
          }
        } else {
          branchName = args[1];
        }

        // origin/xxx の場合はリモートブランチとして扱う
        if (/^[\w-]+\//.test(branchName)) {
          // 例: git checkout origin/main
          try {
            const result = await gitCommandsRef.current.checkoutRemote(branchName);
            await writeOutput(result);
          } catch (error) {
            await writeOutput(`git checkout: ${(error as Error).message}`);
          }
        } else {
          const checkoutResult = await gitCommandsRef.current.checkout(branchName, createNew);
          await writeOutput(checkoutResult);
        }
      } else {
        await writeOutput('git checkout: missing branch name');
      }
      break;
    }

    case 'branch': {
      const deleteFlag = args.includes('-d') || args.includes('-D');
      const remoteFlag = args.includes('-r');
      const allFlag = args.includes('-a');
      // -r/-a 以外で - で始まらない最初の引数をブランチ名とみなす
      const branchName = args.find(arg => !arg.startsWith('-') && arg !== 'branch');

      // ブランチ名が明示的に指定されている場合のみ作成/削除
      if (branchName && branchName.trim() !== '') {
        const branchResult = await gitCommandsRef.current.branch(branchName, { delete: deleteFlag });
        await writeOutput(branchResult);
      } else {
        // -r/-aのみ、または引数なしの場合は一覧表示
        const branchResult = await gitCommandsRef.current.branch(undefined, {
          remote: remoteFlag,
          all: allFlag,
        });
        await writeOutput(branchResult);
      }
      break;
    }

    case 'revert':
      if (args[1]) {
        const revertResult = await gitCommandsRef.current.revert(args[1]);
        await writeOutput(revertResult);
      } else {
        await writeOutput('git revert: missing commit hash');
      }
      break;

    case 'reset': {
      if (args.includes('--hard') && args[args.indexOf('--hard') + 1]) {
        // git reset --hard <commit>
        const commitHash = args[args.indexOf('--hard') + 1];
        // origin/xxx の場合もOK
        try {
          const resetResult = await gitCommandsRef.current.reset({
            hard: true,
            commit: commitHash,
          });
          await writeOutput(resetResult);
        } catch (error) {
          await writeOutput(`git reset: ${(error as Error).message}`);
        }
      } else if (args[1]) {
        // git reset <filepath>
        const resetResult = await gitCommandsRef.current.reset({
          filepath: args[1],
        });
        await writeOutput(resetResult);
      } else {
        // git reset (全ファイルをアンステージング)
        const resetResult = await gitCommandsRef.current.reset();
        await writeOutput(resetResult);
      }
      break;
    }

    case 'diff':
      console.log('git diff args:', args);

      // argsから'diff'を除外してdiffArgsを作成
      const diffArgs = args.filter(arg => arg !== 'diff');
      console.log('filtered diff args:', diffArgs);

      if (diffArgs.includes('--staged') || diffArgs.includes('--cached')) {
        // git diff --staged [filepath]
        const filepath = diffArgs.find(arg => !arg.startsWith('--'));
        console.log('Staged diff for filepath:', filepath);
        const diffResult = await gitCommandsRef.current.diff({
          staged: true,
          filepath,
        });
        await writeOutput(diffResult);
      } else if (diffArgs.length === 1 && !diffArgs[0].startsWith('-')) {
        // git diff <branch> の場合
        const branchName = diffArgs[0];
        const diffResult = await gitCommandsRef.current.diff({ branchName });
        await writeOutput(diffResult);
      } else if (
        diffArgs.length >= 2 &&
        !diffArgs[0].startsWith('-') &&
        !diffArgs[1].startsWith('-')
      ) {
        // git diff <commit1> <commit2> [filepath]
        console.log('Commit diff:', diffArgs[0], 'vs', diffArgs[1]);
        const filepath = diffArgs[2]; // 3番目の引数がファイルパス（オプション）
        const diffResult = await gitCommandsRef.current.diff({
          commit1: diffArgs[0],
          commit2: diffArgs[1],
          filepath,
        });
        await writeOutput(diffResult);
      } else {
        // git diff [filepath] - ワーキングディレクトリの変更
        const filepath = diffArgs.find(arg => !arg.startsWith('-'));
        console.log('Working directory diff for filepath:', filepath);
        const diffResult = await gitCommandsRef.current.diff({ filepath });
        await writeOutput(diffResult);
      }
      break;

    case 'merge':
      if (args.includes('--abort')) {
        // git merge --abort
        const mergeAbortResult = await gitCommandsRef.current.merge('', {
          abort: true,
        });
        await writeOutput(mergeAbortResult);
      } else if (args[1]) {
        // git merge <branch> [--no-ff] [-m "message"]
        const branchName = args[1];
        const noFf = args.includes('--no-ff');
        let message: string | undefined;

        // -m フラグでメッセージを指定
        const messageIndex = args.indexOf('-m');
        if (messageIndex !== -1 && args[messageIndex + 1]) {
          message = args
            .slice(messageIndex + 1)
            .join(' ')
            .replace(/['"]/g, '');
        }

        const mergeResult = await gitCommandsRef.current.merge(branchName, {
          noFf,
          message,
        });
        await writeOutput(mergeResult);
      } else {
        await writeOutput('git merge: missing branch name');
      }
      break;

    case 'push': {
      // git push [remote] [branch] [--force]
      const remote = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      const branch = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
      const force = args.includes('--force') || args.includes('-f');

      try {
        const pushResult = await gitCommandsRef.current.push({
          remote,
          branch,
          force,
        });
        await writeOutput(pushResult);
      } catch (error) {
        const msg = (error as Error).message || '';
        await writeOutput(`git push: ${msg}`);
      }
      break;
    }

    case 'remote':
      // git remote add/remove/list
      if (args[1] === 'add' && args[2] && args[3]) {
        // git remote add <name> <url>
        try {
          const addResult = await gitCommandsRef.current.addRemote(args[2], args[3]);
          await writeOutput(addResult);
        } catch (error) {
          await writeOutput(`git remote add: ${(error as Error).message}`);
        }
      } else if (args[1] === 'remove' && args[2]) {
        // git remote remove <name>
        try {
          const removeResult = await gitCommandsRef.current.deleteRemote(args[2]);
          await writeOutput(removeResult);
        } catch (error) {
          await writeOutput(`git remote remove: ${(error as Error).message}`);
        }
      } else if (args[1] === '-v' || !args[1]) {
        // git remote [-v]
        try {
          const listResult = await gitCommandsRef.current.listRemotes();
          await writeOutput(listResult);
        } catch (error) {
          await writeOutput(`git remote: ${(error as Error).message}`);
        }
      } else {
        await writeOutput('git remote: invalid command\nUsage: git remote [-v] | git remote add <name> <url> | git remote remove <name>');
      }
      break;

    default:
      await writeOutput(`git: '${gitCmd}' is not a git command`);
      break;
  }
}
