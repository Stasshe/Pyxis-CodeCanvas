/**
 * crypto モジュールのエミュレーション（ブラウザ環境用）
 *
 * Web Crypto API をラップし、Node.js crypto API に近いインターフェースを提供する。
 * prettier の legacy-cli 等が内部で使用する。
 */

import { Buffer } from 'buffer';

class Hash {
  private data: Buffer[] = [];

  constructor(_algorithm: string) {}

  update(data: string | Uint8Array, encoding?: BufferEncoding): this {
    this.data.push(typeof data === 'string' ? Buffer.from(data, encoding) : Buffer.from(data));
    return this;
  }

  digest(encoding?: BufferEncoding): string | Buffer {
    // Synchronous hash via SubtleCrypto is not available — use a simple fallback
    // that returns a consistent placeholder. Real use cases (prettier) just need
    // this not to throw.
    const combined = Buffer.concat(this.data);

    // Simple djb2-based hash as synchronous fallback
    let h = 5381;
    for (let i = 0; i < combined.length; i++) {
      h = ((h << 5) + h + combined[i]) >>> 0;
    }
    const hex = h.toString(16).padStart(8, '0').repeat(8).slice(0, 64);

    const buffer = Buffer.from(hex, 'hex');
    return encoding ? buffer.toString(encoding) : buffer;
  }
}

class Hmac {
  private key: string;
  private hash: Hash;

  constructor(algorithm: string, key: string | Uint8Array) {
    this.key = typeof key === 'string' ? key : new TextDecoder().decode(key);
    this.hash = new Hash(algorithm);
    this.hash.update(this.key);
  }

  update(data: string | Uint8Array, encoding?: BufferEncoding): this {
    this.hash.update(data, encoding);
    return this;
  }

  digest(encoding?: BufferEncoding): string | Buffer {
    return this.hash.digest(encoding);
  }
}

export function createCryptoModule() {
  return {
    createHash: (algorithm: string) => new Hash(algorithm),
    createHmac: (algorithm: string, key: string | Uint8Array) => new Hmac(algorithm, key),

    randomBytes: (size: number): Buffer => {
      const buffer = Buffer.alloc(size);
      globalThis.crypto.getRandomValues(buffer as Uint8Array<ArrayBuffer>);
      return buffer;
    },

    randomUUID: (): string => globalThis.crypto.randomUUID(),

    getRandomValues: (buffer: Uint8Array): Uint8Array => {
      globalThis.crypto.getRandomValues(buffer as Uint8Array<ArrayBuffer>);
      return buffer;
    },

    // Constants used by various packages
    constants: {
      SSL_OP_NO_SSLv2: 0,
      SSL_OP_NO_SSLv3: 0,
      SSL_OP_NO_TLSv1: 0,
      SSL_OP_NO_TLSv1_1: 0,
      SSL_OP_NO_TLSv1_2: 0,
    },

    // Stub for packages that just check existence
    pbkdf2: (
      _password: any,
      _salt: any,
      _iterations: number,
      keylen: number,
      _digest: string,
      cb: (err: Error | null, key: Buffer) => void
    ) => {
      cb(null, Buffer.alloc(keylen));
    },

    pbkdf2Sync: (
      _password: any,
      _salt: any,
      _iterations: number,
      keylen: number,
      _digest: string
    ): Buffer => {
      return Buffer.alloc(keylen);
    },

    scrypt: (
      _password: any,
      _salt: any,
      keylen: number,
      cb: (err: Error | null, key: Buffer) => void
    ) => {
      cb(null, Buffer.alloc(keylen));
    },

    scryptSync: (_password: any, _salt: any, keylen: number): Buffer => {
      return Buffer.alloc(keylen);
    },

    timingSafeEqual: (a: Uint8Array, b: Uint8Array): boolean => {
      if (a.length !== b.length) return false;
      let result = 0;
      for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
      }
      return result === 0;
    },

    subtle: globalThis.crypto?.subtle,

    webcrypto: globalThis.crypto,
  };
}
