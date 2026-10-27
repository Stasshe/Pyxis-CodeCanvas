import { PassThrough } from 'node:stream';
import { Buffer } from 'buffer';

type DataListener = (data: Buffer) => void;
type EndListener = () => void;

export interface RuntimeStdin {
  readonly isTTY: boolean;
  setRawMode(enabled: boolean): RuntimeStdin;
  on(event: 'data', listener: DataListener): RuntimeStdin;
  on(event: 'end' | 'close', listener: EndListener): RuntimeStdin;
  once(event: 'data', listener: DataListener): RuntimeStdin;
  once(event: 'end' | 'close', listener: EndListener): RuntimeStdin;
  removeListener(event: 'data', listener: DataListener): RuntimeStdin;
  removeListener(event: 'end' | 'close', listener: EndListener): RuntimeStdin;
  pause(): RuntimeStdin;
  resume(): RuntimeStdin;
}

export class WorkerStdin extends PassThrough implements RuntimeStdin {
  readonly isTTY: boolean;
  private release: (() => void) | undefined;
  private requested = false;
  private ended = false;
  private sourceEnded = false;
  private disposed = false;
  private inputPaused = false;
  private hostPaused = false;
  private hadDataConsumer = false;

  constructor(
    private readonly track: (promise: Promise<void>) => void,
    private readonly request: () => void,
    private readonly pauseInput: () => void,
    private readonly changeRawMode: (enabled: boolean) => void = () => {},
    isTTY = true
  ) {
    super();
    this.isTTY = isTTY;
    this.on('newListener', event => {
      if (event === 'data' || event === 'readable') queueMicrotask(() => this.updateInput());
    });
    this.on('removeListener', event => {
      if (event === 'data' || event === 'readable') this.updateInput();
    });
    this.on('end', () => {
      this.ended = true;
      this.unref();
    });
  }

  setRawMode(enabled: boolean): this {
    if (!this.isTTY) throw new Error('Cannot set raw mode on a non-TTY input stream.');
    this.changeRawMode(enabled);
    return this;
  }

  override pause(): this {
    this.inputPaused = true;
    super.pause();
    this.pauseHost();
    this.unref();
    return this;
  }

  override resume(): this {
    if (this.disposed || this.ended) return this;
    this.inputPaused = false;
    super.resume();
    this.updateInput();
    return this;
  }

  submit(data: string | Uint8Array): void {
    if (this.disposed || this.sourceEnded) return;
    this.requested = false;
    this.write(Buffer.from(data));
    this.updateInput();
  }

  eof(): void {
    if (this.disposed || this.sourceEnded) return;
    this.sourceEnded = true;
    this.requested = false;
    this.end();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pauseInput();
    this.unref();
    this.destroy();
  }

  override _read(size: number): void {
    super._read(size);
    this.updateInput();
  }

  private updateInput(): void {
    if (this.disposed || this.ended) return;
    const dataListeners = this.listenerCount('data');
    const hasConsumer = dataListeners > 0 || this.listenerCount('readable') > 0;
    if (!hasConsumer || this.inputPaused) {
      if (!hasConsumer && this.hadDataConsumer && !this.inputPaused) super.pause();
      this.requested = false;
      this.pauseHost();
      this.unref();
      return;
    }
    if (dataListeners > 0) {
      this.hadDataConsumer = true;
      if (this.listenerCount('readable') === 0 && this.isPaused()) super.resume();
    }
    this.hostPaused = false;
    this.ref();
    if (this.sourceEnded) {
      return;
    }
    if (this.readableLength >= this.readableHighWaterMark) return;
    if (!this.requested) {
      this.requested = true;
      this.request();
    }
  }

  private pauseHost(): void {
    if (this.hostPaused) return;
    this.hostPaused = true;
    this.pauseInput();
  }

  private ref(): void {
    if (this.release || this.ended || this.disposed) return;
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
}
