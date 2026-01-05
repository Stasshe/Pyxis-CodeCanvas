/**
 * TerminalOutputManager - Centralized terminal output management
 *
 * This module provides a unified, systematic approach to terminal output
 * management, inspired by Linux/Windows terminal behavior. It tracks cursor
 * position and ensures proper newline handling across all output scenarios.
 *
 * Design Principles:
 * 1. Single responsibility: All terminal writes go through this manager
 * 2. Automatic cursor tracking: No manual state management needed
 * 3. Consistent newline behavior: Follows POSIX terminal conventions
 * 4. Buffer management: Prevents race conditions in async output
 *
 * Usage:
 *   const manager = new TerminalOutputManager(term);
 *   await manager.write('Hello');
 *   await manager.writeln('World');
 *   await manager.ensureNewline(); // Before showing prompt
 */

export interface IXTermInstance {
  write(data: string, callback?: () => void): void;
  writeln(data: string): void;
  buffer: {
    active: {
      cursorX: number;
      cursorY: number;
    };
  };
}

/**
 * Centralized terminal output manager with cursor position tracking
 */
export class TerminalOutputManager {
  private term: IXTermInstance;
  private writeQueue: Array<{ data: string; callback?: () => void }> = [];
  private isWriting = false;
  private lastWriteEndedWithNewline = true;

  constructor(term: IXTermInstance) {
    this.term = term;
  }

  /**
   * Check if cursor is at the start of a line (column 0)
   * This is the Linux/Windows terminal standard way
   */
  private isAtLineStart(): boolean {
    try {
      return this.term.buffer.active.cursorX === 0;
    } catch {
      // Fallback: use tracked state if buffer access fails
      return this.lastWriteEndedWithNewline;
    }
  }

  /**
   * Normalize line endings: convert \n to \r\n for xterm.js
   * This follows terminal emulator conventions
   */
  private normalizeLineEndings(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
  }

  /**
   * Track if text ends with newline
   */
  private updateNewlineState(text: string): void {
    // Check original text (before normalization) for \n
    this.lastWriteEndedWithNewline = text.endsWith('\n');
  }

  /**
   * Process write queue sequentially to prevent race conditions
   */
  private flushQueue(): void {
    if (this.isWriting || this.writeQueue.length === 0) {
      return;
    }

    this.isWriting = true;
    const { data, callback } = this.writeQueue.shift()!;

    this.term.write(data, () => {
      this.isWriting = false;
      if (callback) callback();
      this.flushQueue(); // Process next item
    });
  }

  /**
   * Write text to terminal (asynchronous, queued)
   * @param text Text to write (can contain \n)
   * @returns Promise that resolves when write completes
   */
  write(text: string): Promise<void> {
    return new Promise((resolve) => {
      const normalized = this.normalizeLineEndings(text);
      this.updateNewlineState(text);

      this.writeQueue.push({
        data: normalized,
        callback: resolve,
      });

      this.flushQueue();
    });
  }

  /**
   * Write text followed by newline
   * @param text Text to write
   * @returns Promise that resolves when write completes
   */
  writeln(text: string): Promise<void> {
    return this.write(`${text}\n`);
  }

  /**
   * Write raw data without normalization (for ANSI sequences, etc)
   * @param data Raw data to write
   * @returns Promise that resolves when write completes
   */
  writeRaw(data: string): Promise<void> {
    return new Promise((resolve) => {
      // Don't normalize, don't track newline state for raw writes
      this.writeQueue.push({
        data,
        callback: resolve,
      });

      this.flushQueue();
    });
  }

  /**
   * Ensure we're at the start of a new line
   * This is critical before showing prompts to prevent overlap
   * Follows Linux/Windows terminal conventions
   *
   * @returns Promise that resolves when operation completes
   */
  async ensureNewline(): Promise<void> {
    if (!this.isAtLineStart()) {
      await this.write('\n');
    }
  }

  /**
   * Get current cursor position state
   */
  getCursorState(): { atLineStart: boolean; x: number; y: number } {
    try {
      const cursor = this.term.buffer.active;
      return {
        atLineStart: cursor.cursorX === 0,
        x: cursor.cursorX,
        y: cursor.cursorY,
      };
    } catch {
      return {
        atLineStart: this.lastWriteEndedWithNewline,
        x: 0,
        y: 0,
      };
    }
  }

  /**
   * Clear any pending writes (useful for cleanup)
   */
  clearQueue(): void {
    this.writeQueue = [];
  }

  /**
   * Wait for all pending writes to complete
   */
  async flush(): Promise<void> {
    return new Promise((resolve) => {
      if (this.writeQueue.length === 0 && !this.isWriting) {
        resolve();
        return;
      }

      // Add a marker write to know when queue is done
      this.writeQueue.push({
        data: '',
        callback: resolve,
      });

      this.flushQueue();
    });
  }
}

/**
 * Factory function to create a terminal output manager
 */
export function createTerminalOutputManager(term: IXTermInstance): TerminalOutputManager {
  return new TerminalOutputManager(term);
}

export default TerminalOutputManager;
