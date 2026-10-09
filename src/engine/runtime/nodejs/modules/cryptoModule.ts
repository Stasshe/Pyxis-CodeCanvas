import { scrypt as nobleScrypt, scryptAsync as nobleScryptAsync } from '@noble/hashes/scrypt.js';
import { Buffer } from 'buffer';
import cryptoBrowserify from 'crypto-browserify';

type IoTracker = <T>(promise: Promise<T>) => Promise<T>;
type Pbkdf2Callback = (error: Error | null, derivedKey: Buffer | undefined) => void;
type RandomBytesCallback = (error: Error | null, bytes: Buffer) => void;
type RandomFillCallback<T extends ArrayBufferView> = (error: Error | null, buffer: T) => void;
type ScryptInput = string | ArrayBufferLike | ArrayBufferView;
type ScryptCallback = (error: Error | null, derivedKey: Buffer | undefined) => void;
interface ScryptOptions {
  N?: number;
  r?: number;
  p?: number;
  cost?: number;
  blockSize?: number;
  parallelization?: number;
  maxmem?: number;
}
interface NormalizedScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}
type CryptoIntegerArray =
  | Int8Array<ArrayBufferLike>
  | Uint8Array<ArrayBufferLike>
  | Uint8ClampedArray<ArrayBufferLike>
  | Int16Array<ArrayBufferLike>
  | Uint16Array<ArrayBufferLike>
  | Int32Array<ArrayBufferLike>
  | Uint32Array<ArrayBufferLike>
  | BigInt64Array<ArrayBufferLike>
  | BigUint64Array<ArrayBufferLike>;

function unavailable(name: string): never {
  throw new Error(`crypto.${name} is unavailable in this runtime.`);
}

function scryptError(message: string, code: string, rangeError = false): Error {
  let error: Error;
  if (rangeError) error = new RangeError(message);
  else error = new TypeError(message);
  Object.assign(error, { code });
  return error;
}

function validateScryptInteger(name: string, value: number, maximum: number): void {
  if (typeof value !== 'number') {
    throw scryptError(`The "${name}" argument must be of type number.`, 'ERR_INVALID_ARG_TYPE');
  }
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw scryptError(`The "${name}" argument is out of range.`, 'ERR_OUT_OF_RANGE', true);
  }
}

function readScryptOption(
  options: ScryptOptions,
  primary: keyof ScryptOptions,
  alias: keyof ScryptOptions,
  fallback: number
): number {
  const primaryValue = options[primary];
  const aliasValue = options[alias];
  if (primaryValue !== undefined) validateScryptInteger(primary, primaryValue, 2 ** 32 - 1);
  if (aliasValue !== undefined) {
    if (primaryValue !== undefined) {
      throw scryptError(
        `The "${primary}" and "${alias}" options cannot be used together.`,
        'ERR_INCOMPATIBLE_OPTION_PAIR'
      );
    }
    validateScryptInteger(alias, aliasValue, 2 ** 32 - 1);
  }
  let value = primaryValue;
  if (value === undefined) value = aliasValue;
  if (value === undefined || value === 0) value = fallback;
  return value;
}

function validateScryptOptions(
  keylen: number,
  options: ScryptOptions = {}
): NormalizedScryptOptions {
  options = options ?? {};
  if (typeof keylen !== 'number') {
    throw scryptError('The "keylen" argument must be of type number.', 'ERR_INVALID_ARG_TYPE');
  }
  if (!Number.isInteger(keylen) || keylen < 0 || keylen > 2 ** 31 - 1) {
    throw scryptError('The "keylen" argument is out of range.', 'ERR_OUT_OF_RANGE', true);
  }
  const N = readScryptOption(options, 'N', 'cost', 16_384);
  const r = readScryptOption(options, 'r', 'blockSize', 8);
  const p = readScryptOption(options, 'p', 'parallelization', 1);
  let maxmem = options.maxmem;
  if (maxmem === undefined || maxmem === 0) maxmem = 32 * 1024 * 1024;
  if (typeof maxmem !== 'number') {
    throw scryptError('The "maxmem" option must be of type number.', 'ERR_INVALID_ARG_TYPE');
  }
  if (!Number.isInteger(maxmem) || maxmem < 0 || !Number.isSafeInteger(maxmem)) {
    throw scryptError(
      'The "maxmem" option must be a non-negative safe integer.',
      'ERR_OUT_OF_RANGE',
      true
    );
  }
  if (
    N < 2 ||
    (N & (N - 1)) !== 0 ||
    !Number.isSafeInteger(r) ||
    r < 1 ||
    !Number.isSafeInteger(p) ||
    p < 1
  ) {
    throw scryptError('Invalid scrypt parameters.', 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS', true);
  }
  if (BigInt(p) * BigInt(r) > 2n ** 30n - 1n) {
    throw scryptError('Invalid scrypt parameters.', 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS', true);
  }
  if (16n * BigInt(r) <= 63n && BigInt(N) >= 1n << (16n * BigInt(r))) {
    throw scryptError('Invalid scrypt parameters.', 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS', true);
  }
  const memoryRequired = 128n * BigInt(r) * (BigInt(N) + BigInt(p) + 2n);
  if (memoryRequired > BigInt(maxmem)) {
    throw scryptError(
      'Invalid scrypt parameters: memory limit exceeded.',
      'ERR_CRYPTO_INVALID_SCRYPT_PARAMS',
      true
    );
  }
  return { N, r, p, maxmem };
}

function scryptBytes(input: ScryptInput): string | Uint8Array {
  if (typeof input === 'string') return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof SharedArrayBuffer !== 'undefined' && input instanceof SharedArrayBuffer) {
    return new Uint8Array(input);
  }
  throw scryptError('The password and salt must be strings or byte views.', 'ERR_INVALID_ARG_TYPE');
}

function scryptCallbackError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function trackScryptTask(task: Promise<void>, getTrackIO?: () => IoTracker | undefined): void {
  const track = getTrackIO?.();
  if (track) track(task);
  else void task;
}

function createScrypt(getTrackIO?: () => IoTracker | undefined) {
  function scryptSync(password: ScryptInput, salt: ScryptInput, keylen: number): Buffer;
  function scryptSync(
    password: ScryptInput,
    salt: ScryptInput,
    keylen: number,
    options: ScryptOptions
  ): Buffer;
  function scryptSync(
    password: ScryptInput,
    salt: ScryptInput,
    keylen: number,
    options: ScryptOptions = {}
  ): Buffer {
    const passwordBytes = scryptBytes(password);
    const saltBytes = scryptBytes(salt);
    const normalized = validateScryptOptions(keylen, options);
    if (keylen === 0) return Buffer.alloc(0);
    const derivedKey = nobleScrypt(passwordBytes, saltBytes, {
      ...normalized,
      dkLen: keylen,
    });
    return Buffer.from(derivedKey);
  }

  function scrypt(
    password: ScryptInput,
    salt: ScryptInput,
    keylen: number,
    callback: ScryptCallback
  ): void;
  function scrypt(
    password: ScryptInput,
    salt: ScryptInput,
    keylen: number,
    options: ScryptOptions,
    callback: ScryptCallback
  ): void;
  function scrypt(
    password: ScryptInput,
    salt: ScryptInput,
    keylen: number,
    optionsOrCallback: ScryptOptions | ScryptCallback,
    suppliedCallback?: ScryptCallback
  ): void {
    let options: ScryptOptions;
    let callback: ScryptCallback | undefined = suppliedCallback;
    if (typeof optionsOrCallback === 'function') {
      options = {};
      callback = optionsOrCallback;
    } else options = optionsOrCallback;
    const passwordBytes = scryptBytes(password);
    const saltBytes = scryptBytes(salt);
    const normalized = validateScryptOptions(keylen, options ?? {});
    if (typeof callback !== 'function') {
      throw scryptError(
        'The "callback" argument must be of type function.',
        'ERR_INVALID_ARG_TYPE'
      );
    }
    const callbackToInvoke = callback;
    if (keylen === 0) {
      const task = Promise.resolve().then(() => callbackToInvoke(null, Buffer.alloc(0)));
      trackScryptTask(task, getTrackIO);
      return;
    }
    const task = nobleScryptAsync(passwordBytes, saltBytes, {
      ...normalized,
      dkLen: keylen,
    }).then(
      derivedKey => callbackToInvoke(null, Buffer.from(derivedKey)),
      error => callbackToInvoke(scryptCallbackError(error), undefined)
    );
    trackScryptTask(task, getTrackIO);
  }

  return { scrypt, scryptSync };
}

function createRandomBytes(getTrackIO?: () => IoTracker | undefined) {
  function randomBytes(size: number): Buffer;
  function randomBytes(size: number, callback: RandomBytesCallback): void;
  function randomBytes(size: number, callback?: RandomBytesCallback): Buffer | void {
    if (!callback) {
      return cryptoBrowserify.randomBytes(size);
    }

    let complete: () => void = () => {};
    const pending = new Promise<void>(resolve => {
      complete = resolve;
    });
    const tracked = getTrackIO?.()?.(pending) ?? pending;
    try {
      cryptoBrowserify.randomBytes(size, (error, bytes) => {
        try {
          callback(error, bytes);
        } finally {
          complete();
        }
      });
    } catch (error) {
      complete();
      throw error;
    }
    void tracked;
  }
  return randomBytes;
}

function createRandomFill(getTrackIO?: () => IoTracker | undefined) {
  function randomFill<T extends ArrayBufferView>(buffer: T, callback: RandomFillCallback<T>): void;
  function randomFill<T extends ArrayBufferView>(
    buffer: T,
    offset: number,
    callback: RandomFillCallback<T>
  ): void;
  function randomFill<T extends ArrayBufferView>(
    buffer: T,
    offset: number,
    size: number,
    callback: RandomFillCallback<T>
  ): void;
  function randomFill<T extends ArrayBufferView>(
    buffer: T,
    offsetOrCallback: number | RandomFillCallback<T>,
    sizeOrCallback?: number | RandomFillCallback<T>,
    callback?: RandomFillCallback<T>
  ): void {
    let offset: number | undefined;
    let size: number | undefined;
    let done = callback;
    if (typeof offsetOrCallback === 'function') done = offsetOrCallback;
    else {
      offset = offsetOrCallback;
      if (typeof sizeOrCallback === 'function') done = sizeOrCallback;
      else size = sizeOrCallback;
    }
    if (!done) throw new TypeError('A callback function is required.');
    let complete: () => void = () => {};
    const pending = new Promise<void>(resolve => {
      complete = resolve;
    });
    const tracked = getTrackIO?.()?.(pending) ?? pending;
    try {
      cryptoBrowserify.randomFill(buffer, offset, size, (error, result) => {
        try {
          done?.(error, result);
        } finally {
          complete();
        }
      });
    } catch (error) {
      complete();
      throw error;
    }
    void tracked;
  }
  return randomFill;
}

function validateRandomIntRange(min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
    throw new TypeError('The "min" and "max" arguments must be safe integers.');
  }
  const range = max - min;
  if (range <= 0 || range >= 2 ** 48) {
    throw new RangeError('The "min" and "max" arguments must define a positive range < 2^48.');
  }
  return range;
}

function randomIntSync(min: number, max: number): number {
  const range = validateRandomIntRange(min, max);
  const bytesNeeded = Math.ceil(Math.log2(range) / 8);
  const space = 2 ** (bytesNeeded * 8);
  const limit = space - (space % range);
  let value: number;
  do {
    const bytes = cryptoBrowserify.randomBytes(bytesNeeded);
    value = 0;
    for (const byte of bytes) value = value * 256 + byte;
  } while (value >= limit);
  return min + (value % range);
}

function createRandomInt(getTrackIO?: () => IoTracker | undefined) {
  function randomInt(max: number): number;
  function randomInt(
    max: number,
    callback: (error: Error | null, value: number | undefined) => void
  ): void;
  function randomInt(min: number, max: number): number;
  function randomInt(
    min: number,
    max: number,
    callback: (error: Error | null, value: number | undefined) => void
  ): void;
  function randomInt(
    min: number,
    maxOrCallback?: number | ((error: Error | null, value: number | undefined) => void),
    callback?: (error: Error | null, value: number | undefined) => void
  ): number | void {
    let minimum = min;
    let maximum: number;
    let done = callback;
    if (typeof maxOrCallback === 'function') {
      minimum = 0;
      maximum = min;
      done = maxOrCallback;
    } else if (maxOrCallback === undefined) {
      minimum = 0;
      maximum = min;
    } else {
      maximum = maxOrCallback;
    }
    validateRandomIntRange(minimum, maximum);
    if (!done) return randomIntSync(minimum, maximum);
    const completionCallback = done;
    let complete: () => void = () => {};
    const pending = new Promise<void>(resolve => {
      complete = resolve;
    });
    const tracked = getTrackIO?.()?.(pending) ?? pending;
    queueMicrotask(() => {
      let value: number | undefined;
      let error: Error | null = null;
      try {
        value = randomIntSync(minimum, maximum);
      } catch (caught) {
        if (caught instanceof Error) error = caught;
        else error = new Error(String(caught));
      }
      try {
        completionCallback(error, value);
      } finally {
        complete();
      }
    });
    void tracked;
  }
  return randomInt;
}

export function createCryptoModule(getTrackIO?: () => IoTracker | undefined) {
  const scrypt = createScrypt(getTrackIO);
  return {
    createHash: (algorithm: string) => cryptoBrowserify.createHash(algorithm),
    createHmac: (algorithm: string, key: string | Uint8Array) =>
      cryptoBrowserify.createHmac(algorithm, key),
    getHashes: () => cryptoBrowserify.getHashes(),
    createCipheriv: cryptoBrowserify.createCipheriv,
    createDecipheriv: cryptoBrowserify.createDecipheriv,
    getCiphers: () => cryptoBrowserify.getCiphers(),
    createSign: cryptoBrowserify.createSign,
    createVerify: cryptoBrowserify.createVerify,
    createECDH: cryptoBrowserify.createECDH,
    getDiffieHellman: cryptoBrowserify.getDiffieHellman,
    createDiffieHellman: cryptoBrowserify.createDiffieHellman,
    publicEncrypt: cryptoBrowserify.publicEncrypt,
    privateEncrypt: cryptoBrowserify.privateEncrypt,
    publicDecrypt: cryptoBrowserify.publicDecrypt,
    privateDecrypt: cryptoBrowserify.privateDecrypt,
    randomBytes: createRandomBytes(getTrackIO),
    randomFill: createRandomFill(getTrackIO),
    randomFillSync: <T extends ArrayBufferView>(buffer: T, offset?: number, size?: number): T =>
      cryptoBrowserify.randomFillSync(buffer, offset, size),
    randomInt: createRandomInt(getTrackIO),
    randomUUID: (): string => {
      const webcrypto = globalThis.crypto;
      if (typeof webcrypto?.randomUUID !== 'function') {
        return unavailable('randomUUID');
      }
      return webcrypto.randomUUID();
    },
    getRandomValues: <T extends CryptoIntegerArray>(buffer: T): T => {
      const webcrypto = globalThis.crypto;
      if (typeof webcrypto?.getRandomValues !== 'function') {
        return unavailable('getRandomValues');
      }
      const type = Object.prototype.toString.call(buffer);
      if (
        type !== '[object Int8Array]' &&
        type !== '[object Uint8Array]' &&
        type !== '[object Uint8ClampedArray]' &&
        type !== '[object Int16Array]' &&
        type !== '[object Uint16Array]' &&
        type !== '[object Int32Array]' &&
        type !== '[object Uint32Array]' &&
        type !== '[object BigInt64Array]' &&
        type !== '[object BigUint64Array]'
      ) {
        throw new DOMException(
          'crypto.getRandomValues requires an integer typed array.',
          'TypeMismatchError'
        );
      }
      if (!(buffer.buffer instanceof ArrayBuffer)) {
        throw new TypeError('crypto.getRandomValues requires an ArrayBuffer-backed view.');
      }
      const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      webcrypto.getRandomValues(bytes);
      return buffer;
    },
    pbkdf2: (
      password: string | Uint8Array,
      salt: string | Uint8Array,
      iterations: number,
      keylen: number,
      digest: string,
      callback: Pbkdf2Callback
    ): void => {
      let complete: () => void = () => {};
      const pending = new Promise<void>(resolve => {
        complete = resolve;
      });
      const tracked = getTrackIO?.()?.(pending) ?? pending;
      try {
        cryptoBrowserify.pbkdf2(password, salt, iterations, keylen, digest, (error, key) => {
          try {
            callback(error, key);
          } finally {
            complete();
          }
        });
      } catch (error) {
        complete();
        throw error;
      }
      void tracked;
    },
    pbkdf2Sync: (
      password: string | Uint8Array,
      salt: string | Uint8Array,
      iterations: number,
      keylen: number,
      digest: string
    ): Buffer => cryptoBrowserify.pbkdf2Sync(password, salt, iterations, keylen, digest),
    scrypt: scrypt.scrypt,
    scryptSync: scrypt.scryptSync,
    timingSafeEqual: (first: ArrayBufferView, second: ArrayBufferView): boolean => {
      if (!ArrayBuffer.isView(first) || !ArrayBuffer.isView(second)) {
        throw new TypeError('crypto.timingSafeEqual requires ArrayBuffer views.');
      }
      if (first.byteLength !== second.byteLength) {
        throw new RangeError('Input buffers must have the same byte length.');
      }
      const firstBytes = new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
      const secondBytes = new Uint8Array(second.buffer, second.byteOffset, second.byteLength);
      let difference = 0;
      for (let index = 0; index < firstBytes.length; index += 1) {
        difference |= firstBytes[index] ^ secondBytes[index];
      }
      return difference === 0;
    },
    constants: cryptoBrowserify.constants,
    subtle: globalThis.crypto?.subtle,
    webcrypto: globalThis.crypto,
  };
}
