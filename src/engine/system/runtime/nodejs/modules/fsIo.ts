import type { RuntimeFsDescriptors } from './fsDescriptors';
import type { FsPath } from './fsPaths';

type Callback<T = void> = (error: Error | null, value?: T) => void;
type Tracker = <T>(task: Promise<T>) => Promise<T>;
type ReadOperation = (
  descriptor: number,
  target: Uint8Array,
  offset: number,
  length: number,
  position: number | null
) => number;
type WriteCallback = (error: Error | null, written?: number, data?: Uint8Array | string) => void;

export function createDescriptorWriteSync(descriptors: RuntimeFsDescriptors) {
  function writeSync(
    descriptor: number,
    data: Uint8Array,
    offset?: number,
    length?: number,
    position?: number | null
  ): number;
  function writeSync(
    descriptor: number,
    data: string,
    position?: number | null,
    encoding?: BufferEncoding
  ): number;
  function writeSync(
    descriptor: number,
    data: string | Uint8Array,
    offsetOrPosition?: number | null,
    lengthOrEncoding?: number | BufferEncoding,
    position?: number | null
  ): number {
    return descriptors.writeSync(descriptor, data, offsetOrPosition, lengthOrEncoding, position);
  }
  return writeSync;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export function createDescriptorCallbacks(
  descriptors: RuntimeFsDescriptors,
  normalize: (path: FsPath) => string,
  readOperation: ReadOperation,
  track: Tracker
) {
  function complete<T>(task: Promise<T>, callback?: Callback<T>): Promise<T> | void {
    if (!callback) return track(task);
    track(
      task.then(
        value => callback(null, value),
        error => callback(toError(error))
      )
    );
  }

  function open(
    path: FsPath,
    flags: string | number,
    modeOrCallback?: number | Callback<number>,
    callback?: Callback<number>
  ): Promise<number> | void {
    let done = callback;
    let mode: number | undefined;
    if (typeof modeOrCallback === 'function') done = modeOrCallback;
    else mode = modeOrCallback;
    return complete(
      Promise.resolve().then(() => descriptors.openSync(normalize(path), flags, mode)),
      done
    );
  }

  function close(descriptor: number, callback?: Callback<void>): Promise<void> | void {
    return complete(
      Promise.resolve().then(() => descriptors.closeSync(descriptor)),
      callback
    );
  }

  type ReadCallback = (error: Error | null, bytesRead?: number, buffer?: Uint8Array) => void;

  function read(descriptor: number, target: Uint8Array, callback: ReadCallback): void;
  function read(
    descriptor: number,
    target: Uint8Array,
    offset: number,
    length: number,
    callback: ReadCallback
  ): void;
  function read(
    descriptor: number,
    target: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: ReadCallback
  ): void;
  function read(
    descriptor: number,
    target: Uint8Array,
    offsetOrCallback?: number | ReadCallback,
    lengthOrCallback?: number | ReadCallback,
    positionOrCallback?: number | null | ReadCallback,
    callback?: ReadCallback
  ): void {
    let offset = 0;
    if (typeof offsetOrCallback === 'number') offset = offsetOrCallback;
    let length = target.byteLength - offset;
    if (typeof lengthOrCallback === 'number') length = lengthOrCallback;
    let position: number | null = null;
    if (typeof positionOrCallback === 'number' || positionOrCallback === null) {
      position = positionOrCallback;
    }
    let done = callback;
    if (typeof offsetOrCallback === 'function') done = offsetOrCallback;
    if (typeof lengthOrCallback === 'function') done = lengthOrCallback;
    if (typeof positionOrCallback === 'function') done = positionOrCallback;
    if (!done) throw new TypeError('Callback must be a function.');
    const doneCallback = done;
    track(
      Promise.resolve()
        .then(() => readOperation(descriptor, target, offset, length, position))
        .then(
          bytesRead => doneCallback(null, bytesRead, target),
          error => doneCallback(toError(error))
        )
    );
  }

  function write(descriptor: number, data: Uint8Array, callback: WriteCallback): void;
  function write(
    descriptor: number,
    data: Uint8Array,
    offset: number,
    length: number,
    callback: WriteCallback
  ): void;
  function write(
    descriptor: number,
    data: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: WriteCallback
  ): void;
  function write(descriptor: number, data: string, callback: WriteCallback): void;
  function write(
    descriptor: number,
    data: string,
    position: number | null,
    callback: WriteCallback
  ): void;
  function write(
    descriptor: number,
    data: string,
    position: number | null,
    encoding: BufferEncoding,
    callback: WriteCallback
  ): void;
  function write(
    descriptor: number,
    data: Uint8Array | string,
    offsetOrPosition?: number | null | WriteCallback,
    lengthOrEncoding?: number | BufferEncoding | WriteCallback,
    positionOrCallback?: number | null | WriteCallback,
    callback?: WriteCallback
  ): void {
    let done = callback;
    if (typeof offsetOrPosition === 'function') done = offsetOrPosition;
    if (typeof lengthOrEncoding === 'function') done = lengthOrEncoding;
    if (typeof positionOrCallback === 'function') done = positionOrCallback;
    if (!done) throw new TypeError('Callback must be a function.');
    const doneCallback = done;
    let task: Promise<number>;
    if (typeof data === 'string') {
      let position: number | null | undefined;
      if (typeof offsetOrPosition === 'number' || offsetOrPosition === null) {
        position = offsetOrPosition;
      }
      let encoding: BufferEncoding | undefined;
      if (typeof lengthOrEncoding === 'string') encoding = lengthOrEncoding;
      task = Promise.resolve().then(() =>
        descriptors.writeSync(descriptor, data, position, encoding)
      );
    } else {
      let offset = 0;
      if (typeof offsetOrPosition === 'number') offset = offsetOrPosition;
      let length = data.byteLength - offset;
      if (typeof lengthOrEncoding === 'number') length = lengthOrEncoding;
      let position: number | null = null;
      if (typeof positionOrCallback === 'number' || positionOrCallback === null) {
        position = positionOrCallback;
      }
      task = Promise.resolve().then(() =>
        descriptors.writeSync(descriptor, data, offset, length, position)
      );
    }
    track(
      task.then(
        written => doneCallback(null, written, data),
        error => doneCallback(toError(error))
      )
    );
  }

  return { open, close, read, write };
}
