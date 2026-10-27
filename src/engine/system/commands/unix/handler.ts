import { UnixCommandFailure } from '@/engine/system/commands/unix/base';
import type { UnixCommands } from '@/engine/system/commands/unix/index';
import { formatXargsTrace } from '@/engine/system/commands/unix/xargs';

function hasFileOperand(args: string[]): boolean {
  let expectsValue = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (expectsValue) {
      expectsValue = false;
      continue;
    }
    if (
      argument === '-n' ||
      argument === '--lines' ||
      argument === '-c' ||
      argument === '--bytes'
    ) {
      expectsValue = true;
      continue;
    }
    if (argument === '--') return index < args.length - 1;
    if (!argument.startsWith('-')) return true;
  }
  return false;
}

async function readStdinBytes(
  stdin: NodeJS.ReadableStream | string | Uint8Array | null
): Promise<Uint8Array> {
  if (typeof stdin === 'string') return new TextEncoder().encode(stdin);
  if (stdin instanceof Uint8Array) return stdin;
  if (!stdin) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  await new Promise<void>(resolve => {
    stdin.on('data', (chunk: unknown) => {
      let bytes: Uint8Array;
      if (typeof chunk === 'string') bytes = new TextEncoder().encode(chunk);
      else if (chunk instanceof Uint8Array) bytes = chunk;
      else return;
      chunks.push(bytes);
      length += bytes.length;
    });
    stdin.on('end', resolve);
    stdin.on('close', resolve);
    stdin.on('error', resolve);
  });
  const input = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    input.set(chunk, offset);
    offset += chunk.length;
  }
  return input;
}

export async function handleUnixCommand(
  cmd: string,
  args: string[],
  writeOutput: (output: string | Uint8Array) => Promise<void>,
  writeError: (err: string) => Promise<void>,
  unix: UnixCommands,
  stdin: NodeJS.ReadableStream | string | null = null,
  onSignal?: (listener: (signal: string) => void) => () => void,
  signal?: AbortSignal,
  outputTTY = false,
  executeArgv?: (
    argv: readonly string[]
  ) => Promise<{ stdout: string; stderr: string; code: number }>
): Promise<{ code: number; output: string }> {
  let out = '';
  let exitCode = 0;
  let streamed = false;

  const append = async (s: string | Uint8Array, code?: number) => {
    if (s instanceof Uint8Array) {
      await writeOutput(s);
      streamed = true;
      if (code !== undefined) exitCode = code;
      return;
    }
    // Normalize non-string values to avoid '[object Object]' when concatenating
    const str =
      s === undefined || s === null ? '' : typeof s === 'object' ? JSON.stringify(s) : String(s);
    out += str;
    try {
      await writeOutput(str);
      streamed = true;
    } catch (_e) {
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
    } catch (_e) {}
    if (code !== undefined) exitCode = code;
  };

  try {
    switch (cmd) {
      case 'help': {
        const result = await unix.help(args);
        await append(result);
        break;
      }

      case 'unzip': {
        if (args.length === 0) {
          await appendError('unzip: missing archive file\nUsage: unzip ARCHIVE.zip [DEST_DIR]', 2);
        } else {
          try {
            const result = await unix.unzip(args);
            await append(result);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.startsWith('unzip:')) await appendError(message, 1);
            else await appendError(`unzip: ${message}`, 1);
          }
        }
        break;
      }

      case 'ls': {
        const lsResult = await unix.ls(args, outputTTY);
        await appendLineOutput(lsResult);
        break;
      }

      case 'cd': {
        if (args.includes('--help') || args.includes('-h')) {
          await append('Usage: cd [directory]\nChange the shell working directory');
        } else if (args.length === 0) {
          await appendError('cd: missing operand\nUsage: cd DIRECTORY', 2);
        } else {
          const result = await unix.cd(args);
          await append(result);
        }
        break;
      }

      case 'pwd': {
        const pwdResult = await unix.pwd();
        await appendLineOutput(pwdResult);
        break;
      }

      case 'tree': {
        const treeResult = await unix.tree(args);
        await appendLineOutput(treeResult);
        break;
      }

      case 'mkdir': {
        if (args.length === 0) {
          await appendError('mkdir: missing operand\nUsage: mkdir [OPTION]... DIRECTORY...', 2);
        } else {
          const result = await unix.mkdir(args);
          await append(result);
        }
        break;
      }

      case 'mkfifo': {
        if (args.length === 0) {
          await appendError('mkfifo: missing operand\nUsage: mkfifo NAME...', 2);
        } else {
          await append(await unix.mkfifo(args));
        }
        break;
      }

      case 'touch': {
        if (args.length === 0) {
          await appendError('touch: missing file operand\nUsage: touch FILE...', 2);
        } else {
          const result = await unix.touch(args);
          await append(result);
        }
        break;
      }

      case 'rm': {
        if (args.length === 0) {
          await appendError('rm: missing operand\nUsage: rm [OPTION]... FILE...', 2);
        } else {
          const result = await unix.rm(args);
          await appendLineOutput(result);
        }
        break;
      }

      case 'mv': {
        if (args.length < 2) {
          await appendError('mv: missing file operand\nUsage: mv [OPTION]... SOURCE DEST', 2);
        } else {
          const result = await unix.mv(args);
          await appendLineOutput(result);
        }
        break;
      }

      case 'cp': {
        if (args.length < 2) {
          await appendError('cp: missing file operand\nUsage: cp [OPTION]... SOURCE DEST', 2);
        } else {
          const result = await unix.cp(args);
          await appendLineOutput(result);
        }
        break;
      }
      case 'rename': {
        if (args.length < 2) {
          await appendError('rename: missing file operand\nUsage: rename OLD NEW', 2);
        } else {
          const result = await unix.rename(args);
          await appendLineOutput(result);
        }
        break;
      }

      case 'cat': {
        const result = await unix.cat(args, stdin);
        await append(result);
        break;
      }

      case 'echo': {
        const result = await unix.echo(args);
        await append(result);
        break;
      }

      case 'dirname': {
        const result = await unix.dirname(args);
        await append(result);
        break;
      }

      case 'printf': {
        const result = await unix.printf(args);
        await append(result);
        break;
      }

      case 'find': {
        // Pass the original args through so option parameters (like -iname <pattern>)
        // are not misclassified as paths by earlier naive splitting.
        // unix.find will parse the args array itself.
        const findResult = await unix.find(args);
        await appendLineOutput(findResult);
        break;
      }

      case 'grep': {
        if (args.includes('--help')) {
          await append(await unix.grep(args));
        } else if (args.length < 1) {
          await appendError('grep: missing pattern\nUsage: grep [OPTION]... PATTERN [FILE]...', 2);
        } else {
          await append(await unix.grep(args, stdin));
        }
        break;
      }

      case 'head': {
        if (args.includes('--help')) {
          await append(await unix.head(args));
        } else if (!hasFileOperand(args) || args.includes('-')) {
          const input = await readStdinBytes(stdin);
          await append(await unix.head(args, input));
        } else {
          try {
            const result = await unix.head(args);
            await append(result);
          } catch (err) {
            if (err instanceof UnixCommandFailure) throw err;
            const file = args.find(a => !a.startsWith('-')) || args[0];
            await appendError(`head: ${file}: ${(err as Error).message}`, 1);
          }
        }
        break;
      }

      case 'tail': {
        if (args.includes('--help')) {
          await append(await unix.tail(args));
        } else if (!hasFileOperand(args) || args.includes('-')) {
          const input = await readStdinBytes(stdin);
          await append(await unix.tail(args, input));
        } else {
          try {
            const result = await unix.tail(args);
            await append(result);
          } catch (err) {
            if (err instanceof UnixCommandFailure) throw err;
            const file = args.find(a => !a.startsWith('-')) || args[0];
            await appendError(`tail: ${file}: ${(err as Error).message}`, 1);
          }
        }
        break;
      }

      case 'stat': {
        if (args.length === 0) {
          await appendError('stat: missing file operand\nUsage: stat FILE', 2);
        } else {
          try {
            const result = await unix.stat(args);
            await appendLineOutput(result);
          } catch (err) {
            if (err instanceof UnixCommandFailure) throw err;
            await appendError(`stat: ${args[0]}: ${(err as Error).message}`, 1);
          }
        }
        break;
      }

      case 'wc': {
        // wc command - count lines, words, bytes
        try {
          const result = await unix.wc(args, stdin);
          await appendLineOutput(result);
        } catch (err) {
          await appendError(`wc: ${(err as Error).message}`, 1);
        }
        break;
      }

      case 'du': {
        try {
          const result = await unix.du(args);
          await appendLineOutput(result);
        } catch (err) {
          await appendError(`du: ${(err as Error).message}`, 1);
        }
        break;
      }

      case 'df': {
        try {
          const result = await unix.df(args);
          await append(result);
        } catch (err) {
          await appendError(`df: ${(err as Error).message}`, 1);
        }
        break;
      }

      case 'sort': {
        try {
          const result = await unix.sort(args, stdin);
          await appendLineOutput(result);
        } catch (err) {
          await appendError(`sort: ${(err as Error).message}`, 1);
        }
        break;
      }

      case 'tr': {
        await append(await unix.tr(args, stdin));
        break;
      }

      case 'seq': {
        await append(await unix.seq(args));
        break;
      }

      case 'tee': {
        const result = await unix.tee(args, stdin);
        await append(result.output);
        if (result.errors.length > 0) {
          await appendError(`${result.errors.join('\n')}\n`, 1);
        }
        break;
      }

      case 'sleep': {
        const completed = await unix.sleep(args, onSignal, signal);
        if (!completed) exitCode = 130;
        break;
      }

      case 'xargs': {
        const plan = await unix.xargs(args, stdin);
        if (plan.trace) {
          for (const invocation of plan.invocations) {
            await appendError(`${formatXargsTrace(invocation)}\n`);
          }
        }

        if (!executeArgv)
          throw new UnixCommandFailure('xargs: command execution is unavailable', 1);
        const results = await executeInvocations(plan, async invocation => {
          const argv = [invocation.command, ...invocation.args];
          return executeArgv(argv);
        });

        let status = 0;
        let stdout = '';
        let stderr = '';
        for (const result of results) {
          if (!result) continue;
          stdout += result.stdout;
          stderr += result.stderr;
          status = mergeXargsStatus(status, result.code);
        }
        if (stdout !== '') await append(stdout);
        if (stderr !== '') await appendError(stderr);
        exitCode = status;
        break;
      }

      case 'awk': {
        await append(await unix.awk(args, stdin));
        break;
      }

      case 'tar': {
        try {
          const result = await unix.tar(args);
          await append(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          await appendError(`tar: ${message}`, 1);
        }
        break;
      }

      case 'gzip': {
        try {
          const result = await unix.gzip(args);
          await append(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          await appendError(`gzip: ${message}`, 1);
        }
        break;
      }

      case 'zip': {
        try {
          const result = await unix.zip(args);
          await append(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          await appendError(`zip: ${message}`, 1);
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

      case 'date': {
        try {
          const result = await unix.date(args);
          await appendLineOutput(result);
        } catch (err) {
          await appendError(`date: ${(err as Error).message}`, 1);
        }
        break;
      }

      case 'whoami':
        await appendLineOutput('user');
        break;

      default:
        await appendError(`Command not found: ${cmd}\nType 'help' for available commands.\n`, 127);
    }
  } catch (error) {
    if (error instanceof UnixCommandFailure) {
      if (error.stdout) await append(error.stdout);
      if (error.message !== '') await appendError(`${error.message}\n`, error.code);
      else exitCode = error.code;
      return { code: exitCode, output: streamed ? '' : out };
    }
    await appendError(`Error: ${(error as Error).message}\n`, 1);
  }

  return { code: exitCode, output: streamed ? '' : out };

  async function appendLineOutput(value: string): Promise<void> {
    if (value === '') return;
    let terminated = value;
    if (!terminated.endsWith('\n')) terminated += '\n';
    await append(terminated);
  }
}

export default handleUnixCommand;

async function executeInvocations<T>(
  plan: { invocations: T[]; maxParallelism: number },
  execute: (invocation: T) => Promise<{ stdout: string; stderr: string; code: number }>
): Promise<Array<{ stdout: string; stderr: string; code: number }>> {
  const results: Array<{ stdout: string; stderr: string; code: number } | undefined> = new Array(
    plan.invocations.length
  );
  let nextIndex = 0;
  let workerCount = Math.min(plan.maxParallelism, plan.invocations.length);
  if (plan.maxParallelism === 0) workerCount = plan.invocations.length;

  const runNext = async (): Promise<void> => {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= plan.invocations.length) return;
    const result = await execute(plan.invocations[index]);
    results[index] = result;
    if (result.code === 126 || result.code === 127 || result.code === 255 || result.code > 128) {
      nextIndex = plan.invocations.length;
      return;
    }
    await runNext();
  };

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  const completed: Array<{ stdout: string; stderr: string; code: number }> = [];
  for (const result of results) {
    if (result === undefined) continue;
    completed.push(result);
  }
  return completed;
}

function mergeXargsStatus(current: number, child: number): number {
  const mapped = mapXargsStatus(child);
  if (mapped === 0) return current;
  if (current === 0) return mapped;
  if (statusPriority(mapped) > statusPriority(current)) return mapped;
  return current;
}

function mapXargsStatus(code: number): number {
  if (code === 0) return 0;
  if (code === 127) return 127;
  if (code === 126) return 126;
  if (code === 255) return 124;
  if (code > 128) return 125;
  if (code > 0 && code <= 125) return 123;
  return 1;
}

function statusPriority(code: number): number {
  if (code === 127) return 5;
  if (code === 126) return 4;
  if (code === 125) return 3;
  if (code === 124) return 2;
  return 1;
}
