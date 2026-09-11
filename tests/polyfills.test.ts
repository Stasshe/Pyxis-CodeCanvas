import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalBuffer = globalThis.Buffer;

describe('browser polyfills', () => {
  afterEach(() => {
    globalThis.Buffer = originalBuffer;
  });

  it('replaces an incomplete global Buffer implementation', async () => {
    vi.resetModules();
    globalThis.Buffer = { from: vi.fn() } as never;

    await import('@/polyfills');

    expect(globalThis.Buffer).toBe(Buffer);
    expect(typeof globalThis.Buffer.isBuffer).toBe('function');
  });
});
