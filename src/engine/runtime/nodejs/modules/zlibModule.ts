import { Transform } from 'node:stream';
import { Buffer } from 'buffer';
import pako from 'pako';

type CompressionOptions = pako.DeflateOptions;
type DecompressionOptions = Omit<pako.InflateOptions, 'to'>;
type DecompressionFunctionOptions = Omit<pako.InflateFunctionOptions, 'to'>;
type PakoStream = (pako.Deflate | pako.Inflate) & { ended: boolean };
type CodecOptions = CompressionOptions | DecompressionOptions;
type CodecFactory = (options: CodecOptions) => PakoStream;
type Input = pako.Data | string;
type Callback = (error: Error | null, result?: Buffer) => void;
type CompressionOperation<Options> = (data: pako.Data, options?: Options) => Uint8Array;
type FlushCallback = (error?: Error | null) => void;
type FlushRequest = { kind: number; callback?: FlushCallback };
type IoTracker = <T>(promise: Promise<T>) => Promise<T>;

class ZlibTransformStream extends Transform {
  private readonly flushRequests = new WeakMap<Buffer, FlushRequest>();

  constructor(private readonly codec: PakoStream) {
    super({
      transform: (chunk: Buffer, _encoding, callback) => this.transformChunk(chunk, callback),
      flush: callback => this.finish(callback),
    });
    codec.onData = chunk => {
      if (chunk instanceof ArrayBuffer) {
        this.push(Buffer.from(new Uint8Array(chunk)));
        return;
      }
      this.push(Buffer.from(chunk));
    };
    codec.onEnd = status => {
      if (status !== pako.constants.Z_OK && status !== pako.constants.Z_STREAM_END) {
        this.destroy(new Error(codec.msg || `Compression failed with status ${status}.`));
      }
    };
  }

  flush(callback?: FlushCallback): void;
  flush(kind?: number, callback?: FlushCallback): void;
  flush(
    kindOrCallback: number | FlushCallback = pako.constants.Z_FULL_FLUSH,
    callback?: FlushCallback
  ): void {
    let kind = pako.constants.Z_FULL_FLUSH;
    let done = callback;
    if (typeof kindOrCallback === 'function') {
      done = kindOrCallback;
    } else {
      kind = kindOrCallback;
    }
    const marker = Buffer.alloc(0);
    this.flushRequests.set(marker, { kind, callback: done });
    this.write(marker);
  }

  private transformChunk(chunk: Buffer, callback: FlushCallback): void {
    const flush = this.flushRequests.get(chunk);
    if (flush) {
      this.flushRequests.delete(chunk);
      const accepted = this.codec.push(new Uint8Array(), flush.kind);
      if (!accepted && this.codec.err !== pako.constants.Z_OK) {
        const error = new Error(this.codec.msg || 'Compression stream could not flush.');
        flush.callback?.(error);
        callback(error);
        return;
      }
      flush.callback?.();
      callback();
      return;
    }
    const accepted = this.codec.push(chunk, pako.constants.Z_NO_FLUSH);
    if (!accepted && this.codec.err !== pako.constants.Z_OK) {
      callback(new Error(this.codec.msg || 'Compression stream rejected input.'));
      return;
    }
    callback();
  }

  private finish(callback: FlushCallback): void {
    const accepted = this.codec.push(new Uint8Array(), pako.constants.Z_FINISH);
    if (!accepted && this.codec.err !== pako.constants.Z_OK) {
      callback(new Error(this.codec.msg || 'Compression stream could not finish.'));
      return;
    }
    if (this.codec instanceof pako.Inflate && !this.codec.ended) {
      callback(new Error(this.codec.msg || 'Compressed stream ended before its trailer.'));
      return;
    }
    callback();
  }
}

function createTransform(factory: CodecFactory, options: CodecOptions): ZlibTransformStream {
  return new ZlibTransformStream(factory(options));
}

function deflater(options: CodecOptions): PakoStream {
  return new pako.Deflate(options as CompressionOptions) as PakoStream;
}

function inflater(options: CodecOptions): PakoStream {
  return new pako.Inflate(binaryInflateOptions(options as DecompressionOptions)) as PakoStream;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function isCallback(value: unknown): value is Callback {
  return typeof value === 'function';
}

function toPakoData(data: Input): pako.Data {
  return typeof data === 'string' ? Buffer.from(data) : data;
}

function binaryInflateOptions(options: DecompressionOptions): pako.InflateOptions {
  return { ...options, to: undefined };
}

function inflateBytes(data: pako.Data, options?: DecompressionFunctionOptions): Uint8Array {
  return pako.inflate(data, binaryInflateOptions(options ?? {}));
}

function inflateRawBytes(data: pako.Data, options?: DecompressionFunctionOptions): Uint8Array {
  return pako.inflateRaw(data, binaryInflateOptions(options ?? {}));
}

function runSync<Options>(
  operation: CompressionOperation<Options>,
  data: Input,
  options?: Options
): Buffer {
  return Buffer.from(operation(toPakoData(data), options));
}

function runAsync<Options>(
  operation: CompressionOperation<Options>,
  data: Input,
  optionsOrCallback: Options | Callback,
  callback?: Callback,
  track?: IoTracker
): void {
  let options: Options | undefined;
  let done = callback;
  if (isCallback(optionsOrCallback)) {
    done = optionsOrCallback;
  } else {
    options = optionsOrCallback;
  }
  if (!done) throw new TypeError('A callback function is required.');
  const complete = done;
  const task = Promise.resolve()
    .then(() => runSync(operation, data, options))
    .then(
      result => {
        complete(null, result);
      },
      error => {
        complete(toError(error));
      }
    );
  if (track) track(task);
  else void task;
}

function gzipSync(data: Input, options?: pako.DeflateFunctionOptions): Buffer {
  return runSync(pako.gzip, data, options);
}

function deflateSync(data: Input, options?: pako.DeflateFunctionOptions): Buffer {
  return runSync(pako.deflate, data, options);
}

function deflateRawSync(data: Input, options?: pako.DeflateFunctionOptions): Buffer {
  return runSync(pako.deflateRaw, data, options);
}

function inflateSync(data: Input, options?: DecompressionFunctionOptions): Buffer {
  return runSync(inflateBytes, data, {
    windowBits: 15,
    ...options,
  });
}

function inflateRawSync(data: Input, options?: DecompressionFunctionOptions): Buffer {
  return runSync(inflateRawBytes, data, options);
}

function gunzipSync(data: Input, options?: DecompressionFunctionOptions): Buffer {
  return runSync(inflateBytes, data, {
    windowBits: 31,
    ...options,
  });
}

export function createZlibModule(getTrackIO?: () => IoTracker | undefined) {
  const track = getTrackIO?.();
  const run = <Options>(
    operation: CompressionOperation<Options>,
    data: Input,
    optionsOrCallback: Options | Callback,
    callback?: Callback
  ) => runAsync(operation, data, optionsOrCallback, callback, track);

  return {
    constants: pako.constants,
    createGzip: (options: CompressionOptions = {}) =>
      createTransform(deflater, { ...options, gzip: true }),
    createDeflate: (options: CompressionOptions = {}) => createTransform(deflater, options),
    createDeflateRaw: (options: CompressionOptions = {}) =>
      createTransform(deflater, { ...options, raw: true }),
    createInflate: (options: DecompressionOptions = {}) =>
      createTransform(inflater, { windowBits: 15, ...options }),
    createInflateRaw: (options: DecompressionOptions = {}) =>
      createTransform(inflater, { ...options, raw: true }),
    createGunzip: (options: DecompressionOptions = {}) =>
      createTransform(inflater, { windowBits: 31, ...options }),
    createUnzip: (options: DecompressionOptions = {}) => createTransform(inflater, options),
    gzip: (
      data: Input,
      optionsOrCallback: pako.DeflateFunctionOptions | Callback,
      callback?: Callback
    ) => run(pako.gzip, data, optionsOrCallback, callback),
    gzipSync,
    deflate: (
      data: Input,
      optionsOrCallback: pako.DeflateFunctionOptions | Callback,
      callback?: Callback
    ) => run(pako.deflate, data, optionsOrCallback, callback),
    deflateSync,
    deflateRaw: (
      data: Input,
      optionsOrCallback: pako.DeflateFunctionOptions | Callback,
      callback?: Callback
    ) => run(pako.deflateRaw, data, optionsOrCallback, callback),
    deflateRawSync,
    inflate: (
      data: Input,
      optionsOrCallback: DecompressionFunctionOptions | Callback,
      callback?: Callback
    ) =>
      run(
        (input, options) => inflateBytes(input, { windowBits: 15, ...options }),
        data,
        optionsOrCallback,
        callback
      ),
    inflateSync,
    inflateRaw: (
      data: Input,
      optionsOrCallback: DecompressionFunctionOptions | Callback,
      callback?: Callback
    ) => run(inflateRawBytes, data, optionsOrCallback, callback),
    inflateRawSync,
    gunzip: (
      data: Input,
      optionsOrCallback: DecompressionFunctionOptions | Callback,
      callback?: Callback
    ) =>
      run(
        (input, options) => inflateBytes(input, { windowBits: 31, ...options }),
        data,
        optionsOrCallback,
        callback
      ),
    gunzipSync,
    unzip: (
      data: Input,
      optionsOrCallback: DecompressionFunctionOptions | Callback,
      callback?: Callback
    ) => run(inflateBytes, data, optionsOrCallback, callback),
    unzipSync: (data: Input, options?: DecompressionFunctionOptions) =>
      runSync(inflateBytes, data, options),
  };
}
