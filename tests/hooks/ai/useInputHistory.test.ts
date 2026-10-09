import { describe, expect, it } from 'vitest';
import { getInputHistoryStorageKey } from '@/hooks/ai/useInputHistory';

describe('getInputHistoryStorageKey', () => {
  it('scopes history by workspace and mode', () => {
    expect(getInputHistoryStorageKey('/workspace-a', 'ask')).not.toBe(
      getInputHistoryStorageKey('/workspace-b', 'ask')
    );
    expect(getInputHistoryStorageKey('/workspace-a', 'ask')).not.toBe(
      getInputHistoryStorageKey('/workspace-a', 'edit')
    );
  });
});
