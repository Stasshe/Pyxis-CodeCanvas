import { isProcessExitSignal } from './processExit';
import { nativeQueueMicrotask } from './runtimeGlobals';
import type { ProcessListener, RuntimeTimer } from './runtimeTypes';

interface RuntimeTaskSchedulerOptions {
  activeTasks: Set<object>;
  cancelTasks: Map<object, () => void>;
  canRun: () => boolean;
  onMicrotaskChange: (change: number) => void;
  checkEventLoop: () => void;
  finalizeProcessExit: (code: number) => void;
}

export class RuntimeTaskScheduler {
  private nextTicks: VoidFunction[] = [];
  private nextTickScheduled = false;

  constructor(private readonly options: RuntimeTaskSchedulerOptions) {}

  scheduleMicrotask(callback: VoidFunction): void {
    if (!this.options.canRun()) return;
    this.options.onMicrotaskChange(1);
    nativeQueueMicrotask(() => {
      try {
        if (this.options.canRun()) callback();
      } finally {
        this.options.onMicrotaskChange(-1);
        this.options.checkEventLoop();
      }
    });
  }

  scheduleNextTick(callback: VoidFunction): void {
    if (!this.options.canRun()) return;
    this.nextTicks.push(callback);
    this.options.onMicrotaskChange(1);
    if (this.nextTickScheduled) return;

    this.nextTickScheduled = true;
    nativeQueueMicrotask(() => this.drainNextTicks());
  }

  private drainNextTicks(): void {
    try {
      while (this.nextTicks.length > 0) {
        const callback = this.nextTicks.shift();
        if (!callback) continue;
        try {
          if (this.options.canRun()) callback();
        } finally {
          this.options.onMicrotaskChange(-1);
        }
      }
    } finally {
      this.nextTickScheduled = false;
      if (this.nextTicks.length > 0) {
        this.nextTickScheduled = true;
        nativeQueueMicrotask(() => this.drainNextTicks());
      }
      this.options.checkEventLoop();
    }
  }

  createImmediate(handler: ProcessListener, args: unknown[] = []): RuntimeTimer {
    if (!this.options.canRun()) {
      const timer: RuntimeTimer = {
        ref: () => timer,
        unref: () => timer,
        hasRef: () => false,
        [Symbol.toPrimitive]: () => 0,
      };
      return timer;
    }

    const channel = new MessageChannel();
    const immediate: RuntimeTimer = {
      ref: () => {
        this.options.activeTasks.add(immediate);
        return immediate;
      },
      unref: () => {
        this.options.activeTasks.delete(immediate);
        this.options.checkEventLoop();
        return immediate;
      },
      hasRef: () => this.options.activeTasks.has(immediate),
      [Symbol.toPrimitive]: () => 0,
    };

    channel.port1.onmessage = () => {
      this.options.activeTasks.delete(immediate);
      this.options.cancelTasks.delete(immediate);
      channel.port1.close();
      channel.port2.close();
      try {
        if (this.options.canRun()) handler(...args);
      } catch (error) {
        if (isProcessExitSignal(error)) this.options.finalizeProcessExit(error.code);
        else throw error;
      } finally {
        this.options.checkEventLoop();
      }
    };
    this.options.cancelTasks.set(immediate, () => {
      channel.port1.close();
      channel.port2.close();
    });
    this.options.activeTasks.add(immediate);
    channel.port2.postMessage(undefined);
    return immediate;
  }
}
