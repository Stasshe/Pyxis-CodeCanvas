import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORES, storageService } from '@/engine/core/metadata';
import { sessionStore } from '@/stores/sessionStore';

describe('sessionStore.load', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an independent empty session for each workspace without a saved session', async () => {
    const get = vi.spyOn(storageService, 'get').mockResolvedValue(null);

    const first = await sessionStore.load('/workspace/a');
    const second = await sessionStore.load('/workspace/b');
    first.tabs.activePane = 'changed';
    first.ui.leftSidebarWidth = 500;

    expect(get).toHaveBeenCalledWith(STORES.TAB_STATE, 'tabState:/workspace/a');
    expect(first).not.toBe(second);
    expect(second.tabs.activePane).toBe('pane-1');
    expect(second.ui.leftSidebarWidth).toBe(240);
  });

  it('propagates a storage read failure instead of treating it as an empty session', async () => {
    const error = new Error('storage unavailable');
    vi.spyOn(storageService, 'get').mockRejectedValue(error);

    await expect(sessionStore.load('/workspace/a')).rejects.toBe(error);
  });
});
