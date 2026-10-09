import type { ShellJobIdentity, ShellJobs } from './jobs';
import { Process } from './process';
import type { OutputCallbacks, ShellRunResult } from './types';

interface BackgroundJobTask {
  completion: Promise<ShellRunResult>;
  dispose: () => void;
}

export async function startBackgroundJob(
  jobs: ShellJobs,
  callbacks: OutputCallbacks | undefined,
  start: (pid: number) => Promise<BackgroundJobTask>
): Promise<ShellJobIdentity> {
  const pid = Process.allocatePid();
  const task = await start(pid);
  const completion = task.completion.finally(task.dispose);
  return jobs.add(completion, callbacks, task.dispose, pid);
}
