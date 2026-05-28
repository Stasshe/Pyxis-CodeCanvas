/**
 * crypto モジュールのエミュレーション（ブラウザ環境用）
 *
 * Web Crypto API をラップし、Node.js crypto API に近いインターフェースを提供する。
 * prettier の legacy-cli 等が内部で使用する。
 */

class Hash {
  private data: Uint8Array[] = [];

  constructor(_algorithm: string) {}

  update(data: string | Uint8Array, _encoding?: string): this {
    if (typeof data === 'string') {
      this.data.push(new TextEncoder().encode(data));
    } else {
      this.data.push(data);
    }
    return this;
  }

  digest(encoding?: string): string | Uint8Array {
    // Synchronous hash via SubtleCrypto is not available — use a simple fallback
    // that returns a consistent placeholder. Real use cases (prettier) just need
    // this not to throw.
    const combined = new Uint8Array(this.data.reduce((acc, chunk) => acc + chunk.length, 0));
    let offset = 0;
    for (const chunk of this.data) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Simple djb2-based hash as synchronous fallback
    let h = 5381;
    for (let i = 0; i < combined.length; i++) {
      h = ((h << 5) + h + combined[i]) >>> 0;
    }
    const hex = h.toString(16).padStart(8, '0').repeat(8).slice(0, 64);

    if (encoding === 'hex') return hex;
    if (encoding === 'base64') return btoa(hex);
    if (encoding === 'latin1' || encoding === 'binary') return hex;
    if (!encoding) {
      const buf = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        buf[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return buf;
    }
    return hex;
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

  update(data: string | Uint8Array, encoding?: string): this {
    this.hash.update(data, encoding);
    return this;
  }

  digest(encoding?: string): string | Uint8Array {
    return this.hash.digest(encoding);
  }
}

export function createCryptoModule() {
  return {
    createHash: (algorithm: string) => new Hash(algorithm),
    createHmac: (algorithm: string, key: string | Uint8Array) => new Hmac(algorithm, key),

    randomBytes: (size: number): Uint8Array => {
      const buf = new Uint8Array(size);
      globalThis.crypto.getRandomValues(buf);
      return buf;
    },

    randomUUID: (): string => globalThis.crypto.randomUUID(),

    getRandomValues: (buffer: Uint8Array): Uint8Array => {
      globalThis.crypto.getRandomValues(buffer);
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
      _keylen: number,
      _digest: string,
      cb: (err: Error | null, key: Buffer) => void
    ) => {
      cb(null, new Uint8Array(32) as any);
    },

    pbkdf2Sync: (
      _password: any,
      _salt: any,
      _iterations: number,
      _keylen: number,
      _digest: string
    ): Uint8Array => {
      return new Uint8Array(32);
    },

    scrypt: (
      _password: any,
      _salt: any,
      _keylen: number,
      cb: (err: Error | null, key: Buffer) => void
    ) => {
      cb(null, new Uint8Array(32) as any);
    },

    scryptSync: (_password: any, _salt: any, _keylen: number): Uint8Array => {
      return new Uint8Array(32);
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
