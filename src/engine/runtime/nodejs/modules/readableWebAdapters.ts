import stream from 'node:stream';

interface ReadableFromWebOptions {
  encoding?: BufferEncoding;
  highWaterMark?: number;
  objectMode?: boolean;
  signal?: AbortSignal;
}

interface ReadableToWebOptions<Chunk> {
  strategy?: QueuingStrategy<Chunk>;
}

type ReadableFacadeConstructor = typeof stream.Readable &
  ((...args: ConstructorParameters<typeof stream.Readable>) => stream.Readable);
type StreamFacadeConstructor = typeof stream &
  ((...args: ConstructorParameters<typeof stream>) => stream.Stream);

function fromWeb<Chunk>(
  source: ReadableStream<Chunk>,
  options: ReadableFromWebOptions = {}
): stream.Readable {
  if (typeof source?.getReader !== 'function') {
    throw new TypeError('readableStream must be a ReadableStream');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }

  let reader: ReadableStreamDefaultReader<Chunk>;
  let reading = false;
  let closed = false;
  let readable: stream.Readable;

  readable = new stream.Readable({
    encoding: options.encoding,
    highWaterMark: options.highWaterMark,
    objectMode: options.objectMode,
    signal: options.signal,
    read() {
      if (reading || closed) return;
      reading = true;
      reader.read().then(
        result => {
          reading = false;
          if (readable.destroyed) return;
          if (result.done) {
            closed = true;
            readable.push(null);
            return;
          }
          try {
            readable.push(result.value);
          } catch (reason) {
            if (reason instanceof Error) readable.destroy(reason);
            else
              readable.destroy(new Error('Could not push a Web stream chunk.', { cause: reason }));
          }
        },
        error => {
          reading = false;
          closed = true;
          readable.destroy(error);
        }
      );
    },
    destroy(error, callback) {
      if (closed) {
        callback(error);
        return;
      }
      closed = true;
      reader.cancel(error).then(
        () => callback(error),
        () => callback(error)
      );
    },
  });
  reader = source.getReader();

  return readable;
}

function toWeb<Chunk>(
  source: stream.Readable,
  options: ReadableToWebOptions<Chunk> = {}
): ReadableStream<Chunk> {
  if (typeof source?.on !== 'function' || typeof source.pause !== 'function') {
    throw new TypeError('streamReadable must be a Readable');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }

  let controller: ReadableStreamDefaultController<Chunk> | undefined;
  let settled = false;
  const cleanup = () => {
    source.off('data', onData);
    source.off('end', onEnd);
    source.off('error', onError);
    source.off('close', onClose);
  };
  const finish = () => {
    if (settled || controller === undefined) return;
    settled = true;
    cleanup();
    controller.close();
  };
  const fail = (error: Error) => {
    if (settled) {
      cleanup();
      return;
    }
    if (controller === undefined) return;
    settled = true;
    cleanup();
    controller.error(error);
  };
  const onData = (chunk: Chunk) => {
    if (settled || controller === undefined) return;
    try {
      controller.enqueue(chunk);
    } catch (reason) {
      let error: Error;
      if (reason instanceof Error) error = reason;
      else error = new TypeError('Could not enqueue the Node stream chunk.');
      settled = true;
      cleanup();
      controller.error(error);
      source.once('error', () => {});
      source.destroy(error);
      return;
    }
    if (controller.desiredSize !== null && controller.desiredSize <= 0) source.pause();
  };
  const onEnd = () => finish();
  const onError = (error: Error) => fail(error);
  const onClose = () => {
    if (source.readableEnded) {
      finish();
      return;
    }
    fail(
      Object.assign(new Error('The stream closed before it finished.'), {
        code: 'ERR_STREAM_PREMATURE_CLOSE',
      })
    );
  };

  const underlyingSource: UnderlyingDefaultSource<Chunk> = {
    start(value) {
      controller = value;
      if (source.readableEnded) {
        finish();
        return;
      }
      if (source.destroyed) {
        if (source.errored !== null) fail(source.errored);
        else finish();
        return;
      }
      source.pause();
      source.on('data', onData);
      source.once('end', onEnd);
      source.once('error', onError);
      source.once('close', onClose);
    },
    pull() {
      source.resume();
    },
    cancel(reason) {
      if (settled) return;
      settled = true;
      source.off('data', onData);
      source.off('end', onEnd);
      source.once('close', cleanup);
      let error: Error | undefined;
      if (reason instanceof Error) error = reason;
      source.destroy(error);
    },
  };
  const strategy = options.strategy ?? {
    highWaterMark: source.readableHighWaterMark,
    size: () => 1,
  };

  return new ReadableStream(underlyingSource, strategy);
}

function createReadableFacade(): ReadableFacadeConstructor {
  const Readable = stream.Readable;
  const ReadableFacade = function (
    this: stream.Readable,
    ...args: ConstructorParameters<typeof stream.Readable>
  ) {
    if (new.target) return Reflect.construct(Readable, args, new.target);
    return Reflect.apply(Readable, this, args);
  };
  Object.defineProperties(ReadableFacade, Object.getOwnPropertyDescriptors(Readable));
  Object.defineProperties(ReadableFacade, {
    fromWeb: { value: fromWeb, enumerable: true, writable: true, configurable: true },
    toWeb: { value: toWeb, enumerable: true, writable: true, configurable: true },
  });
  return ReadableFacade as typeof ReadableFacade & ReadableFacadeConstructor;
}

export function createRuntimeStreamModule(): StreamFacadeConstructor {
  const StreamFacade = function (
    this: stream.Stream,
    ...args: ConstructorParameters<typeof stream>
  ) {
    if (new.target) return Reflect.construct(stream, args, new.target);
    return Reflect.apply(stream, this, args);
  };
  Object.defineProperties(StreamFacade, Object.getOwnPropertyDescriptors(stream));
  Object.defineProperties(StreamFacade, {
    Readable: {
      value: createReadableFacade(),
      enumerable: true,
      writable: true,
      configurable: true,
    },
    Stream: { value: StreamFacade, enumerable: true, writable: true, configurable: true },
  });
  return StreamFacade as typeof StreamFacade & StreamFacadeConstructor;
}
