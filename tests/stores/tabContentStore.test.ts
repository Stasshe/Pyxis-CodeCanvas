import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTabContent,
  getBufferContent,
  getTabContent,
  isTabDirty,
  setBufferContent,
  setTabContent,
} from '@/stores/tabContentStore';

describe('tab content cache isolation', () => {
  afterEach(() => {
    clearTabContent('tab-a');
    clearTabContent('tab-b');
  });

  it('clears one tab without changing another tab content or dirty state', () => {
    const buffer = Uint8Array.from([1, 2, 3]).buffer;
    setTabContent('tab-a', 'unsaved A', true);
    setBufferContent('tab-a', buffer);
    setTabContent('tab-b', 'saved B', false);

    clearTabContent('tab-a');

    expect(getTabContent('tab-a')).toBeUndefined();
    expect(getBufferContent('tab-a')).toBeUndefined();
    expect(isTabDirty('tab-a')).toBe(false);
    expect(getTabContent('tab-b')).toBe('saved B');
    expect(isTabDirty('tab-b')).toBe(false);
  });
});
