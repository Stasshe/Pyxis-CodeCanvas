import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const lightningFs = vi.hoisted(() => ({
  flush: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@isomorphic-git/lightning-fs', () => ({
  default: class {
    promises = lightningFs;
  },
}));

vi.unmock('@/engine/core/gitFileSystem');

describe('GitFileSystem', () => {
  beforeAll(() => {
    vi.stubGlobal('window', {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('persists LightningFS metadata when flushed', async () => {
    const { gitFileSystem } = await import('@/engine/core/gitFileSystem');

    await gitFileSystem.flush();

    expect(lightningFs.flush).toHaveBeenCalledOnce();
  });
});
