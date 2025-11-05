import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';

export async function handleUnixCommand(
  cmd: string,
  args: string[],
  projectName: string,
  projectId: string,
  writeOutput: (output: string) => Promise<void>
): Promise<{ code: number; output: string }> {
  const unix = terminalCommandRegistry.getUnixCommands(projectName, projectId);

  let out = '';
  let exitCode = 0;

  const append = async (s: string, code?: number) => {
    out += s;
    try {
      await writeOutput(s);
    } catch (e) {
      // ignore writeOutput errors
    }
    if (code !== undefined) exitCode = code;
  };

  if (!unix) {
    await append('Error: Unix commands not initialized\n', 1);
    return { code: exitCode, output: out };
  }

  try {
    switch (cmd) {
      case 'help': {
        const helpArg = args.length > 0 ? args[0] : undefined;
        const helpResult = await unix.help(helpArg);
        await append(helpResult);
        break;
      }

      case 'unzip': {
        if (args.length === 0) {
          await append('unzip: missing archive file\nUsage: unzip ARCHIVE.zip [DEST_DIR]');
        } else {
          const archive = args[0];
          const dest = args[1] || '';
          try {
            const result = await unix.unzip(archive, dest);
            await append(result);
          } catch (err) {
            await append(`unzip: ${archive}: ${(err as Error).message}`);
          }
        }
        break;
      }

      case 'ls': {
        const lsOptions = args.filter(arg => arg.startsWith('-'));
        const lsPath = args.find(arg => !arg.startsWith('-'));
        const lsResult = await unix.ls(lsPath, lsOptions);
        await append(lsResult);
        break;
      }

      case 'cd': {
        if (args.length === 0) {
          await append('cd: missing operand\nUsage: cd DIRECTORY');
        } else {
          const dir = args[0];
          const result = await unix.cd(dir);
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
        const treeOptions = args.filter(arg => arg.startsWith('-'));
        const treePath = args.find(arg => !arg.startsWith('-'));
        const treeResult = await unix.tree(treePath, treeOptions);
        await append(treeResult);
        break;
      }

      case 'mkdir': {
        if (args.length === 0) {
          await append('mkdir: missing operand\nUsage: mkdir [OPTION]... DIRECTORY...');
        } else {
          const recursive = args.includes('-p') || args.includes('--parents');
          const dirName = args.find(arg => !arg.startsWith('-'));
          if (dirName) {
            const result = await unix.mkdir(dirName, recursive);
            await append(result);
          } else {
            await append('mkdir: missing directory name');
          }
        }
        break;
      }

      case 'touch': {
        if (args.length === 0) {
          await append('touch: missing file operand\nUsage: touch FILE...');
        } else {
          const result = await unix.touch(args[0]);
          await append(result);
        }
        break;
      }

      case 'rm': {
        if (args.length === 0) {
          await append('rm: missing operand\nUsage: rm [OPTION]... FILE...');
        } else {
          const recursive = args.includes('-r') || args.includes('-R') || args.includes('--recursive');
          const fileName = args.find(arg => !arg.startsWith('-'));
          if (fileName) {
            const result = await unix.rm(fileName, recursive);
            await append(result);
          } else {
            await append('rm: missing file operand');
          }
        }
        break;
      }

      case 'cp': {
        if (args.length < 2) {
          await append('cp: missing file operand\nUsage: cp [OPTION]... SOURCE DEST');
        } else {
          const options = args.filter(arg => arg.startsWith('-'));
          const paths = args.filter(arg => !arg.startsWith('-'));
          if (paths.length < 2) {
            await append('cp: missing destination file operand after source');
          } else {
            const source = paths[0];
            const dest = paths[1];
            const result = await unix.cp(source, dest, options);
            await append(result || 'File(s) copied successfully');
          }
        }
        break;
      }

      case 'mv': {
        if (args.length < 2) {
          await append('mv: missing file operand\nUsage: mv [OPTION]... SOURCE DEST');
        } else {
          const paths = args.filter(arg => !arg.startsWith('-'));
          if (paths.length < 2) {
            await append('mv: missing destination file operand after source');
          } else {
            const source = paths[0];
            const dest = paths[1];
            const result = await unix.mv(source, dest);
            await append(result || 'File(s) moved successfully');
          }
        }
        break;
      }

      case 'rename': {
        if (args.length < 2) {
          await append('rename: missing file operand\nUsage: rename OLD NEW');
        } else {
          const result = await unix.rename(args[0], args[1]);
          await append(result || 'File renamed successfully');
        }
        break;
      }

      case 'cat': {
        if (args.length === 0) {
          await append('cat: missing file operand\nUsage: cat FILE...');
        } else {
          const result = await unix.cat(args[0]);
          await append(result);
        }
        break;
      }

      case 'echo': {
        const text = args.join(' ');
        const result = await unix.echo(text);
        await append(result);
        break;
      }

      case 'find': {
        const findOptions = args.filter(arg => arg.startsWith('-'));
        const findPaths = args.filter(arg => !arg.startsWith('-'));
        const findPath = findPaths.length > 0 ? findPaths[0] : undefined;
        const findResult = await unix.find(findPath, findOptions);
        await append(findResult);
        break;
      }

      case 'grep': {
        if (args.length < 2) {
          await append('grep: missing pattern or file\nUsage: grep [OPTION]... PATTERN FILE...');
        } else {
          const grepOptions = args.filter(arg => arg.startsWith('-'));
          const grepArgs = args.filter(arg => !arg.startsWith('-'));
          const pattern = grepArgs[0];
          const files = grepArgs.slice(1);
          if (files.length === 0) {
            await append('grep: missing file operand');
          } else {
            const result = await unix.grep(pattern, files, grepOptions);
            await append(result);
          }
        }
        break;
      }

      case 'head': {
        if (args.length === 0) {
          await append('head: missing file operand\nUsage: head [OPTION]... [FILE]');
        } else {
          const options = args.filter(a => a.startsWith('-'));
          const paths = args.filter(a => !a.startsWith('-'));
          const file = paths[0];
          const nOption = options.find(o => o.startsWith('-n'));
          const n = nOption ? parseInt(nOption.replace('-n', '')) || 10 : 10;
          try {
            const result = unix.head ? await unix.head(file, n) : await unix.cat(file);
            await append(result);
          } catch (err) {
            await append(`head: ${file}: ${(err as Error).message}`);
          }
        }
        break;
      }

      case 'tail': {
        if (args.length === 0) {
          await append('tail: missing file operand\nUsage: tail [OPTION]... [FILE]');
        } else {
          const options = args.filter(a => a.startsWith('-'));
          const paths = args.filter(a => !a.startsWith('-'));
          const file = paths[0];
          const nOption = options.find(o => o.startsWith('-n'));
          const n = nOption ? parseInt(nOption.replace('-n', '')) || 10 : 10;
          try {
            const result = unix.tail ? await unix.tail(file, n) : await unix.cat(file);
            await append(result);
          } catch (err) {
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
            if (unix.stat) {
              const result = await unix.stat(args[0]);
              await append(result);
            } else {
              await append('stat: not implemented in this environment');
            }
          } catch (err) {
            await append(`stat: ${args[0]}: ${(err as Error).message}`);
          }
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

  return { code: exitCode, output: out };
}

export default handleUnixCommand;
