import type { Readable, Writable } from 'node:stream';
import { Buffer } from 'buffer';
import { FSError } from '@/engine/core/fs';
import { terminalProcessBridge } from '../terminalProcessBridge';
import type { PreparedOutput, ShellOutputHandler } from './outputHandler';
import { type Process, signalExitCode } from './process';
import type { OutputCallbacks, Segment, ShellRunResult } from './types';

type PipelineOptions = {
  createProcess: (segment: Segment) => Promise<Process>;
  startProcess: (process: Process, segment: Segment) => void | Promise<void>;
  outputHandler: ShellOutputHandler;
  pipefail: boolean;
  callbacks?: OutputCallbacks;
  foreground?: (process: Process, processes: Process[]) => void;
  stdin?: Readable;
  stdinDestination?: Writable;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  interactive?: boolean;
  isForeground?: boolean;
};

export async function runPipeline(
  segments: Segment[],
  options: PipelineOptions
): Promise<ShellRunResult & { statuses: number[] }> {
  const processes: Process[] = [];
  let consoleStdoutIsTTY = options.interactive === true;
  let consoleStderrIsTTY = options.interactive === true;
  if (options.stdoutIsTTY !== undefined) consoleStdoutIsTTY = options.stdoutIsTTY;
  if (options.stderrIsTTY !== undefined) consoleStderrIsTTY = options.stderrIsTTY;

  try {
    for (let index = 0; index < segments.length; index += 1) {
      processes.push(await options.createProcess(segments[index]));
    }
  } catch (error) {
    for (const process of processes) process.exit(1);
    try {
      await Promise.all(
        processes.map(async process => {
          await process.completeIO();
          await process.wait();
        })
      );
    } catch (cleanupError) {
      const startupMessage = error instanceof Error ? error.message : String(error);
      const cleanupMessage =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`${startupMessage}; process cleanup failed: ${cleanupMessage}`);
    }
    throw error;
  }

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const prepared = new Map<number, PreparedOutput>();
  const cancelPipeline = () => {
    for (const process of processes) {
      process.kill('SIGTERM');
      process.exit(null, 'SIGTERM');
    }
  };
  const failPipeline = (error: Error): never => {
    cancelPipeline();
    throw error;
  };
  const lastProcess = processes[processes.length - 1];
  options.foreground?.(lastProcess, processes);
  const preparation = options.outputHandler.preparePipeline(segments, processes);
  const stages = preparation.map(async (planPromise, index) => {
    const process = processes[index];
    const segment = segments[index];
    const watched: Promise<void>[] = [];
    try {
      const plan = await planPromise;
      prepared.set(index, plan);
      const stdoutRoute = plan.routes.get(1);
      const stderrRoute = plan.routes.get(2);
      if (stdoutRoute?.kind === 'console') process.stdoutConsoleFd = stdoutRoute.fd;
      if (stderrRoute?.kind === 'console') process.stderrConsoleFd = stderrRoute.fd;
      if (stdoutRoute?.kind === 'console') {
        process.stdoutIsTTY = consoleStdoutIsTTY;
        if (stdoutRoute.fd === 2) process.stdoutIsTTY = consoleStderrIsTTY;
      }
      if (stderrRoute?.kind === 'console') {
        process.stderrIsTTY = consoleStderrIsTTY;
        if (stderrRoute.fd === 1) process.stderrIsTTY = consoleStdoutIsTTY;
      }
      const hasExplicitInput =
        segment.stdinText !== undefined ||
        segment.redirections?.some(redirection => redirection.kind === 'input') === true;
      const backgroundDefaultInput = options.isForeground === false && !hasExplicitInput;
      if (plan.input !== undefined && segment.stdinText === undefined) {
        process.stdin.end(plan.input);
        process.stdinRedirected = true;
      }
      if (plan.inputFifo) process.stdinRedirected = true;
      if (index === 0 && options.stdin && !hasExplicitInput && !backgroundDefaultInput) {
        process.setInputSource(options.stdin, options.stdinDestination);
        process.stdinRedirected = true;
        process.stdinIsTTY = options.isForeground === true && options.stdinIsTTY === true;
      }
      if (index > 0 && !hasExplicitInput) process.stdinRedirected = true;
      if (index === 0 && backgroundDefaultInput) {
        process.stdin.end();
        process.stdinRedirected = true;
      } else if (index === 0 && !hasExplicitInput && !options.stdin) {
        process.stdinIsTTY = options.interactive === true && options.isForeground === true;
        if (!process.stdinIsTTY) process.stdin.end();
      }
      const inputWatch = options.outputHandler.watchInput(process, plan);
      if (inputWatch) watched.push(inputWatch.catch(failPipeline));
      const outputWatch = options.outputHandler.watch(
        process,
        plan,
        processes[index + 1],
        { stdout, stderr },
        options.callbacks
      );
      watched.push(outputWatch.catch(failPipeline));
      if (!process.hasExited) {
        process.markStarted();
        if (plan.failure) {
          process.writeStderr(plan.failure);
          process.exit(1);
        } else {
          if (index === 0 && process.stdinIsTTY) {
            const lease = terminalProcessBridge.activate(process.processStdin);
            process.once('exit', () => lease.release());
          }
          process.emit('pipes-ready');
          process.trackCleanup(Promise.resolve(options.startProcess(process, segment)));
        }
      }
      const exit = process.wait();
      const results = await Promise.allSettled([exit.catch(failPipeline), ...watched]);
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      return await exit;
    } catch (error) {
      if (process.hasExited && error instanceof FSError && error.code === 'EINTR') {
        return await process.wait();
      }
      cancelPipeline();
      const cleanup = await Promise.allSettled([process.wait(), ...watched]);
      const cleanupFailure = cleanup.find(result => result.status === 'rejected');
      if (cleanupFailure?.status === 'rejected' && cleanupFailure.reason !== error) {
        throw new AggregateError([error, cleanupFailure.reason], 'Pipeline cleanup failed.');
      }
      throw error;
    } finally {
      await process.completeIO().catch(failPipeline);
    }
  });
  const exitResults = await Promise.allSettled(stages);
  const exitFailure = exitResults.find(result => result.status === 'rejected');
  if (exitFailure?.status === 'rejected') throw exitFailure.reason;
  const statuses = exitResults.map((result, index) => {
    if (result.status !== 'fulfilled') throw result.reason;
    const process = processes[index];
    if (process.ioSignal) return signalExitCode(process.ioSignal);
    if (result.value.signal) return signalExitCode(result.value.signal);
    let status = result.value.code ?? 0;
    const plan = prepared.get(index);
    if (plan?.writeFailure && status === 0) status = 1;
    return status;
  });
  let code = statuses[statuses.length - 1] ?? 0;
  if (options.pipefail) {
    for (let index = statuses.length - 1; index >= 0; index -= 1) {
      if (statuses[index] !== 0) {
        code = statuses[index];
        break;
      }
    }
  }

  try {
    await options.outputHandler.flush([...prepared.values()]);
  } catch (error) {
    const message = `Redirection failed: ${String(error)}\n`;
    stderr.push(Buffer.from(message));
    options.callbacks?.stderr?.(message);
    code = 1;
  }
  return {
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    code,
    statuses,
    interrupted: processes.some(process => process.interrupted),
  };
}
