import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';

export async function handleUnixCommand(
  cmd: string,
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>,
  writeError: (err: string) => Promise<void>,
  stdin: NodeJS.ReadableStream | string | null = null
): Promise<{ code: number; output: string }> {
  const unix = terminalCommandRegistry.getUnixCommands(projectName, projectId);

  let out = '';
  let exitCode = 0;
  let streamed = false;

  const append = async (s: string, code?: number) => {
    // Normalize non-string values to avoid '[object Object]' when concatenating
    const str =
      s === undefined || s === null ? '' : typeof s === 'object' ? JSON.stringify(s) : String(s);
    out += str;
    try {
      await writeOutput(str);
      streamed = true;
    } catch (e) {
      // ignore writeOutput errors
    }
    if (code !== undefined) exitCode = code;
  };

  const appendError = async (s: string, code?: number) => {
    const str = s === undefined || s === null ? '' : String(s);
    // errors should not be added to regular out to avoid mixing streams when streamed
    try {
      await writeError(str);
      streamed = true;
    } catch (e) {}
    if (code !== undefined) exitCode = code;
  };

  if (!unix) {
    await append('Error: Unix commands not initialized\n', 1);
    return { code: exitCode, output: out };
  }

  try {
    switch (cmd) {
      case 'help': {
        const result = await unix.help(args);
        await append(result);
        break;
      }

      case 'unzip': {
        if (args.length === 0) {
          await append('unzip: missing archive file\nUsage: unzip ARCHIVE.zip [DEST_DIR]');
        } else {
          try {
            const result = await unix.unzip(args);
            await append(result);
          } catch (err) {
            await append(`unzip: ${args[0]}: ${(err as Error).message}`);
          }
        }
        break;
      }

      case 'ls': {
        const lsResult = await unix.ls(args);
        await append(lsResult);
        break;
      }

      case 'cd': {
        if (args.includes('--help') || args.includes('-h')) {
          await append('Usage: cd [directory]\nChange the shell working directory');
        } else if (args.length === 0) {
          await append('cd: missing operand\nUsage: cd DIRECTORY');
        } else {
          const result = await unix.cd(args);
          await append(result);
        }
        break;
      }

      case 'pwd': {
        const pwdResult = await unix.pwd();
        await append(pwdResult);
        break;
      }

      case 'tree': {
        const treeResult = await unix.tree(args);
        await append(treeResult);
        break;
      }

      case 'mkdir': {
        if (args.length === 0) {
          await append('mkdir: missing operand\nUsage: mkdir [OPTION]... DIRECTORY...');
        } else {
          const result = await unix.mkdir(args);
          await append(result);
        }
        break;
      }

      case 'touch': {
        if (args.length === 0) {
          await append('touch: missing file operand\nUsage: touch FILE...');
        } else {
          const result = await unix.touch(args);
          await append(result);
        }
        break;
      }

      case 'rm': {
        if (args.length === 0) {
          await append('rm: missing operand\nUsage: rm [OPTION]... FILE...');
        } else {
          const result = await unix.rm(args);
          await append(result);
        }
        break;
      }

      case 'mv': {
        if (args.length < 2) {
          await append('mv: missing file operand\nUsage: mv [OPTION]... SOURCE DEST');
        } else {
          const result = await unix.mv(args);
          await append(result || 'File(s) moved successfully');
        }
        break;
      }

      case 'cp': {
        if (args.length < 2) {
          await append('cp: missing file operand\nUsage: cp [OPTION]... SOURCE DEST');
        } else {
          const result = await unix.cp(args);
          await append(result || 'File(s) copied successfully');
        }
        break;
      }
      case 'rename': {
        if (args.length < 2) {
          await append('rename: missing file operand\nUsage: rename OLD NEW');
        } else {
          const result = await unix.rename(args);
          await append(result || 'File renamed successfully');
        }
        break;
      }

      case 'cat': {
        if (args.length === 0) {
          await append('cat: missing file operand\nUsage: cat FILE...');
        } else {
          const result = await unix.cat(args);
          await append(result);
        }
        break;
      }

      case 'echo': {
        const result = await unix.echo(args);
        await append(result);
        break;
      }

      case 'find': {
        // Pass the original args through so option parameters (like -iname <pattern>)
        // are not misclassified as paths by earlier naive splitting.
        // unix.find will parse the args array itself.
        const findResult = await unix.find(args);
        await append(findResult);
        break;
      }

      case 'grep': {
        if (args.length < 1) {
          await append('grep: missing pattern\nUsage: grep [OPTION]... PATTERN [FILE]...');
        } else {
          try {
            const result = await unix.grep(args, stdin);
            // Separate error lines (those starting with 'grep: ') from normal matches
            const lines = String(result || '')
              .split(/\r?\n/)
              .filter(l => l !== '');
            const errorLines = lines.filter(l => l.startsWith('grep: '));
            const matchLines = lines.filter(l => !l.startsWith('grep: '));

            // stream matches to stdout
            if (matchLines.length > 0) {
              await append(`${matchLines.join('\n')}\n`);
            }

            // stream errors to stderr and set appropriate exit code
            if (errorLines.length > 0) {
              await appendError(`${errorLines.join('\n')}\n`, 2);
              // if there were matches as well, overall exit should be 2 (error)
              // otherwise, code already set to 2 by appendError
            } else {
              // set exit code based on whether matches were found
              const code = matchLines.length > 0 ? 0 : 1;
              if (!streamed) {
                // if nothing was streamed yet, return combined output via append so makeUnixBridge can handle it
                await append(matchLines.join('\n'), code);
              } else {
                exitCode = code;
              }
            }
          } catch (err) {
            await appendError(`grep: ${(err as Error).message}\n`, 2);
          }
        }
        break;
      }

      case 'head': {
        if (args.length === 0) {
          await append('head: missing file operand\nUsage: head [OPTION]... [FILE]');
        } else {
          try {
            const result = await unix.head(args);
            await append(result);
          } catch (err) {
            const file = args.find(a => !a.startsWith('-')) || args[0];
            await append(`head: ${file}: ${(err as Error).message}`);
          }
        }
        break;
      }

      case 'tail': {
        if (args.length === 0) {
          await append('tail: missing file operand\nUsage: tail [OPTION]... [FILE]');
        } else {
          try {
            const result = await unix.tail(args);
            await append(result);
          } catch (err) {
            const file = args.find(a => !a.startsWith('-')) || args[0];
            await append(`tail: ${file}: ${(err as Error).message}`);
          }
        }
        break;
      }

      case 'stat': {
        if (args.length === 0) {
          await append('stat: missing file operand\nUsage: stat FILE');
        } else {
          try {
            const result = await unix.stat(args);
            await append(result);
          } catch (err) {
            await append(`stat: ${args[0]}: ${(err as Error).message}`);
          }
        }
        break;
      }

      case 'wc': {
        // wc command - count lines, words, bytes
        try {
          const result = await unix.wc(args, stdin);
          await append(result);
        } catch (err) {
          await append(`wc: ${(err as Error).message}`, 1);
        }
        break;
      }

      case 'chmod':
      case 'chown':
        await append(`${cmd}: not supported in browser environment\nOperation skipped.`);
        break;

      case 'ln':
        await append('ln: linking not supported in this environment');
        break;

      case 'date':
        await append(new Date().toLocaleString('ja-JP'));
        break;

      case 'whoami':
        await append('user');
        break;

      default:
        await append(`Command not found: ${cmd}\nType 'help' for available commands.\n`, 127);
    }
  } catch (error) {
    await append(`Error: ${(error as Error).message}\n`, 1);
  }

  return { code: exitCode, output: streamed ? '' : out };
}

export default handleUnixCommand;
