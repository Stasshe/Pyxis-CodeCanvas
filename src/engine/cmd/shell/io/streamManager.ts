/**
 * Stream Manager
 * Manages standard streams (stdin, stdout, stderr) for command execution.
 */

import { PassThrough, type Readable, type Writable } from 'stream';

import type { IStreamManager } from '../providers/types';

/**
 * Redirection Type
 */
export enum RedirectionType {
  OUTPUT = 'output', // >
  APPEND = 'append', // >>
  INPUT = 'input', // <
  HERE_DOC = 'here-doc', // <<
  HERE_STRING = 'here-string', // <<<
  DUPLICATE = 'duplicate', // >&, <&
}

/**
 * Redirection specification
 */
export interface Redirection {
  /** File descriptor (0=stdin, 1=stdout, 2=stderr) */
  fd: number;
  /** Redirection type */
  type: RedirectionType;
  /** Filename or content */
  target: string;
  /** For duplicate: target fd */
  targetFd?: number;
}

/**
 * Stream Manager Implementation
 */
export class StreamManager implements IStreamManager {
  private _stdin: PassThrough;
  private _stdout: PassThrough;
  private _stderr: PassThrough;

  // Map of additional file-descriptor write streams
  private fdMap: Map<number, PassThrough>;

  constructor(
    stdin?: Readable,
    stdout?: Writable,
    stderr?: Writable
  ) {
    this._stdin = stdin instanceof PassThrough ? stdin : new PassThrough();
    this._stdout = stdout instanceof PassThrough ? stdout : new PassThrough();
    this._stderr = stderr instanceof PassThrough ? stderr : new PassThrough();

    // Initialize fd map
    this.fdMap = new Map();
    this.fdMap.set(0, this._stdin);
    this.fdMap.set(1, this._stdout);
    this.fdMap.set(2, this._stderr);

    // If external streams were provided, pipe our internal streams to them
    if (stdin && !(stdin instanceof PassThrough)) {
      (stdin as any).pipe?.(this._stdin);
    }
    if (stdout && !(stdout instanceof PassThrough)) {
      this._stdout.pipe(stdout);
    }
    if (stderr && !(stderr instanceof PassThrough)) {
      this._stderr.pipe(stderr);
    }
  }

  get stdin(): Readable {
    return this._stdin;
  }

  get stdout(): Writable {
    return this._stdout;
  }

  get stderr(): Writable {
    return this._stderr;
  }

  /**
   * Get stream for a specific file descriptor
   */
  getFd(fd: number): PassThrough {
    if (!this.fdMap.has(fd)) {
      const stream = new PassThrough();
      this.fdMap.set(fd, stream);
    }
    return this.fdMap.get(fd)!;
  }

  /**
   * Set stream for a specific file descriptor
   */
  setFd(fd: number, stream: PassThrough): void {
    this.fdMap.set(fd, stream);

    // Update convenience references
    if (fd === 0) {
      this._stdin = stream;
    } else if (fd === 1) {
      this._stdout = stream;
    } else if (fd === 2) {
      this._stderr = stream;
    }
  }

  /**
   * Duplicate fd 'from' to 'to' (e.g., 2>&1)
   */
  duplicateFd(from: number, to: number): void {
    const targetStream = this.getFd(to);
    this.fdMap.set(from, targetStream);

    // Update convenience references
    if (from === 1) {
      this._stdout = targetStream;
    } else if (from === 2) {
      this._stderr = targetStream;
    }
  }

  /**
   * Write to stdout
   */
  async writeStdout(data: string | Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const chunk = typeof data === 'string' ? data : data.toString();
      const ok = this._stdout.write(chunk, err => {
        if (err) reject(err);
        else resolve();
      });
      if (ok) resolve();
    });
  }

  /**
   * Write to stderr
   */
  async writeStderr(data: string | Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const chunk = typeof data === 'string' ? data : data.toString();
      const ok = this._stderr.write(chunk, err => {
        if (err) reject(err);
        else resolve();
      });
      if (ok) resolve();
    });
  }

  /**
   * Write to a specific file descriptor
   */
  async writeFd(fd: number, data: string | Buffer): Promise<void> {
    const stream = this.getFd(fd);
    return new Promise((resolve, reject) => {
      const chunk = typeof data === 'string' ? data : data.toString();
      const ok = stream.write(chunk, err => {
        if (err) reject(err);
        else resolve();
      });
      if (ok) resolve();
    });
  }

  /**
   * End stdout stream
   */
  endStdout(): void {
    try {
      this._stdout.end();
    } catch (e) {
      // Ignore errors on already closed streams
    }
  }

  /**
   * End stderr stream
   */
  endStderr(): void {
    try {
      this._stderr.end();
    } catch (e) {
      // Ignore errors on already closed streams
    }
  }

  /**
   * End stdin stream
   */
  endStdin(): void {
    try {
      this._stdin.end();
    } catch (e) {
      // Ignore errors on already closed streams
    }
  }

  /**
   * End all streams
   */
  endAll(): void {
    this.endStdin();
    this.endStdout();
    this.endStderr();

    // End any additional fd streams
    for (const [fd, stream] of this.fdMap.entries()) {
      if (fd > 2) {
        try {
          stream.end();
        } catch (e) {
          // Ignore
        }
      }
    }
  }

  /**
   * Read all data from stdin
   */
  async readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];
      
      this._stdin.on('data', chunk => {
        chunks.push(String(chunk));
      });

      this._stdin.on('end', () => {
        resolve(chunks.join(''));
      });

      this._stdin.on('error', err => {
        reject(err);
      });

      // If stdin is already ended, resolve immediately
      if ((this._stdin as any).readableEnded) {
        resolve(chunks.join(''));
      }
    });
  }

  /**
   * Pipe stdin to a target stream
   */
  pipeStdinTo(target: Writable): void {
    this._stdin.pipe(target);
  }

  /**
   * Pipe stdout from a source stream
   */
  pipeToStdout(source: Readable): void {
    source.pipe(this._stdout);
  }

  /**
   * Pipe stderr from a source stream
   */
  pipeToStderr(source: Readable): void {
    source.pipe(this._stderr);
  }

  /**
   * Create a child stream manager for piping
   */
  createPipeChild(): StreamManager {
    const childStdin = new PassThrough();
    const childStdout = new PassThrough();
    const childStderr = new PassThrough();

    // Pipe our stdout to child's stdin
    this._stdout.pipe(childStdin);

    return new StreamManager(childStdin, childStdout, childStderr);
  }

  /**
   * Collect all stdout data
   */
  collectStdout(): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];

      this._stdout.on('data', chunk => {
        chunks.push(String(chunk));
      });

      this._stdout.on('end', () => {
        resolve(chunks.join(''));
      });

      this._stdout.on('error', err => {
        reject(err);
      });

      // If stdout is already ended, resolve with empty
      if ((this._stdout as any).readableEnded) {
        resolve(chunks.join(''));
      }
    });
  }

  /**
   * Collect all stderr data
   */
  collectStderr(): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];

      this._stderr.on('data', chunk => {
        chunks.push(String(chunk));
      });

      this._stderr.on('end', () => {
        resolve(chunks.join(''));
      });

      this._stderr.on('error', err => {
        reject(err);
      });

      // If stderr is already ended, resolve with empty
      if ((this._stderr as any).readableEnded) {
        resolve(chunks.join(''));
      }
    });
  }
}

/**
 * Create a new stream manager
 */
export function createStreamManager(
  stdin?: Readable,
  stdout?: Writable,
  stderr?: Writable
): StreamManager {
  return new StreamManager(stdin, stdout, stderr);
}

/**
 * Create a null stream manager (for discarding output)
 */
export function createNullStreamManager(): StreamManager {
  const nullStream = new PassThrough();
  nullStream.on('data', () => {}); // Discard all data
  return new StreamManager(nullStream, nullStream, nullStream);
}
