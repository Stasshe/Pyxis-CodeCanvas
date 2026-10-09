import type { ITerminalOptions } from '@xterm/xterm';
import { Buffer as BrowserBuffer } from 'buffer/index.js';
import { vi } from 'vitest';

export async function createUnicodeTerminal(options: ITerminalOptions = {}) {
  const originalBuffer = globalThis.Buffer;
  vi.stubGlobal('Buffer', BrowserBuffer);
  try {
    const { UnicodeTerminal } = await import('@/engine/system/terminal/unicodeTerminal');
    return new UnicodeTerminal(options);
  } finally {
    vi.stubGlobal('Buffer', originalBuffer);
  }
}
