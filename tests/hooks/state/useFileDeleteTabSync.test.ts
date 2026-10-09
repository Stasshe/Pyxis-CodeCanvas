import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChangeEvent } from '@/engine/core/fs';

const mocks = vi.hoisted(() => ({
  listener: null as ((event: FsChangeEvent) => void) | null,
  cleanup: null as (() => void) | null,
  unsubscribe: vi.fn(),
  handleFileDeleted: vi.fn(),
  handleFilesDeleted: vi.fn(),
  handleFilesRenamed: vi.fn(),
  invalidateSavesForDeletedPath: vi.fn(),
}));

vi.mock('react', () => ({
  useEffect: (effect: () => (() => void) | undefined) => {
    mocks.cleanup = effect() ?? null;
  },
  useRef: <T>(current: T) => ({ current }),
}));

vi.mock('@/engine/core/fs', () => ({
  fsClient: {
    addChangeListener: (listener: (event: FsChangeEvent) => void) => {
      mocks.listener = listener;
      return mocks.unsubscribe;
    },
  },
}));

vi.mock('@/stores/tabState', () => ({
  tabActions: {
    handleFileDeleted: mocks.handleFileDeleted,
    handleFilesDeleted: mocks.handleFilesDeleted,
    handleFilesRenamed: mocks.handleFilesRenamed,
    invalidateSavesForDeletedPath: mocks.invalidateSavesForDeletedPath,
  },
}));

import { useFileDeleteTabSync } from '@/hooks/state/useFileDeleteTabSync';

describe('useFileDeleteTabSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listener = null;
    mocks.cleanup = null;
    mocks.unsubscribe.mockReset();
    mocks.handleFileDeleted.mockReset();
    mocks.handleFilesDeleted.mockReset();
    mocks.handleFilesRenamed.mockReset();
    mocks.invalidateSavesForDeletedPath.mockReset();
  });

  afterEach(() => {
    mocks.cleanup?.();
    vi.useRealTimers();
  });

  it('sends rename events directly to the tab store with both paths', () => {
    useFileDeleteTabSync();

    mocks.listener?.({ type: 'rename', oldPath: '/repo/old.ts', path: '/repo/new.ts' });

    expect(mocks.handleFilesRenamed).toHaveBeenCalledOnce();
    expect(mocks.handleFilesRenamed).toHaveBeenCalledWith('/repo/old.ts', '/repo/new.ts');
    expect(mocks.handleFileDeleted).not.toHaveBeenCalled();
    expect(mocks.handleFilesDeleted).not.toHaveBeenCalled();
  });

  it('flushes pending deletes on cleanup and unsubscribes', () => {
    useFileDeleteTabSync();
    mocks.listener?.({ type: 'delete', path: '/repo/removed.ts' });

    mocks.cleanup?.();

    expect(mocks.handleFileDeleted).toHaveBeenCalledWith('/repo/removed.ts');
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('invalidates pending saves as soon as a delete event arrives', () => {
    useFileDeleteTabSync();
    mocks.listener?.({ type: 'delete', path: '/repo/removed.ts' });

    expect(mocks.invalidateSavesForDeletedPath).toHaveBeenCalledOnce();
    expect(mocks.invalidateSavesForDeletedPath).toHaveBeenCalledWith('/repo/removed.ts');
    expect(mocks.handleFileDeleted).not.toHaveBeenCalled();
    expect(mocks.handleFilesDeleted).not.toHaveBeenCalled();
  });
});
