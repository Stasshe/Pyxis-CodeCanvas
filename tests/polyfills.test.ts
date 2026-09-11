import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalBufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');

describe('browser polyfills', () => {
  afterEach(() => {
    if (originalBufferDescriptor) {
      Object.defineProperty(globalThis, 'Buffer', originalBufferDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'Buffer');
    }
  });

  it('replaces an incomplete global Buffer implementation', async () => {
    vi.resetModules();
    globalThis.Buffer = { from: vi.fn() } as never;

    await import('@/polyfills');

    expect(globalThis.Buffer).toBe(Buffer);
    expect(typeof globalThis.Buffer.isBuffer).toBe('function');
    expect(globalThis.Buffer.isBuffer(globalThis.Buffer.from('6869', 'hex'))).toBe(true);
    expect(globalThis.Buffer.from('6869', 'hex').toString()).toBe('hi');
    expect(globalThis.Buffer.from('hi').toString('base64')).toBe('aGk=');
    expect(globalThis.Buffer.byteLength('é')).toBe(2);
  });
});
