// TerminalGitCommands.tsx
// Terminalのgitコマンド処理部分を分割
// ...original Terminal.tsx から git コマンド処理部分を移植して実装してください。

import type { GitCommands } from "@/utils/core/filesystem";

export async function handleGitCommand(
  args: string[],
  gitCommandsRef: React.RefObject<GitCommands | null>,
  writeOutput: (output: string) => Promise<void>,
) {
  if (!gitCommandsRef.current || !args[0]) {
    await writeOutput("git: missing command");
    return;
  }
  const gitCmd = args[0];
  switch (gitCmd) {
    case "init":
      const initMessage = `git init: Command not available from terminal
プロジェクトの初期化は左下の「プロジェクト管理」ボタンから
新規プロジェクトを作成してください。
新規プロジェクトには自動でGitリポジトリが設定されます。`;
      await writeOutput(initMessage);
      break;

    case "status":
      const statusResult = await gitCommandsRef.current.status();
      await writeOutput(statusResult);
      break;

    case "add":
      if (args[1]) {
        const addResult = await gitCommandsRef.current.add(args[1]);
        await writeOutput(addResult);
      } else {
        await writeOutput("git add: missing file argument");
      }
      break;

    case "commit":
      const messageIndex = args.indexOf("-m");
      if (messageIndex !== -1 && args[messageIndex + 1]) {
        const message = args
          .slice(messageIndex + 1)
          .join(" ")
          .replace(/['"]/g, "");
        const commitResult = await gitCommandsRef.current.commit(message);
        await writeOutput(commitResult);
      } else {
        await writeOutput("git commit: missing -m flag and message");
      }
      break;

    case "log":
      const logResult = await gitCommandsRef.current.log();
      await writeOutput(logResult);
      break;

    case "checkout":
      if (args[1]) {
        const createNew = args.includes("-b");
        let branchName: string;

        if (createNew) {
          // -bフラグがある場合、-bの次の引数がブランチ名
          const bIndex = args.indexOf("-b");
          branchName = args[bIndex + 1];
          if (!branchName) {
            await writeOutput("git checkout: option requires an argument -- b");
            break;
          }
        } else {
          // -bフラグがない場合、最初の引数（git checkoutの後）がブランチ名
          branchName = args[1];
        }

        const checkoutResult = await gitCommandsRef.current.checkout(
          branchName,
          createNew,
        );
        await writeOutput(checkoutResult);
      } else {
        await writeOutput("git checkout: missing branch name");
      }
      break;

    case "branch":
      if (args[1]) {
        const deleteFlag = args.includes("-d") || args.includes("-D");
        const branchName = args.find((arg) => !arg.startsWith("-"));
        if (branchName) {
          const branchResult = await gitCommandsRef.current.branch(
            branchName,
            deleteFlag,
          );
          await writeOutput(branchResult);
        } else {
          await writeOutput("git branch: missing branch name");
        }
      } else {
        const branchResult = await gitCommandsRef.current.branch();
        await writeOutput(branchResult);
      }
      break;

    case "revert":
      if (args[1]) {
        const revertResult = await gitCommandsRef.current.revert(args[1]);
        await writeOutput(revertResult);
      } else {
        await writeOutput("git revert: missing commit hash");
      }
      break;

    case "reset":
      if (args.includes("--hard") && args[args.indexOf("--hard") + 1]) {
        // git reset --hard <commit>
        const commitHash = args[args.indexOf("--hard") + 1];
        const resetResult = await gitCommandsRef.current.reset({
          hard: true,
          commit: commitHash,
        });
        await writeOutput(resetResult);
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

    case "diff":
      console.log("git diff args:", args);

      // argsから'diff'を除外してdiffArgsを作成
      const diffArgs = args.filter((arg) => arg !== "diff");
      console.log("filtered diff args:", diffArgs);

      if (diffArgs.includes("--staged") || diffArgs.includes("--cached")) {
        // git diff --staged [filepath]
        const filepath = diffArgs.find((arg) => !arg.startsWith("--"));
        console.log("Staged diff for filepath:", filepath);
        const diffResult = await gitCommandsRef.current.diff({
          staged: true,
          filepath,
        });
        await writeOutput(diffResult);
      } else if (
        diffArgs.length === 1 &&
        !diffArgs[0].startsWith("-")
      ) {
        // git diff <branch> の場合
        const branchName = diffArgs[0];
        const diffResult = await gitCommandsRef.current.diff({ branchName });
        await writeOutput(diffResult);
      } else if (
        diffArgs.length >= 2 &&
        !diffArgs[0].startsWith("-") &&
        !diffArgs[1].startsWith("-")
      ) {
        // git diff <commit1> <commit2> [filepath]
        console.log("Commit diff:", diffArgs[0], "vs", diffArgs[1]);
        const filepath = diffArgs[2]; // 3番目の引数がファイルパス（オプション）
        const diffResult = await gitCommandsRef.current.diff({
          commit1: diffArgs[0],
          commit2: diffArgs[1],
          filepath,
        });
        await writeOutput(diffResult);
      } else {
        // git diff [filepath] - ワーキングディレクトリの変更
        const filepath = diffArgs.find((arg) => !arg.startsWith("-"));
        console.log("Working directory diff for filepath:", filepath);
        const diffResult = await gitCommandsRef.current.diff({ filepath });
        await writeOutput(diffResult);
      }
      break;

    case "merge":
      if (args.includes("--abort")) {
        // git merge --abort
        const mergeAbortResult = await gitCommandsRef.current.merge("", {
          abort: true,
        });
        await writeOutput(mergeAbortResult);
      } else if (args[1]) {
        // git merge <branch> [--no-ff] [-m "message"]
        const branchName = args[1];
        const noFf = args.includes("--no-ff");
        let message: string | undefined;

        // -m フラグでメッセージを指定
        const messageIndex = args.indexOf("-m");
        if (messageIndex !== -1 && args[messageIndex + 1]) {
          message = args
            .slice(messageIndex + 1)
            .join(" ")
            .replace(/['"]/g, "");
        }

        const mergeResult = await gitCommandsRef.current.merge(branchName, {
          noFf,
          message,
        });
        await writeOutput(mergeResult);
      } else {
        await writeOutput("git merge: missing branch name");
      }
      break;

    default:
      await writeOutput(`git: '${gitCmd}' is not a git command`);
      break;
  }
}
