// TerminalUnixCommands.tsx
// Terminalのunixコマンド処理部分を分割（新アーキテクチャ対応）

import type { UnixCommands } from '@/engine/cmd/unix';

export async function handleUnixCommand(
  cmd: string,
  args: string[],
  unixCommandsRef: React.RefObject<UnixCommands | null>,
  currentProject: string,
  writeOutput: (output: string) => Promise<void>
) {
  if (!unixCommandsRef.current) {
    await writeOutput('Error: Unix commands not initialized');
    return;
  }

  const unix = unixCommandsRef.current;

  try {
    switch (cmd) {
      // ========== 基本コマンド ==========
      case 'help':
        const helpArg = args.length > 0 ? args[0] : undefined;
        const helpResult = await unix.help(helpArg);
        await writeOutput(helpResult);
        break;

      case 'unzip':
        // Usage: unzip ARCHIVE.zip [DEST_DIR]
        if (args.length === 0) {
          await writeOutput('unzip: missing archive file\nUsage: unzip ARCHIVE.zip [DEST_DIR]');
        } else {
          const archive = args[0];
          const dest = args[1] || '';
          try {
            const result = await unix.unzip(archive, dest);
            await writeOutput(result);
          } catch (err) {
            await writeOutput(`unzip: ${archive}: ${(err as Error).message}`);
          }
        }
        break;

      case 'ls':
        const lsOptions = args.filter(arg => arg.startsWith('-'));
        const lsPath = args.find(arg => !arg.startsWith('-'));
        const lsResult = await unix.ls(lsPath, lsOptions);
        await writeOutput(lsResult);
        break;

      case 'tree':
        const treeOptions = args.filter(arg => arg.startsWith('-'));
        const treePath = args.find(arg => !arg.startsWith('-'));
        const treeResult = await unix.tree(treePath, treeOptions);
        await writeOutput(treeResult);
        break;

      // ========== ファイル/ディレクトリ作成 ==========
      case 'mkdir':
        if (args.length === 0) {
          await writeOutput('mkdir: missing operand\nUsage: mkdir [OPTION]... DIRECTORY...');
        } else {
          const recursive = args.includes('-p') || args.includes('--parents');
          const dirName = args.find(arg => !arg.startsWith('-'));
          if (dirName) {
            const result = await unix.mkdir(dirName, recursive);
            await writeOutput(result);
          } else {
            await writeOutput('mkdir: missing directory name');
          }
        }
        break;

      case 'touch':
        if (args.length === 0) {
          await writeOutput('touch: missing file operand\nUsage: touch FILE...');
        } else {
          const result = await unix.touch(args[0]);
          await writeOutput(result);
        }
        break;

      // ========== ファイル操作 ==========
      case 'rm':
        if (args.length === 0) {
          await writeOutput('rm: missing operand\nUsage: rm [OPTION]... FILE...');
        } else {
          const recursive =
            args.includes('-r') || args.includes('-R') || args.includes('--recursive');
          const fileName = args.find(arg => !arg.startsWith('-'));
          if (fileName) {
            const result = await unix.rm(fileName, recursive);
            await writeOutput(result);
          } else {
            await writeOutput('rm: missing file operand');
          }
        }
        break;

      case 'cp':
        if (args.length < 2) {
          await writeOutput('cp: missing file operand\nUsage: cp [OPTION]... SOURCE DEST');
        } else {
          const options = args.filter(arg => arg.startsWith('-'));
          const paths = args.filter(arg => !arg.startsWith('-'));
          if (paths.length < 2) {
            await writeOutput('cp: missing destination file operand after source');
          } else {
            const source = paths[0];
            const dest = paths[1];
            const result = await unix.cp(source, dest, options);
            await writeOutput(result || 'File(s) copied successfully');
          }
        }
        break;

      case 'mv':
        if (args.length < 2) {
          await writeOutput('mv: missing file operand\nUsage: mv [OPTION]... SOURCE DEST');
        } else {
          const options = args.filter(arg => arg.startsWith('-'));
          const paths = args.filter(arg => !arg.startsWith('-'));
          if (paths.length < 2) {
            await writeOutput('mv: missing destination file operand after source');
          } else {
            const source = paths[0];
            const dest = paths[1];
            // オプションを展開して渡す
            const allArgs = [...options, source, dest];
            const result = await unix.mv(source, dest);
            await writeOutput(result || 'File(s) moved successfully');
          }
        }
        break;

      case 'rename':
        // mvのエイリアス
        if (args.length < 2) {
          await writeOutput('rename: missing file operand\nUsage: rename OLD NEW');
        } else {
          const result = await unix.rename(args[0], args[1]);
          await writeOutput(result || 'File renamed successfully');
        }
        break;

      // ========== ファイル表示 ==========
      case 'cat':
        if (args.length === 0) {
          await writeOutput('cat: missing file operand\nUsage: cat FILE...');
        } else {
          const result = await unix.cat(args[0]);
          await writeOutput(result);
        }
        break;

      case 'echo':
        // リダイレクト処理はTerminal.tsxで統一的に処理されるため、
        // ここでは単純にテキストを出力するだけ
        const text = args.join(' ');
        const result = await unix.echo(text);
        await writeOutput(result);
        break;

      // ========== 検索コマンド ==========
      case 'find':
        const findOptions = args.filter(arg => arg.startsWith('-'));
        const findPaths = args.filter(arg => !arg.startsWith('-'));
        const findPath = findPaths.length > 0 ? findPaths[0] : undefined;
        const findResult = await unix.find(findPath, findOptions);
        await writeOutput(findResult);
        break;

      case 'grep':
        if (args.length < 2) {
          await writeOutput(
            'grep: missing pattern or file\nUsage: grep [OPTION]... PATTERN FILE...'
          );
        } else {
          const grepOptions = args.filter(arg => arg.startsWith('-'));
          const grepArgs = args.filter(arg => !arg.startsWith('-'));
          const pattern = grepArgs[0];
          const files = grepArgs.slice(1);
          if (files.length === 0) {
            await writeOutput('grep: missing file operand');
          } else {
            const result = await unix.grep(pattern, files, grepOptions);
            await writeOutput(result);
          }
        }
        break;

      // ========== その他のコマンド ==========
      case 'date':
        await writeOutput(new Date().toLocaleString('ja-JP'));
        break;

      case 'whoami':
        await writeOutput('user');
        break;

      case 'unzip':
        // Usage: unzip ARCHIVE.zip [DEST_DIR]
        if (args.length === 0) {
          await writeOutput('unzip: missing archive fileUsage: unzip ARCHIVE.zip [DEST_DIR]');
        } else {
          const archive = args[0];
          const dest = args[1] || archive.replace(/\.zip$/, '');
          try {
            const result = await unix.unzip(archive, dest);
            await writeOutput(result);
          } catch (err) {
            await writeOutput(`unzip: ${archive}: ${(err as Error).message}`);
          }
        }
        break;

      default:
        await writeOutput(`Command not found: ${cmd}\nType 'help' for available commands.`);
    }
  } catch (error) {
    await writeOutput(`Error: ${(error as Error).message}`);
  }
}
