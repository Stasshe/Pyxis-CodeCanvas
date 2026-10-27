import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  history: new Map<string, string[]>(),
  writeGate: null as Promise<void> | null,
  onWriteStarted: null as (() => void) | null,
}));

vi.mock('@/engine/core/metadata', () => ({
  STORES: { USER_PREFERENCES: 'user_preferences' },
  storageService: {
    get: async (_store: string, key: string) => state.history.get(key) ?? null,
    set: async (_store: string, key: string, paths: string[]) => {
      state.onWriteStarted?.();
      if (state.writeGate) await state.writeGate;
      state.history.set(key, paths);
    },
  },
}));

import {
  getRecentFilePaths,
  recordRecentFilePath,
} from '@/engine/core/metadata/recentFileHistoryAdapter';

describe('recent file history', () => {
  beforeEach(() => {
    state.history.clear();
    state.writeGate = null;
    state.onWriteStarted = null;
  });

  it('serializes concurrent updates and keeps history isolated by workspace', async () => {
    await Promise.all([
      recordRecentFilePath('/workspace/one', '/workspace/one/a.ts'),
      recordRecentFilePath('/workspace/one', '/workspace/one/b.ts'),
      recordRecentFilePath('/workspace/two', '/workspace/two/c.ts'),
    ]);

    expect(await getRecentFilePaths('/workspace/one')).toEqual([
      '/workspace/one/b.ts',
      '/workspace/one/a.ts',
    ]);
    expect(await getRecentFilePaths('/workspace/two')).toEqual(['/workspace/two/c.ts']);
  });

  it('moves a reopened file to the front and bounds the stored paths', async () => {
    await Promise.all(
      Array.from({ length: 45 }, (_, index) =>
        recordRecentFilePath('/workspace', `/workspace/file-${index}.ts`)
      )
    );
    await recordRecentFilePath('/workspace', '/workspace/file-2.ts');
    const paths = await getRecentFilePaths('/workspace');

    expect(paths).toHaveLength(40);
    expect(paths[0]).toBe('/workspace/file-2.ts');
    expect(paths.filter(filePath => filePath === '/workspace/file-2.ts')).toHaveLength(1);
  });

  it('waits for an in-flight activation write before reading history', async () => {
    let releaseWrite = () => {};
    state.writeGate = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    const started = new Promise<void>(resolve => {
      state.onWriteStarted = resolve;
    });
    const write = recordRecentFilePath('/workspace', '/workspace/current.ts');
    await started;
    const read = getRecentFilePaths('/workspace');
    let readFinished = false;
    void read.then(() => {
      readFinished = true;
    });
    await Promise.resolve();
    expect(readFinished).toBe(false);
    releaseWrite();
    await write;
    expect(await read).toEqual(['/workspace/current.ts']);
  });
});
