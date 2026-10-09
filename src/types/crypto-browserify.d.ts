declare module 'crypto-browserify' {
  import type * as NodeCrypto from 'node:crypto';
  import type { Buffer } from 'buffer';

  interface Hash {
    update(data: string | Uint8Array, inputEncoding?: BufferEncoding): Hash;
    digest(): Buffer;
    digest(encoding: BufferEncoding): string;
  }

  interface Hmac {
    update(data: string | Uint8Array, inputEncoding?: BufferEncoding): Hmac;
    digest(): Buffer;
    digest(encoding: BufferEncoding): string;
  }

  interface CryptoBrowserify {
    createHash(algorithm: string): Hash;
    createHmac(algorithm: string, key: string | Uint8Array): Hmac;
    randomBytes(size: number): Buffer;
    randomBytes(size: number, callback: (error: Error | null, bytes: Buffer) => void): void;
    randomFillSync<T extends ArrayBufferView>(buffer: T, offset?: number, size?: number): T;
    randomFill<T extends ArrayBufferView>(
      buffer: T,
      offset: number | undefined,
      size: number | undefined,
      callback: (error: Error | null, buffer: T) => void
    ): void;
    pbkdf2(
      password: string | Uint8Array,
      salt: string | Uint8Array,
      iterations: number,
      keylen: number,
      digest: string,
      callback: (error: Error | null, derivedKey: Buffer | undefined) => void
    ): void;
    pbkdf2Sync(
      password: string | Uint8Array,
      salt: string | Uint8Array,
      iterations: number,
      keylen: number,
      digest: string
    ): Buffer;
    getHashes(): string[];
    createCipheriv: typeof NodeCrypto.createCipheriv;
    createDecipheriv: typeof NodeCrypto.createDecipheriv;
    getCiphers: typeof NodeCrypto.getCiphers;
    createSign: typeof NodeCrypto.createSign;
    createVerify: typeof NodeCrypto.createVerify;
    createECDH: typeof NodeCrypto.createECDH;
    getDiffieHellman: typeof NodeCrypto.getDiffieHellman;
    createDiffieHellman: typeof NodeCrypto.createDiffieHellman;
    publicEncrypt: typeof NodeCrypto.publicEncrypt;
    privateEncrypt: typeof NodeCrypto.privateEncrypt;
    publicDecrypt: typeof NodeCrypto.publicDecrypt;
    privateDecrypt: typeof NodeCrypto.privateDecrypt;
    constants: Record<string, number>;
  }

  const crypto: CryptoBrowserify;
  export default crypto;
}
