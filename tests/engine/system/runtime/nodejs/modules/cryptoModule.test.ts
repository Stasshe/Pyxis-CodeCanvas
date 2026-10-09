import { generateKeyPairSync, scryptSync as nativeScryptSync } from 'node:crypto';
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import { createCryptoModule } from '@/engine/system/runtime/nodejs/modules/cryptoModule';

describe('crypto module', () => {
  const crypto = createCryptoModule();

  it('matches standard SHA-256 and MD5 vectors', () => {
    expect(crypto.createHash('sha256').update('abc').digest('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(crypto.createHash('md5').update('abc').digest('hex')).toBe(
      '900150983cd24fb0d6963f7d28e17f72'
    );
  });

  it('hashes byte views and HMAC keys from their visible subranges', () => {
    const data = Buffer.from([8, 9, 10]).subarray(1, 2);
    const key = Buffer.from([8, 2, 10]).subarray(1, 2);
    expect(crypto.createHash('sha256').update(data).digest('hex')).toBe(
      '2b4c342f5433ebe591a1da77e013d1b72475562d48578dca8b84bac6651c3cb9'
    );
    expect(
      crypto
        .createHmac('sha256', key)
        .update(Buffer.from([1]))
        .digest('hex')
    ).toBe('feb0be657eded41a4f6b028fc5ad5513c12ab1a1508f1045919706c547bbcbe1');
  });

  it('matches standard HMAC and PBKDF2 vectors', async () => {
    const hmac = crypto
      .createHmac('sha256', 'key')
      .update('The quick brown fox jumps over the lazy dog')
      .digest('hex');
    expect(hmac).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    expect(crypto.pbkdf2Sync('password', 'salt', 1, 20, 'sha1').toString('hex')).toBe(
      '0c60c80f961f0e71f3a9b524af6012062fe037a6'
    );

    const derived = await new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2('password', 'salt', 1, 20, 'sha1', (error, key) => {
        if (error || !key) {
          reject(error ?? new Error('PBKDF2 returned no derived key.'));
          return;
        }
        resolve(key);
      });
    });
    expect(derived.toString('hex')).toBe('0c60c80f961f0e71f3a9b524af6012062fe037a6');
  });

  it('uses the maintained cipher, signing, and ECDH implementations', () => {
    const key = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const iv = Buffer.alloc(16);
    const cipher = crypto.createCipheriv('aes-128-ctr', key, iv);
    const encrypted = Buffer.concat([cipher.update('payload'), cipher.final()]);
    const decipher = crypto.createDecipheriv('aes-128-ctr', key, iv);
    expect(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString()).toBe(
      'payload'
    );
    expect(crypto.getCiphers()).toContain('aes-128-ctr');

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const signer = crypto.createSign('RSA-SHA256');
    signer.update('signed payload');
    const signature = signer.sign(privateKey);
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update('signed payload');
    expect(verifier.verify(publicKey, signature)).toBe(true);
    const encryptedMessage = crypto.publicEncrypt(publicKey, Buffer.from('secret payload'));
    expect(crypto.privateDecrypt(privateKey, encryptedMessage).toString()).toBe('secret payload');

    const first = crypto.createECDH('secp256k1');
    const second = crypto.createECDH('secp256k1');
    first.generateKeys();
    second.generateKeys();
    expect(first.computeSecret(second.getPublicKey())).toEqual(
      second.computeSecret(first.getPublicKey())
    );
  });

  it('releases tracked I/O when PBKDF2 rejects invalid input synchronously', async () => {
    let trackedPromise: Promise<void> | undefined;
    const trackedCrypto = createCryptoModule(() => promise => {
      trackedPromise = promise;
      return promise;
    });

    expect(() => trackedCrypto.pbkdf2('password', 'salt', -1, 20, 'sha1', () => {})).toThrow(
      TypeError
    );
    await expect(trackedPromise).resolves.toBeUndefined();
  });

  it('supports callback-based random bytes and tracks completion', async () => {
    let trackedPromise: Promise<void> | undefined;
    const trackedCrypto = createCryptoModule(() => promise => {
      trackedPromise = promise;
      return promise;
    });
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      trackedCrypto.randomBytes(16, (error, value) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(value);
      });
    });

    expect(bytes).toHaveLength(16);
    await expect(trackedPromise).resolves.toBeUndefined();
  });

  it('releases tracked I/O when callback-based random bytes rejects invalid input', async () => {
    let trackedPromise: Promise<void> | undefined;
    const trackedCrypto = createCryptoModule(() => promise => {
      trackedPromise = promise;
      return promise;
    });

    expect(() => trackedCrypto.randomBytes(-1, () => {})).toThrow(RangeError);
    await expect(trackedPromise).resolves.toBeUndefined();
  });

  it('uses secure random bytes and generates RFC 4122 version 4 UUIDs', () => {
    expect(crypto.randomBytes(16)).toHaveLength(16);
    expect(crypto.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    const values = new Uint16Array([0x1234, 0x5678, 0x9abc]);
    const view = values.subarray(1, 2);
    const first = values[0];
    const last = values[2];
    expect(crypto.getRandomValues(view)).toBe(view);
    expect(values[0]).toBe(first);
    expect(values[2]).toBe(last);
    expect(() => Reflect.apply(crypto.getRandomValues, crypto, [new Float32Array(1)])).toThrowError(
      expect.objectContaining({ name: 'TypeMismatchError' })
    );
    expect(() => crypto.getRandomValues(new Uint8Array(65_537))).toThrowError(
      expect.objectContaining({ name: 'QuotaExceededError' })
    );
  });

  it('fills only the requested typed array range with secure random bytes', () => {
    const values = new Uint8Array([7, 7, 7, 7, 7]);
    expect(crypto.randomFillSync(values, 1, 3)).toBe(values);
    expect(values[0]).toBe(7);
    expect(values[4]).toBe(7);
    expect(values.subarray(1, 4).some(value => value !== 7)).toBe(true);
  });

  it('generates random integers within the requested exclusive range', async () => {
    for (let index = 0; index < 20; index += 1) {
      const value = crypto.randomInt(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
      const signedValue = crypto.randomInt(-3, 4);
      expect(signedValue).toBeGreaterThanOrEqual(-3);
      expect(signedValue).toBeLessThan(4);
    }
    const callbackValue = await new Promise<number>((resolve, reject) => {
      crypto.randomInt(4, (error, result) => {
        if (error) reject(error);
        else if (result === undefined) reject(new Error('randomInt returned no value.'));
        else resolve(result);
      });
    });
    expect(callbackValue).toBeGreaterThanOrEqual(0);
    expect(callbackValue).toBeLessThan(4);
    const value = await new Promise<number>((resolve, reject) => {
      crypto.randomInt(3, 4, (error, result) => {
        if (error) reject(error);
        else if (result === undefined) reject(new Error('randomInt returned no value.'));
        else resolve(result);
      });
    });
    expect(value).toBe(3);
    expect(() => crypto.randomInt(2, 2)).toThrow(RangeError);
    expect(() => crypto.randomInt(0, 2 ** 48)).toThrow(RangeError);
    expect(() => crypto.randomInt(4, 3, () => {})).toThrow(RangeError);
    expect(() => crypto.randomInt(0, 2 ** 48, () => {})).toThrow(RangeError);
  });

  it('matches timingSafeEqual length and value behavior', () => {
    expect(crypto.timingSafeEqual(Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(true);
    expect(crypto.timingSafeEqual(Buffer.from([1, 2]), Buffer.from([1, 3]))).toBe(false);
    expect(() => crypto.timingSafeEqual(Buffer.from([1]), Buffer.from([1, 2]))).toThrow(RangeError);
  });

  it('compares the visible bytes of DataView and typed array subviews', () => {
    const firstBuffer = Uint8Array.from([9, 1, 2, 9]);
    const secondBuffer = Uint8Array.from([8, 1, 2, 8]);
    const first = new DataView(firstBuffer.buffer, 1, 2);
    const second = new DataView(secondBuffer.buffer, 1, 2);
    expect(crypto.timingSafeEqual(first, second)).toBe(true);

    secondBuffer[2] = 3;
    expect(crypto.timingSafeEqual(first, second)).toBe(false);

    const words = new Uint16Array([0x1234]);
    const sameBytes = new Uint8Array(words.buffer);
    expect(crypto.timingSafeEqual(words, sameBytes)).toBe(true);
    expect(() => crypto.timingSafeEqual(words, new Uint8Array([0x34]))).toThrow(RangeError);
    expect(() => Reflect.apply(crypto.timingSafeEqual, crypto, [{}, new Uint8Array(0)])).toThrow(
      TypeError
    );
  });

  it('matches the RFC 7914 scrypt vector and supports async scrypt', async () => {
    const expected =
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906';
    const options = { N: 16, r: 1, p: 1, maxmem: 2432 };
    expect(crypto.scryptSync('', '', 64, options).toString('hex')).toBe(expected);

    const derived = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt('', '', 64, options, (error, key) => {
        if (error || !key) reject(error ?? new Error('scrypt returned no derived key.'));
        else resolve(key);
      });
    });
    expect(derived.toString('hex')).toBe(expected);
  });

  it('tracks asynchronous scrypt completion and validates arguments synchronously', async () => {
    let trackedPromise: Promise<void> | undefined;
    const trackedCrypto = createCryptoModule(() => promise => {
      trackedPromise = promise;
      return promise;
    });
    const derived = await new Promise<Buffer>((resolve, reject) => {
      trackedCrypto.scrypt('', '', 8, { N: 16, r: 1, p: 1, maxmem: 2432 }, (error, key) => {
        if (error || !key) reject(error ?? new Error('scrypt returned no derived key.'));
        else resolve(key);
      });
    });
    expect(derived).toHaveLength(8);
    await expect(trackedPromise).resolves.toBeUndefined();
    expect(() => Reflect.apply(trackedCrypto.scrypt, trackedCrypto, ['', '', 0, {}, 1])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    await expect(trackedPromise).resolves.toBeUndefined();
  });

  it('accepts scrypt option aliases, visible byte views, and zero-length keys', () => {
    const password = Buffer.from([8, 9, 10]).subarray(1, 2);
    const salt = new DataView(Uint8Array.from([7, 1, 7]).buffer, 1, 1);
    const aliases = { cost: 16, blockSize: 1, parallelization: 1, maxmem: 2432 };
    expect(crypto.scryptSync(password, salt, 16, aliases)).toEqual(
      nativeScryptSync(password, salt, 16, { N: 16, r: 1, p: 1, maxmem: 2432 })
    );
    expect(crypto.scryptSync('password', 'salt', 0, { N: 16, r: 1, p: 1 })).toEqual(
      Buffer.alloc(0)
    );
  });

  it('validates scrypt memory limits and incompatible options synchronously', () => {
    expect(() => crypto.scryptSync('', '', 1, { N: 16, r: 1, p: 1, maxmem: 2431 })).toThrow(
      expect.objectContaining({ code: 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS' })
    );
    expect(() => crypto.scryptSync('', '', 1, { N: 16, cost: 16 })).toThrow(
      expect.objectContaining({ code: 'ERR_INCOMPATIBLE_OPTION_PAIR' })
    );
    expect(() => crypto.scryptSync('', '', -1)).toThrow(
      expect.objectContaining({ code: 'ERR_OUT_OF_RANGE' })
    );
    expect(() => Reflect.apply(crypto.scryptSync, crypto, [1, '', 0])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    expect(() => Reflect.apply(crypto.scrypt, crypto, ['', '', 1, {}, 1])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    expect(() => Reflect.apply(crypto.scryptSync, crypto, ['', '', 2 ** 31])).toThrow(
      expect.objectContaining({ code: 'ERR_OUT_OF_RANGE' })
    );
    expect(() => Reflect.apply(crypto.scryptSync, crypto, ['', '', 1, { N: null }])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    expect(() => Reflect.apply(crypto.scryptSync, crypto, ['', '', 1, { maxmem: null }])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    expect(() => Reflect.apply(crypto.scryptSync, crypto, ['', '', '0'])).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' })
    );
    expect(
      crypto.scryptSync('', '', 0, { N: 16, r: 1, p: 1, maxmem: Number.MAX_SAFE_INTEGER })
    ).toEqual(nativeScryptSync('', '', 0, { N: 16, r: 1, p: 1, maxmem: Number.MAX_SAFE_INTEGER }));
  });

  it('rejects algorithms the backing implementation does not support', () => {
    expect(() => crypto.createHash('unsupported')).toThrow();
  });
});
