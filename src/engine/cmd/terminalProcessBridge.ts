/**
 * PTY-like terminal I/O bridge.
 *
 * Terminal feeds completed lines → processStdin stream → readline reads naturally.
 * No callback chain, no Promise/resolve in Terminal, no timing races.
 *
 * Lifecycle:
 *   bridge.activate()       — called before process starts
 *   bridge.submitLine(line) — called by Terminal on Enter
 *   bridge.deactivate()     — called after process exits (sends EOF)
 */

type DataListener = (chunk: Buffer) => void;
type EndListener = () => void;

export class ProcessStdin {
  private _dataListeners: DataListener[] = [];
  private _endListeners: EndListener[] = [];
  _active = false;

  on(event: 'data', fn: DataListener): this;
  on(event: 'end' | 'close', fn: EndListener): this;
  on(event: string, fn: DataListener | EndListener): this {
    if (event === 'data') this._dataListeners.push(fn as DataListener);
    else if (event === 'end' || event === 'close') this._endListeners.push(fn as EndListener);
    return this;
  }

  once(event: 'data', fn: DataListener): this;
  once(event: 'end' | 'close', fn: EndListener): this;
  once(event: string, fn: DataListener | EndListener): this {
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
    if (event === 'data') this._dataListeners = this._dataListeners.filter(f => f !== fn);
    else if (event === 'end' || event === 'close')
      this._endListeners = this._endListeners.filter(f => f !== fn);
    return this;
  }

  /** Terminal calls this when user presses Enter during an active process session.
   * Delivers only to the most recently attached data listener (LIFO).
   * This matches real Node.js stdin behavior where the active readline interface
   * takes exclusive control of input. */
  submitLine(line: string): void {
    if (!this._active) return;
    const buf = Buffer.from(`${line}\n`, 'utf8');
    if (this._dataListeners.length > 0) {
      this._dataListeners[this._dataListeners.length - 1](buf);
    }
  }

  /** Sends EOF — flushes all pending readline reads and fires 'end'/'close' */
  eof(): void {
    this._active = false;
    const end = [...this._endListeners];
    this._dataListeners = [];
    this._endListeners = [];
    for (const fn of end) fn();
  }

  isTTY = true;
  setRawMode(_: boolean) {}
  pause() {}
  resume() {}
}

class TerminalProcessBridge {
  readonly stdin = new ProcessStdin();
  private _onDeactivate: (() => void) | null = null;

  /** Terminal.tsx registers this to reset its interactive line state on deactivation */
  setDeactivateCallback(cb: () => void): void {
    this._onDeactivate = cb;
  }

  /** Called before starting a process (RunPanel / shell builtin) */
  activate(): void {
    this.stdin._active = true;
  }

  /** Called after process exits — sends EOF and resets terminal state */
  deactivate(): void {
    this.stdin.eof();
    this._onDeactivate?.();
  }

  isActive(): boolean {
    return this.stdin._active;
  }

  /** Terminal forwards completed lines here during an active session */
  submitLine(line: string): void {
    this.stdin.submitLine(line);
  }
}

export const terminalProcessBridge = new TerminalProcessBridge();
