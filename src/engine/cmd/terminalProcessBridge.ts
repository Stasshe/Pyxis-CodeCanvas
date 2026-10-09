/** Process-scoped input with an exclusive terminal routing lease. */
import type { Readable, Writable } from 'node:stream';
import { Buffer } from 'buffer';

type DataListener = (chunk: Buffer) => void;
type EndListener = () => void;
type SourceListener = {
  event: string;
  handler: DataListener | EndListener;
  listener: DataListener;
};

export class ProcessStdin {
  private _dataListeners: DataListener[] = [];
  private _endListeners: EndListener[] = [];
  private interruptListeners = new Set<() => void>();
  private readonly sourceListeners = new Set<SourceListener>();
  _active = false;

  constructor(
    private readonly source?: Readable,
    isTTY = source === undefined,
    private readonly destination?: Writable
  ) {
    this.isTTY = isTTY;
    if (source) {
      this._active = !source.readableEnded;
    }
  }

  on(event: 'data', fn: DataListener): this;
  on(event: 'end' | 'close', fn: EndListener): this;
  on(event: string, fn: DataListener | EndListener): this {
    if (this.source) {
      this.listenToSource(event, fn, false);
      return this;
    }
    if (event === 'data') this._dataListeners.push(fn as DataListener);
    else if (event === 'end' || event === 'close') this._endListeners.push(fn as EndListener);
    return this;
  }

  once(event: 'data', fn: DataListener): this;
  once(event: 'end' | 'close', fn: EndListener): this;
  once(event: string, fn: DataListener | EndListener): this {
    if (this.source) {
      this.listenToSource(event, fn, true);
      return this;
    }
    if (event === 'data') {
      const w: DataListener = (chunk: Buffer) => {
        this._dataListeners = this._dataListeners.filter(f => f !== w);
        (fn as DataListener)(chunk);
      };
      this._dataListeners.push(w);
    } else {
      const w: EndListener = () => {
        this._endListeners = this._endListeners.filter(f => f !== w);
        (fn as EndListener)();
      };
      this._endListeners.push(w);
    }
    return this;
  }

  removeListener(event: 'data', fn: DataListener): this;
  removeListener(event: 'end' | 'close', fn: EndListener): this;
  removeListener(event: string, fn: DataListener | EndListener): this {
    if (this.source) {
      for (const registration of this.sourceListeners) {
        if (registration.event !== event || registration.handler !== fn) continue;
        this.source.removeListener(event, registration.listener);
        this.sourceListeners.delete(registration);
      }
      return this;
    }
    if (event === 'data') this._dataListeners = this._dataListeners.filter(f => f !== fn);
    else if (event === 'end' || event === 'close')
      this._endListeners = this._endListeners.filter(f => f !== fn);
    return this;
  }

  private rawMode = false;
  private inputVersion = 0;

  private listenToSource(event: string, handler: DataListener | EndListener, once: boolean): void {
    const source = this.source;
    if (!source) return;
    const registration: SourceListener = {
      event,
      handler,
      listener: chunk => {
        if (!this.sourceListeners.has(registration)) return;
        if (once) {
          source.removeListener(event, registration.listener);
          this.sourceListeners.delete(registration);
        }
        if (event === 'data') {
          (handler as DataListener)(chunk);
          return;
        }
        (handler as EndListener)();
      },
    };
    this.sourceListeners.add(registration);
    if ((event === 'end' || event === 'close') && source.readableEnded) {
      queueMicrotask(() => {
        if (!this.sourceListeners.delete(registration)) return;
        (handler as EndListener)();
      });
      return;
    }
    source.on(event, registration.listener);
  }

  /** Terminal calls this when user presses Enter during an active process session. */
  submitLine(line: string): void {
    this.submitData(`${line}\n`);
  }

  submitData(data: string): void {
    if (!this._active) return;
    const buf = Buffer.from(data, 'utf8');
    if (this.destination) {
      if (!this.destination.writableEnded && !this.destination.destroyed) {
        this.destination.write(buf);
      }
      return;
    }
    for (const listener of [...this._dataListeners]) listener(buf);
  }

  /** Sends EOF — flushes all pending readline reads and fires 'end'/'close' */
  eof(): void {
    if (this.destination && !this.destination.writableEnded) this.destination.end();
    if (this.source) {
      this.inputVersion += 1;
      this._active = false;
      this.rawMode = false;
      return;
    }
    this.endSession();
  }

  /** Release this adapter without closing an inherited input destination. */
  endSession(): void {
    this.inputVersion += 1;
    this._active = false;
    this.rawMode = false;
    for (const registration of this.sourceListeners) {
      this.source?.removeListener(registration.event, registration.listener);
    }
    this.sourceListeners.clear();
    const end = [...this._endListeners];
    this._dataListeners = [];
    this._endListeners = [];
    this.interruptListeners.clear();
    for (const fn of end) fn();
  }

  isTTY = true;
  setRawMode(enabled: boolean): this {
    if (!this.isTTY) throw new Error('Cannot set raw mode on a non-TTY input stream.');
    if (this.rawMode !== enabled) this.inputVersion += 1;
    this.rawMode = enabled;
    return this;
  }

  beginSession(): void {
    this.inputVersion += 1;
    this._active = true;
  }

  subscribeInterrupt(handler: () => void): () => void {
    this.interruptListeners.add(handler);
    return () => this.interruptListeners.delete(handler);
  }

  interrupt(): void {
    for (const handler of [...this.interruptListeners]) handler();
  }

  get isRaw(): boolean {
    return this.rawMode;
  }

  get sessionVersion(): number {
    return this.inputVersion;
  }
  pause() {
    this.source?.pause();
  }
  resume() {
    this.source?.resume();
  }
}

export interface TerminalInputLease {
  readonly stdin: ProcessStdin;
  release(): void;
}

class TerminalProcessBridge {
  private readonly idleInput = new ProcessStdin();
  private readonly sessions = new Map<symbol, ProcessStdin>();
  private owner: symbol | null = null;
  private ownerVersion = 0;
  private _onDeactivate: (() => void) | null = null;

  get stdin(): ProcessStdin {
    if (this.owner) {
      const input = this.sessions.get(this.owner);
      if (input) return input;
    }
    return this.idleInput;
  }

  get sessionVersion(): string {
    return `${this.ownerVersion}:${this.stdin.sessionVersion}`;
  }

  /** Terminal.tsx registers this to reset its interactive line state on deactivation */
  setDeactivateCallback(cb: () => void): () => void {
    this._onDeactivate = cb;
    return () => {
      if (this._onDeactivate === cb) this._onDeactivate = null;
    };
  }

  activate(stdin: ProcessStdin): TerminalInputLease {
    if (!stdin.isTTY) throw new Error('Terminal input requires a TTY stream.');
    const token = Symbol('terminal-input');
    this.sessions.set(token, stdin);
    this.owner = token;
    this.ownerVersion += 1;
    stdin.beginSession();
    this._onDeactivate?.();
    return {
      stdin,
      release: () => {
        if (!this.sessions.delete(token)) return;
        stdin.endSession();
        if (this.owner !== token) return;
        this.owner = null;
        for (const [candidate, input] of this.sessions) {
          if (input._active) this.owner = candidate;
        }
        this.ownerVersion += 1;
        this._onDeactivate?.();
      },
    };
  }

  isActive(): boolean {
    return this.stdin._active;
  }

  /** Terminal forwards completed lines here during an active session */
  submitLine(line: string): void {
    this.stdin.submitLine(line);
  }

  submitData(data: string): void {
    this.stdin.submitData(data);
  }
}

export const terminalProcessBridge = new TerminalProcessBridge();
