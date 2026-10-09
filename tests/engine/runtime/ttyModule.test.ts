import { describe, expect, it, vi } from 'vitest';
import { createTTYModule } from '@/engine/runtime/nodejs/modules/ttyModule';

describe('tty ReadStream', () => {
  it('forwards raw-mode changes to runtime stdin', () => {
    const setRawMode = vi.fn();
    const tty = createTTYModule(80, 24, setRawMode);
    const input = new tty.ReadStream();

    expect(input.setRawMode(true)).toBe(input);
    expect(setRawMode).toHaveBeenCalledWith(true);
  });
});
