import { Process } from './process';
import type { OutputCallbacks, ShellRunResult } from './types';

export interface ShellJobIdentity {
  jobId: number;
  pid: number;
}

interface Job {
  completion: Promise<ShellRunResult>;
  callbacks?: OutputCallbacks;
  cancel?: () => void;
  pid: number;
}

export class ShellJobs {
  private jobs = new Map<number, Job>();
  private jobIdByPid = new Map<number, number>();
  private nextId = 1;

  add(
    completion: Promise<ShellRunResult>,
    callbacks?: OutputCallbacks,
    cancel?: () => void,
    pid = Process.allocatePid()
  ): ShellJobIdentity {
    const id = this.nextId++;
    const result = completion.catch(error => {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      const stderr = `Shell error: ${message}\n`;
      callbacks?.stderr?.(stderr);
      return { stdout: '', stderr, code: 1 };
    });
    this.jobs.set(id, { completion: result, callbacks, cancel, pid });
    this.jobIdByPid.set(pid, id);
    return { jobId: id, pid };
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) job.cancel?.();
  }

  async wait(arguments_: string[], process: Process): Promise<number> {
    const selected = new Map<number, Job>();
    if (arguments_.length === 0) {
      for (const [id, job] of this.jobs) selected.set(id, job);
    } else {
      for (const argument of arguments_) {
        const id = this.resolveJobId(argument);
        const job = this.jobs.get(id);
        if (!job) {
          process.writeStderr(`wait: ${argument}: not a child of this shell\n`);
          return 127;
        }
        selected.set(id, job);
      }
    }
    let status = 0;
    for (const [id, job] of selected) {
      let exitListener = () => {};
      const processExit = new Promise<null>(resolve => {
        exitListener = () => resolve(null);
        process.once('exit', exitListener);
        if (process.hasExited) resolve(null);
      });
      let settled: { result: ShellRunResult } | null;
      try {
        settled = await Promise.race([job.completion.then(result => ({ result })), processExit]);
      } finally {
        process.off('exit', exitListener);
      }
      if (!settled) return status;
      const result = settled.result;
      if (!job.callbacks?.stdout && result.stdout) process.writeStdout(result.stdout);
      if (!job.callbacks?.stderr && result.stderr) process.writeStderr(result.stderr);
      status = result.code ?? 0;
      this.jobs.delete(id);
      this.jobIdByPid.delete(job.pid);
    }
    if (arguments_.length === 0) return 0;
    return status;
  }

  private resolveJobId(argument: string): number {
    if (argument.startsWith('%')) return Number(argument.slice(1));
    return this.jobIdByPid.get(Number(argument)) ?? -1;
  }
}
