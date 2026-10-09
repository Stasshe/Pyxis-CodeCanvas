import { Readable, Writable } from 'node:stream';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import { creationMode } from './fsPermissions';

export interface FsStreamOptions {
  encoding?: BufferEncoding;
  end?: number;
  flags?: string;
  highWaterMark?: number;
  mode?: number | string;
  start?: number;
}

type IoTracker = <T>(task: Promise<T>) => Promise<T>;

function tracked<T>(task: Promise<T>, tracker?: IoTracker): Promise<T> {
  if (!tracker) return task;
  return tracker(task);
}

function asError(value: Error | string): Error {
  if (value instanceof Error) return value;
  return new Error(value);
}

function validateReadOptions(options: FsStreamOptions): void {
  if (options.flags && options.flags !== 'r' && options.flags !== 'rs') {
    throw new TypeError(`Unsupported read stream flags: ${options.flags}`);
  }
  if (options.start !== undefined && (!Number.isInteger(options.start) || options.start < 0)) {
    throw new RangeError('The start option must be a non-negative integer.');
  }
  if (options.end !== undefined && (!Number.isInteger(options.end) || options.end < 0)) {
    throw new RangeError('The end option must be a non-negative integer.');
  }
  if (options.start !== undefined && options.end !== undefined && options.start > options.end) {
    throw new RangeError('The start option must not exceed the end option.');
  }
}

function validateWriteOptions(options: FsStreamOptions): void {
  const flags = options.flags ?? 'w';
  if (flags !== 'w' && flags !== 'a' && flags !== 'wx' && flags !== 'ax' && flags !== 'r+') {
    throw new TypeError(`Unsupported write stream flags: ${flags}`);
  }
  if (options.start !== undefined && (!Number.isInteger(options.start) || options.start < 0)) {
    throw new RangeError('The start option must be a non-negative integer.');
  }
  if (options.mode !== undefined) creationMode(options.mode);
}

export function createReadStream(
  filesystem: RuntimeFsMount,
  path: string,
  options: FsStreamOptions = {},
  tracker?: IoTracker
): Readable {
  validateReadOptions(options);
  const endpointId = crypto.randomUUID();
  let isFifo = false;
  let chunkSource: Uint8Array | undefined;
  let initialized = false;
  let offset = options.start ?? 0;
  let reading = false;
  let closed = false;
  let fifoReleased = false;

  const stream = new Readable({
    highWaterMark: options.highWaterMark,
    read(size) {
      if (reading || closed) return;
      reading = true;
      const operation = async (): Promise<void> => {
        try {
          if (!initialized) {
            const stat = await filesystem.stat(path);
            if (closed) return;
            if (!stat) {
              throw Object.assign(new Error(`ENOENT: open '${path}'`), { code: 'ENOENT' });
            }
            isFifo = stat.type === 'fifo';
            if (isFifo) {
              if (options.start !== undefined || options.end !== undefined) {
                throw Object.assign(new Error(`ESPIPE: read '${path}'`), { code: 'ESPIPE' });
              }
              await filesystem.openFifo(path, 'read', endpointId);
              if (closed) return;
            } else {
              chunkSource = await filesystem.getFile(path);
              if (!chunkSource) {
                throw Object.assign(new Error(`ENOENT: open '${path}'`), { code: 'ENOENT' });
              }
            }
            initialized = true;
          }
          if (closed) return;
          if (isFifo) {
            const chunk = await filesystem.readFifo(endpointId, size);
            if (closed) return;
            if (chunk.byteLength === 0) {
              await filesystem.closeFifo(endpointId);
              fifoReleased = true;
              closed = true;
              stream.push(null);
            } else stream.push(chunk);
            return;
          }
          if (!chunkSource) throw new Error('Read stream file is unavailable.');
          let last = chunkSource.byteLength - 1;
          if (options.end !== undefined) last = Math.min(options.end, last);
          const count = Math.min(size, Math.max(0, last - offset + 1));
          if (count === 0) {
            closed = true;
            stream.push(null);
            return;
          }
          const chunk = chunkSource.slice(offset, offset + count);
          offset += chunk.byteLength;
          stream.push(chunk);
        } finally {
          reading = false;
        }
      };
      void tracked(operation(), tracker).catch(error => {
        if (error instanceof Error) stream.destroy(error);
        else stream.destroy(new Error(String(error)));
      });
    },
    destroy(error, callback) {
      closed = true;
      if (!isFifo || fifoReleased) {
        callback(error);
        return;
      }
      void filesystem.closeFifo(endpointId).then(
        () => {
          fifoReleased = true;
          callback(error);
        },
        closeError => {
          if (error) callback(error);
          else if (closeError instanceof Error) callback(closeError);
          else callback(asError(String(closeError)));
        }
      );
    },
  });
  if (options.encoding) stream.setEncoding(options.encoding);
  return stream;
}

export function createWriteStream(
  filesystem: RuntimeFsMount,
  path: string,
  options: FsStreamOptions = {},
  tracker?: IoTracker
): Writable {
  validateWriteOptions(options);
  const endpointId = crypto.randomUUID();
  let isFifo = false;
  let initialized: Promise<void> | undefined;
  let closed = false;
  let fifoReleased = false;
  const flags = options.flags ?? 'w';
  const mode = options.mode === undefined ? undefined : creationMode(options.mode);
  let offset = options.start ?? 0;
  const append = flags === 'a' || flags === 'ax';

  const initialize = (): Promise<void> => {
    if (initialized) return initialized;
    initialized = tracked(
      (async () => {
        const stat = await filesystem.stat(path);
        if (closed) return;
        if ((flags === 'wx' || flags === 'ax') && stat) {
          throw Object.assign(new Error(`EEXIST: open '${path}'`), { code: 'EEXIST' });
        }
        if (flags === 'r+' && !stat) {
          throw Object.assign(new Error(`ENOENT: open '${path}'`), { code: 'ENOENT' });
        }
        isFifo = stat !== null && stat.type === 'fifo';
        if (isFifo) {
          if (options.start !== undefined) {
            throw Object.assign(new Error(`ESPIPE: write '${path}'`), { code: 'ESPIPE' });
          }
          let mode: 'write' | 'readwrite' = 'write';
          if (flags === 'r+') mode = 'readwrite';
          await filesystem.openFifo(path, mode, endpointId);
        } else if (flags === 'w') {
          await filesystem.setFile(path, new Uint8Array(), mode);
        } else if (flags === 'wx' || flags === 'ax') {
          await filesystem.writeRange(path, new Uint8Array(), 0, true, true, mode);
        } else if (append && !stat) {
          await filesystem.writeRange(path, new Uint8Array(), null, true, false, mode);
        }
      })(),
      tracker
    );
    return initialized;
  };

  const stream = new Writable({
    decodeStrings: true,
    defaultEncoding: options.encoding,
    highWaterMark: options.highWaterMark,
    write(chunk: Uint8Array, _encoding, callback) {
      const operation = async (): Promise<void> => {
        await initialize();
        if (closed) return;
        if (!isFifo) {
          let position: number | null = offset;
          if (append) position = null;
          const endOffset = await filesystem.writeRange(path, chunk, position, false);
          if (!append) offset = endOffset;
          return;
        }
        let fifoOffset = 0;
        while (fifoOffset < chunk.byteLength) {
          const written = await filesystem.writeFifo(endpointId, chunk.subarray(fifoOffset));
          if (written < 1) throw new Error('FIFO write made no progress.');
          fifoOffset += written;
        }
      };
      void tracked(operation(), tracker).then(
        () => callback(),
        error => {
          if (error instanceof Error) callback(error);
          else callback(new Error(String(error)));
        }
      );
    },
    final(callback) {
      const operation = async (): Promise<void> => {
        await initialize();
        if (isFifo) {
          if (!fifoReleased) await filesystem.closeFifo(endpointId);
          fifoReleased = true;
          closed = true;
          return;
        }
      };
      void tracked(operation(), tracker).then(
        () => callback(),
        error => {
          if (error instanceof Error) callback(error);
          else callback(new Error(String(error)));
        }
      );
    },
    destroy(error, callback) {
      closed = true;
      if (!isFifo || fifoReleased || !initialized) {
        callback(error);
        return;
      }
      void filesystem.closeFifo(endpointId).then(
        () => {
          fifoReleased = true;
          callback(error);
        },
        closeError => {
          if (error) callback(error);
          else if (closeError instanceof Error) callback(closeError);
          else callback(new Error(String(closeError)));
        }
      );
    },
  });
  return stream;
}
