/**
 * readline module emulation
 *
 * Uses the runtime stdin stream as input.
 * Terminal feeds lines into stdin; readline attaches through its stream listeners.
 * No callback chains, no pseudoStdin, no timing races.
 */

import EventEmitter from 'node:events';
import type { Buffer } from 'buffer';
import type { RuntimeStdin } from '@/engine/system/runtime/nodejs/workerStdin';

interface ReadlineOptions {
  input?: RuntimeStdin | null;
  output?: { write: (text: string) => void } | null;
  terminal?: boolean;
  prompt?: string;
  historySize?: number;
}

class ReadlineInterface extends EventEmitter {
  public input: RuntimeStdin | null;
  public output: { write: (text: string) => void } | null;
  public terminal: boolean;
  public promptStr = '> ';
  private closed = false;
  public history: string[] = [];
  public historySize?: number;
  private _inputBuffer = '';
  private _inputListener?: (chunk: Buffer) => void;
  private _inputEndListener?: () => void;
  protected _lineConsumer?: (line: string) => boolean;
  private lineQueue: string[] = [];
  private iteratorWaiters: Array<(result: IteratorResult<string>) => void> = [];

  constructor(options: ReadlineOptions) {
    super();
    this.input = options.input ?? null;
    this.output = options.output ?? null;
    this.terminal = options.terminal ?? false;
    this.historySize = options.historySize;

    if (options.prompt) {
      this.promptStr = options.prompt;
    }

    if (this.input && typeof this.input.on === 'function') {
      this._attachInputListener();
    }
  }

  protected questionAsync(query: string, signal?: AbortSignal): Promise<string> {
    if (this.closed) return Promise.reject(new Error('The readline interface was closed'));
    if (signal?.aborted) return Promise.reject(createAbortError());
    this.output?.write(query);

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.removeListener('line', onLine);
        this.removeListener('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };
      const onLine = (answer: string) => {
        cleanup();
        resolve(answer);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('The readline interface was closed'));
      };
      const onAbort = () => {
        cleanup();
        reject(createAbortError());
      };

      this.once('line', onLine);
      this.once('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<string> {
    const next = (): Promise<IteratorResult<string>> => {
      const line = this.lineQueue.shift();
      if (line !== undefined) return Promise.resolve({ value: line, done: false });
      if (this.closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise(resolve => this.iteratorWaiters.push(resolve));
    };
    const iterator: AsyncIterableIterator<string> = {
      next,
      return: async () => {
        this.close();
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    const onLine = (line: string) => {
      const waiter = this.iteratorWaiters.shift();
      if (waiter) waiter({ value: line, done: false });
      else this.lineQueue.push(line);
    };
    this.on('line', onLine);
    this.once('close', () => {
      this.removeListener('line', onLine);
      for (const waiter of this.iteratorWaiters.splice(0)) {
        waiter({ value: undefined, done: true });
      }
    });
    return iterator;
  }

  protected _pushHistory(entry: string) {
    if (!entry) return;
    this.history.unshift(entry);
    if (typeof this.historySize === 'number' && this.history.length > this.historySize) {
      this.history.length = this.historySize;
    }
  }

  private _attachInputListener() {
    if (!this.input || !this.input.on) return;
    if (this._inputListener) return;

    this._inputListener = (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '\x03') {
          this.emit('SIGINT');
          continue;
        }
        this._inputBuffer += ch;
        if (ch === '\n' || ch === '\r') {
          const line = this._inputBuffer.replace(/\r?\n$/, '').replace(/\r$/, '');
          this._inputBuffer = '';

          if (this._lineConsumer) {
            const consumed = this._lineConsumer(line);
            if (consumed) continue;
          }

          this.emit('line', line);
        }
      }
    };

    this.input.on('data', this._inputListener);
    this._inputEndListener = () => this.close();
    this.input.on('end', this._inputEndListener);
    this.input.on('close', this._inputEndListener);
  }

  private _detachInputListener() {
    if (!this.input || !this.input.on) return;
    if (this._inputListener) {
      this.input.removeListener('data', this._inputListener);
    }
    if (this._inputEndListener) {
      this.input.removeListener('end', this._inputEndListener);
      this.input.removeListener('close', this._inputEndListener);
      this._inputEndListener = undefined;
    }
    this._inputListener = undefined;
  }

  setPrompt(prompt: string): void {
    this.promptStr = prompt;
  }

  prompt(_preserveCursor?: boolean): void {
    if (!this.closed && this.output && this.output.write) {
      this.output.write(this.promptStr);
    }
  }

  write(data: string): void {
    if (!this.closed && this.output && this.output.write) {
      this.output.write(data);
    }
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this._detachInputListener();
      this.emit('close');
    }
  }
}

export class Interface extends ReadlineInterface {
  question(query: string, callback?: (answer: string) => void): void {
    this.output?.write(query);
    this._lineConsumer = (answer: string) => {
      try {
        if (answer.length > 0) this._pushHistory(answer);
        callback?.(answer);
      } finally {
        this._lineConsumer = undefined;
      }
      return true;
    };
  }
}

export class PromisesInterface extends ReadlineInterface {
  question(query: string, options?: { signal?: AbortSignal }): Promise<string> {
    return this.questionAsync(query, options?.signal);
  }
}

interface WritableTextStream {
  write: (text: string) => unknown;
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return Object.assign(error, { code: 'ABORT_ERR' });
}

const cursorTo = (
  stream: WritableTextStream | null | undefined,
  x: number,
  y?: number
): boolean => {
  if (!stream || !stream.write) return false;
  if (y !== undefined) stream.write(`\x1b[${y + 1};${x + 1}H`);
  else stream.write(`\x1b[${x + 1}G`);
  return true;
};

const moveCursor = (
  stream: WritableTextStream | null | undefined,
  dx: number,
  dy: number
): boolean => {
  if (!stream || !stream.write) return false;
  if (dy !== 0) stream.write(`\x1b[${Math.abs(dy)}${dy > 0 ? 'B' : 'A'}`);
  if (dx !== 0) stream.write(`\x1b[${Math.abs(dx)}${dx > 0 ? 'C' : 'D'}`);
  return true;
};

const clearLine = (stream: WritableTextStream | null | undefined, dir = 0): boolean => {
  if (!stream || !stream.write) return false;
  if (dir < 0) stream.write('\x1b[1K');
  else if (dir > 0) stream.write('\x1b[0K');
  else stream.write('\x1b[2K');
  return true;
};

const clearScreenDown = (stream: WritableTextStream | null | undefined): boolean => {
  if (!stream || !stream.write) return false;
  stream.write('\x1b[0J');
  return true;
};

/**
 * @param processStdin  — ProcessStdin instance from terminalProcessBridge
 * @param getTrackIO    — lazy getter so waitForEventLoop can track readline sessions
 */
export function createReadlineModule(
  processStdin?: RuntimeStdin,
  getTrackIO?: () => ((p: Promise<void>) => void) | undefined
) {
  return {
    createInterface: (options: ReadlineOptions): Interface => {
      // Use explicitly provided input stream, or fall back to processStdin
      const input = options.input ?? processStdin ?? null;

      const iface = new Interface({ ...options, input });

      // Track this readline session so waitForEventLoop waits for it to close
      const trackIO = getTrackIO?.();
      if (trackIO && input !== null) {
        trackIO(new Promise<void>(resolve => iface.once('close', () => resolve())));
      }

      return iface;
    },
    Interface,
    cursorTo,
    moveCursor,
    clearLine,
    clearScreenDown,
  };
}

export function createReadlinePromisesModule(
  processStdin?: RuntimeStdin,
  getTrackIO?: () => ((p: Promise<void>) => void) | undefined
) {
  return {
    createInterface(options: ReadlineOptions): PromisesInterface {
      const input = options.input ?? processStdin ?? null;
      const iface = new PromisesInterface({ ...options, input });
      const trackIO = getTrackIO?.();
      if (trackIO && input !== null) {
        trackIO(new Promise<void>(resolve => iface.once('close', resolve)));
      }
      return iface;
    },
    Interface: PromisesInterface,
  };
}
