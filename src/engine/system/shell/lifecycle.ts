import { Buffer } from 'buffer';
import { coreError } from '@/engine/core/coreLogger';
import { Process } from './process';
import type { ShellRunResult } from './types';

interface ChildShell {
  killForeground(signal: string): void;
  dispose?(): void;
}

interface Subshell extends ChildShell {
  dispose(): void;
}

export class ShellLifecycle {
  private scriptDepth = 0;
  private children = new Set<ChildShell>();
  private interruptedChildren = new Set<ChildShell>();
  private detachedProcesses = new Set<Process>();

  get insideScript(): boolean {
    return this.scriptDepth > 0;
  }

  async runScript(execute: () => Promise<number>): Promise<number> {
    this.scriptDepth++;
    try {
      return await execute();
    } finally {
      this.scriptDepth--;
    }
  }

  trackChild(child: ChildShell, tracked: boolean): void {
    if (tracked) this.children.add(child);
    else {
      this.children.delete(child);
      this.interruptedChildren.delete(child);
    }
  }

  trackDetachedProcess(process: Process, completion: Promise<void>): void {
    this.detachedProcesses.add(process);
    void completion.then(
      () => this.detachedProcesses.delete(process),
      error => {
        this.detachedProcesses.delete(process);
        const message = error instanceof Error ? error.message : String(error);
        if (process.hasExited) {
          coreError('[ShellLifecycle] Detached child failed after process exit:', message);
          return;
        }
        process.writeStderr(`Child command failed: ${message}\n`);
        process.exit(1);
      }
    );
  }

  interruptChildren(signal: string): void {
    for (const child of this.children) {
      if (signal === 'SIGINT') this.interruptedChildren.add(child);
      child.killForeground(signal);
    }
  }

  killForeground(
    signal: string,
    active: boolean,
    processes: Set<Process>,
    hasForegroundProcess: boolean,
    setPendingSignal: (signal: string | null) => void
  ): void {
    if (!active && processes.size === 0 && !this.insideScript) return;
    setPendingSignal(signal);
    for (const process of processes) process.kill(signal);
    this.interruptChildren(signal);
    if (hasForegroundProcess) setPendingSignal(null);
  }

  dispose(
    cancelJobs: () => void,
    processes: Set<Process>,
    abortSignal?: AbortSignal,
    abortListener?: () => void
  ): void {
    cancelJobs();
    if (abortSignal && abortListener) abortSignal.removeEventListener('abort', abortListener);
    for (const child of this.children) {
      child.killForeground('SIGTERM');
      child.dispose?.();
    }
    this.children.clear();
    this.interruptedChildren.clear();
    for (const process of processes) {
      process.kill('SIGTERM');
      process.exit(null, 'SIGTERM');
    }
    processes.clear();
    for (const process of this.detachedProcesses) process.kill('SIGTERM');
  }

  async runChildScript(
    child: Subshell,
    process: Process,
    execute: () => Promise<number>
  ): Promise<number> {
    const forwardSignal = (signal: string) => child.killForeground(signal);
    const unsubscribeSignal = process.handleSignal(forwardSignal);
    try {
      return await execute();
    } finally {
      unsubscribeSignal();
      child.dispose();
    }
  }

  async captureSubshell(
    child: Subshell,
    execute: (process: Process) => Promise<number>,
    pendingSignal: string | null
  ): Promise<ShellRunResult> {
    const process = new Process();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    process.stdout.on('data', (chunk: Buffer | string) => stdout.push(Buffer.from(chunk)));
    process.stderr.on('data', (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    this.trackChild(child, true);
    try {
      const completion = execute(process);
      if (pendingSignal) {
        if (pendingSignal === 'SIGINT') this.interruptedChildren.add(child);
        child.killForeground(pendingSignal);
      }
      const code = await completion;
      return {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
        interrupted: this.interruptedChildren.has(child),
      };
    } finally {
      this.trackChild(child, false);
      process.exit();
      child.dispose();
    }
  }
}
