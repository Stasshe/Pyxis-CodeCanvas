import { Buffer } from 'buffer';
import { isProcessExitSignal } from './processExit';

type DataListener = (data: Buffer) => void;
type EndListener = () => void;

export interface RuntimeStdin {
  readonly isTTY: boolean;
  on(event: 'data', listener: DataListener): RuntimeStdin;
  on(event: 'end' | 'close', listener: EndListener): RuntimeStdin;
  once(event: 'data', listener: DataListener): RuntimeStdin;
  once(event: 'end' | 'close', listener: EndListener): RuntimeStdin;
  removeListener(event: 'data', listener: DataListener): RuntimeStdin;
  removeListener(event: 'end' | 'close', listener: EndListener): RuntimeStdin;
  pause(): void;
  resume(): void;
}

export class WorkerStdin implements RuntimeStdin {
  readonly isTTY = true;
  private readonly data = new Set<DataListener>();
  private readonly end = new Set<EndListener>();
  private release: (() => void) | undefined;
  private ended = false;
  private sourceEnded = false;
  private paused = false;
  private readonly queued: Buffer[] = [];

  constructor(
    private readonly track: (promise: Promise<void>) => void,
    private readonly request: () => void,
    private readonly pauseInput: () => void
  ) {}

  on(event: 'data', listener: DataListener): this;
  on(event: 'end' | 'close', listener: EndListener): this;
  on(event: string, listener: DataListener | EndListener): this {
    if (event === 'data') {
      this.data.add(listener as DataListener);
      this.ref();
      queueMicrotask(() => {
        try {
          this.drain();
        } catch (error) {
          if (!isProcessExitSignal(error)) throw error;
        }
      });
    } else if (event === 'end' || event === 'close') {
      this.end.add(listener as EndListener);
    }
    return this;
  }

  once(event: 'data', listener: DataListener): this;
  once(event: 'end' | 'close', listener: EndListener): this;
  once(event: string, listener: DataListener | EndListener): this {
    if (event === 'data') {
      const wrapped: DataListener = chunk => {
        this.removeListener('data', wrapped);
        (listener as DataListener)(chunk);
      };
      return this.on('data', wrapped);
    }
    const wrapped = () => {
      this.end.delete(wrapped);
      (listener as EndListener)();
    };
    return this.on('end', wrapped);
  }

  removeListener(event: 'data', listener: DataListener): this;
  removeListener(event: 'end' | 'close', listener: EndListener): this;
  removeListener(event: string, listener: DataListener | EndListener): this {
    if (event === 'data') {
      this.data.delete(listener as DataListener);
      if (this.data.size === 0) {
        this.pauseInput();
        this.unref();
      }
    } else this.end.delete(listener as EndListener);
    return this;
  }

  submit(data: string | Uint8Array): void {
    if (this.sourceEnded) return;
    this.queued.push(Buffer.from(data));
    this.drain();
  }

  private drain(): void {
    if (this.ended || this.paused) return;
    while (this.data.size > 0 && this.queued.length > 0 && !this.paused) {
      const listener = [...this.data].at(-1)!;
      listener(this.queued.shift()!);
    }
    if (this.sourceEnded && this.queued.length === 0 && !this.paused) {
      this.ended = true;
      for (const listener of [...this.end]) listener();
      this.data.clear();
      this.end.clear();
      this.unref();
    } else if (this.data.size > 0 && !this.paused) this.request();
  }

  eof(): void {
    this.sourceEnded = true;
    this.drain();
  }

  private ref(): void {
    if (this.release || this.ended || this.paused || this.data.size === 0) return;
    this.track(
      new Promise<void>(resolve => {
        this.release = resolve;
      })
    );
  }

  private unref(): void {
    this.release?.();
    this.release = undefined;
  }

  pause(): void {
    this.paused = true;
    this.pauseInput();
    this.unref();
  }

  resume(): void {
    this.paused = false;
    this.ref();
    this.drain();
  }
}
