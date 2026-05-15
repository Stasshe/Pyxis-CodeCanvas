/**
 * Minimal Node.js 'tty' module implementation.
 *
 * CLI packages usually use this for color and terminal capability detection.
 */

export function createTTYModule(columns = 80, rows = 24) {
  const ttyColumns = columns;
  const ttyRows = rows;

  class ReadStream {
    isTTY = true;

    setRawMode() {
      return this;
    }
  }

  class WriteStream {
    isTTY = true;
    columns = ttyColumns;
    rows = ttyRows;

    getColorDepth() {
      return 24;
    }

    hasColors(count?: number) {
      return count === undefined || count <= 16777216;
    }

    write() {
      return true;
    }
  }

  return {
    isatty: (fd: unknown) => fd === 0 || fd === 1 || fd === 2,
    ReadStream,
    WriteStream,
  };
}
