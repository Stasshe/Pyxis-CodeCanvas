/**
 * readline module emulation
 *
 * Uses a processStdin stream (ProcessStdin) as input.
 * Terminal feeds lines into processStdin; readline attaches via _attachInputListener naturally.
 * No callback chains, no pseudoStdin, no timing races.
 */

import type { ProcessStdin } from '@/engine/cmd/terminalProcessBridge';

interface ReadlineOptions {
  input?: ProcessStdin | null;
  output?: { write: (text: string) => void } | null;
  terminal?: boolean;
  prompt?: string;
  historySize?: number;
}

class Interface {
  public input: ProcessStdin | null;
  public output: { write: (text: string) => void } | null;
  public terminal: boolean;
  public promptStr = '> ';
  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  private closed = false;
  public history: string[] = [];
  public historySize?: number;
  private _inputBuffer = '';
  private _inputListener?: (chunk: Buffer) => void;
  private _lineConsumer?: (line: string) => boolean;

  constructor(options: ReadlineOptions) {
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

  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
    return this;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const onceWrapper = (...args: unknown[]) => {
      listener(...args);
      this.removeListener(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this.listeners[event];
    if (listeners && listeners.length > 0) {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      }
      return true;
    }
    return false;
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners[event];
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    }
    return this;
  }

  question(query: string, callback?: (answer: string) => void): void {
    if (this.output?.write) {
      this.output.write(query);
    }

    this._lineConsumer = (answer: string) => {
      try {
        if (typeof answer === 'string' && answer.length > 0) this._pushHistory(answer);
        if (callback) callback(answer);
      } finally {
        this._lineConsumer = undefined;
      }
      return true;
    };
  }

  private _pushHistory(entry: string) {
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
      try {
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

            try {
              if (this._lineConsumer) {
                const consumed = this._lineConsumer(line);
                if (consumed) continue;
              }
            } catch (err) {
              console.error('Error in line consumer:', err);
            }

            this.emit('line', line);
          }
        }
      } catch (err) {
        console.error('Error parsing input chunk for readline:', err);
      }
    };

    this.input.on('data', this._inputListener);
    const onEnd = () => this.close();
    this.input.on('end', onEnd);
    this.input.on('close', onEnd);
  }

  private _detachInputListener() {
    if (!this.input || !this.input.on || !this._inputListener) return;
    this.input.removeListener('data', this._inputListener);
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

const cursorTo = (stream: any, x: number, y?: number): boolean => {
  if (!stream || !stream.write) return false;
  if (y !== undefined) stream.write(`\x1b[${y + 1};${x + 1}H`);
  else stream.write(`\x1b[${x + 1}G`);
  return true;
};

const moveCursor = (stream: any, dx: number, dy: number): boolean => {
  if (!stream || !stream.write) return false;
  if (dy !== 0) stream.write(`\x1b[${Math.abs(dy)}${dy > 0 ? 'B' : 'A'}`);
  if (dx !== 0) stream.write(`\x1b[${Math.abs(dx)}${dx > 0 ? 'C' : 'D'}`);
  return true;
};

const clearLine = (stream: any, dir = 0): boolean => {
  if (!stream || !stream.write) return false;
  if (dir < 0) stream.write('\x1b[1K');
  else if (dir > 0) stream.write('\x1b[0K');
  else stream.write('\x1b[2K');
  return true;
};

const clearScreenDown = (stream: any): boolean => {
  if (!stream || !stream.write) return false;
  stream.write('\x1b[0J');
  return true;
};

/**
 * @param processStdin  — ProcessStdin instance from terminalProcessBridge
 * @param getTrackIO    — lazy getter so waitForEventLoop can track readline sessions
 */
export function createReadlineModule(
  processStdin?: ProcessStdin,
  getTrackIO?: () => ((p: Promise<void>) => void) | undefined
) {
  return {
    createInterface: (options: ReadlineOptions): Interface => {
      // Use explicitly provided input stream, or fall back to processStdin
      const input: ProcessStdin | null =
        options.input && typeof options.input.on === 'function'
          ? (options.input as ProcessStdin)
          : (processStdin ?? null);

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
