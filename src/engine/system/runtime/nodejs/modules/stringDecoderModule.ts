import { Buffer } from 'buffer';
import { StringDecoder as BrowserStringDecoder } from 'string_decoder/';

type DecoderInstance = InstanceType<typeof BrowserStringDecoder>;
type DecoderInput = string | NodeJS.ArrayBufferView;
type CallableBrowserStringDecoder = typeof BrowserStringDecoder &
  ((this: DecoderInstance | undefined, encoding?: BufferEncoding) => void);
type StringDecoderConstructor = typeof BrowserStringDecoder & ((encoding?: BufferEncoding) => void);

function invalidBuffer(value: DecoderInput): never {
  let received: string;
  const kind = typeof value;
  if (kind === 'undefined') received = 'undefined';
  else if (kind === 'number' || kind === 'boolean' || kind === 'bigint' || kind === 'symbol') {
    received = `type ${kind} (${String(value)})`;
  } else {
    const name = Object.prototype.toString.call(value).slice(8, -1);
    if (name === 'Null') received = 'null';
    else received = `an instance of ${name}`;
  }
  const error = new TypeError(
    `The "buf" argument must be an instance of Buffer, TypedArray, or DataView. Received ${received}`
  );
  Object.assign(error, { code: 'ERR_INVALID_ARG_TYPE' });
  throw error;
}

function normalizeInput(input: DecoderInput): string | Buffer {
  if (typeof input === 'string') return input;
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return invalidBuffer(input);
}

function decoderWrite(this: DecoderInstance, input: DecoderInput): string {
  const normalized = normalizeInput(input);
  if (typeof normalized === 'string') return normalized;
  return BrowserStringDecoder.prototype.write.call(this, normalized);
}

function decoderEnd(this: DecoderInstance, input?: DecoderInput): string {
  if (typeof input === 'string') return input + BrowserStringDecoder.prototype.end.call(this);
  if (typeof input === 'undefined') return BrowserStringDecoder.prototype.end.call(this);
  return BrowserStringDecoder.prototype.end.call(this, normalizeInput(input));
}

const RuntimeStringDecoder = function (
  this: DecoderInstance,
  encoding?: BufferEncoding
): DecoderInstance | void {
  if (!new.target) {
    Reflect.apply(BrowserStringDecoder as CallableBrowserStringDecoder, this, [encoding]);
    return;
  }
  return Reflect.construct(BrowserStringDecoder, [encoding], new.target);
};

const decoderPrototype = Object.create(BrowserStringDecoder.prototype);
Object.defineProperties(decoderPrototype, {
  constructor: { value: RuntimeStringDecoder, configurable: true, writable: true },
  write: { value: decoderWrite, configurable: true, writable: true },
  end: { value: decoderEnd, configurable: true, writable: true },
});
Object.defineProperties(RuntimeStringDecoder, {
  ...Object.getOwnPropertyDescriptors(BrowserStringDecoder),
  prototype: { value: decoderPrototype, writable: true },
});

export const StringDecoder = RuntimeStringDecoder as StringDecoderConstructor;
