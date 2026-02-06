/**
 * [NEW ARCHITECTURE] Buffer クラスのエミュレーション
 */

class BufferEmulation {
  public _data: Uint8Array;

  constructor(data?: number | ArrayLike<number> | ArrayBuffer) {
    if (typeof data === 'number') {
      this._data = new Uint8Array(data);
    } else if (data instanceof ArrayBuffer) {
      this._data = new Uint8Array(data);
    } else if (data) {
      this._data = new Uint8Array(data);
    } else {
      this._data = new Uint8Array(0);
    }
  }

  get length(): number {
    return this._data.length;
  }

  get byteLength(): number {
    return this._data.byteLength;
  }

  static from(data: string | ArrayBuffer | ArrayLike<number>, encoding?: string): BufferEmulation {
    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      return new BufferEmulation(encoder.encode(data));
    }
    if (data instanceof ArrayBuffer) {
      return new BufferEmulation(data);
    }
    return new BufferEmulation(data);
  }

  static alloc(size: number, fill?: number): BufferEmulation {
    const buffer = new BufferEmulation(size);
    if (fill !== undefined) {
      buffer.fill(fill);
    }
    return buffer;
  }

  static concat(buffers: BufferEmulation[], totalLength?: number): BufferEmulation {
    const length = totalLength ?? buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new BufferEmulation(length);
    let offset = 0;
    for (const buf of buffers) {
      result._data.set(buf._data, offset);
      offset += buf.length;
    }
    return result;
  }

  toString(encoding = 'utf8'): string {
    const decoder = new TextDecoder(encoding);
    return decoder.decode(this._data);
  }

  toJSON(): { type: 'Buffer'; data: number[] } {
    return {
      type: 'Buffer',
      data: Array.from(this._data),
    };
  }

  fill(value: number): this {
    this._data.fill(value);
    return this;
  }

  set(array: ArrayLike<number>, offset?: number): void {
    this._data.set(array, offset);
  }

  slice(start?: number, end?: number): BufferEmulation {
    const sliced = this._data.slice(start, end);
    return new BufferEmulation(sliced);
  }

  [Symbol.iterator]() {
    return this._data[Symbol.iterator]();
  }

  [index: number]: number;
}

// インデックスアクセスのプロキシ設定
const BufferProxy = new Proxy(BufferEmulation, {
  construct(target, args) {
    const instance = new target(...args);
    return new Proxy(instance, {
      get(target, prop) {
        if (typeof prop === 'string' && !Number.isNaN(Number(prop))) {
          return target._data[Number(prop)];
        }
        return (target as any)[prop];
      },
      set(target, prop, value) {
        if (typeof prop === 'string' && !Number.isNaN(Number(prop))) {
          target._data[Number(prop)] = value;
          return true;
        }
        (target as any)[prop] = value;
        return true;
      },
    });
  },
});

// グローバルBufferを設定
if (typeof globalThis !== 'undefined' && !globalThis.Buffer) {
  (globalThis as any).Buffer = BufferProxy;
}

export { BufferProxy as Buffer };
